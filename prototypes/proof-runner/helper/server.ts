import http from "node:http";
import { EMBED_STUB_URL, LOCAL_BUILDS_URL, PROOF_DB_URL } from "../src/core/database.ts";
import * as database from "./database.ts";
import type { Place } from "./database.ts";
import { startEmbedStub } from "./stub.ts";

// This machine's helper for the in-Roam runner, for kits that touch a
// database. With ensure (what the panel's Connect starts) it first brings up
// the embeddings stub and the proof database, saying "starting" meanwhile,
// then hands the runner the proof database's address and the kits' env.
// Only roamresearch.com pages may reach it (Chrome asks once before a page
// there can reach localhost). The keys are Supabase's stock keys for a stack
// that holds only test data, and stay in the tab that asked. POST /stop
// stops it and what it started.

export const ROAM_ORIGIN = "https://roamresearch.com";

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const answers = async (url: string, init?: RequestInit): Promise<boolean> => {
  try {
    await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
};

export const helperAnswers = (port = Number(new URL(LOCAL_BUILDS_URL).port)): Promise<boolean> =>
  answers(`http://127.0.0.1:${port}/status`);

export const serveHelper = async ({
  place,
  port = Number(new URL(LOCAL_BUILDS_URL).port),
  ensure = false,
  log = (line: string) => console.log(`[proof-helper] ${line}`),
}: {
  place: Place;
  port?: number;
  ensure?: boolean;
  log?: (line: string) => void;
}): Promise<void> => {
  const stoppers: Array<() => Promise<void> | void> = [];
  let starting = ensure;
  let failure: string | null = null;
  const shutdown = async (): Promise<void> => {
    log("Stopping.");
    for (const stopIt of stoppers.reverse()) {
      try {
        await stopIt();
      } catch (error) {
        log(`Couldn't stop everything: ${describe(error)}`);
      }
    }
    process.exit(0);
  };
  const server = http.createServer((request, response) => {
    const origin = request.headers.origin;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Vary", "Origin");
    if (origin && origin !== ROAM_ORIGIN) {
      response.writeHead(403).end();
      return;
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST");
      if (request.headers["access-control-request-private-network"]) {
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "POST" && url.pathname === "/stop") {
      response.writeHead(204).end();
      void shutdown();
      return;
    }
    if (request.method !== "GET" || url.pathname !== "/status") {
      response.writeHead(request.method === "GET" ? 404 : 405).end();
      return;
    }
    void (async () => {
      const { answering } = starting ? { answering: false } : await database.status(place);
      const env = answering ? await database.databaseEnv(place).catch(() => null) : null;
      const body = {
        database: env ? { url: PROOF_DB_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY } : null,
        // What kits fill {{env.X}} from, in the asking tab only.
        env: env
          ? {
              SUPABASE_URL: PROOF_DB_URL,
              SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
              SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
            }
          : null,
        starting,
        error: failure,
      };
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  log(`Answering ${ROAM_ORIGIN} on http://127.0.0.1:${port}/ (database: ${place.runtime}, schema from ${place.checkout}).`);
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  if (ensure) {
    try {
      if (!(await answers(EMBED_STUB_URL, { method: "OPTIONS" }))) {
        const stub = await startEmbedStub();
        log(`Embeddings stub on ${EMBED_STUB_URL}.`);
        stoppers.push(() => {
          stub.close();
        });
      }
      if (!(await database.status(place)).answering) {
        await database.up(place);
        stoppers.push(() => database.stop(place));
      }
      log("The proof database and the embeddings stub are up.");
    } catch (error) {
      failure = `Couldn't start the proof database: ${describe(error)}`;
      log(failure);
    } finally {
      starting = false;
    }
  }
  await new Promise(() => undefined);
};
