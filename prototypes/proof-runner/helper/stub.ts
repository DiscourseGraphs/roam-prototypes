import http from "node:http";
import { EMBED_STUB_URL } from "../src/core/database.ts";

// DG's embeddings and error reports, answered on this machine: every POST
// gets one embedding of the right length per input, which is all a kit
// needs from them. A build pointed at the proof database calls it from
// roamresearch.com, so it answers the private-network preflight too.

const DIMENSIONS = 1536;

export const embeddingsFor = (body: string): { data: Array<{ embedding: number[] }> } => {
  let input: unknown = [];
  try {
    input = (JSON.parse(body || "{}") as { input?: unknown }).input ?? [];
  } catch {
    input = [];
  }
  const count = Array.isArray(input) ? input.length : typeof input === "string" ? 1 : 0;
  const embedding = new Array<number>(DIMENSIONS).fill(0.001);
  return { data: Array.from({ length: count }, () => ({ embedding })) };
};

export const startEmbedStub = (port = Number(new URL(EMBED_STUB_URL).port)): Promise<http.Server> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "*");
      if (request.method === "OPTIONS") {
        if (request.headers["access-control-request-private-network"]) {
          response.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        response.writeHead(204).end();
        return;
      }
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(embeddingsFor(body)));
      });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
