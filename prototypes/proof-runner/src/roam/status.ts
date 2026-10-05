import { PROOF_DB_HOST } from "../core/database";
import type { LocalServer } from "./build-loader";

// The states the runner tracks outside a run, shared by the runner and its
// checklist; kept apart from the page code so Node tests can read them.

export type FixtureOutcome = {
  id: string;
  why: string;
  // build: the build does it itself (a CI build signs in to its own database).
  outcome: "ok" | "kept" | "skipped" | "failed" | "build";
  detail?: string;
};

// Whether DG has a session on the build's database, checked after load.
export type DatabaseState = { state: "checking" | "ok" | "missing"; detail: string };

// This machine's part in a kit that needs the proof database: the local
// helper (roam/cli.ts local) answering with the database's keys. The
// panel's Connect starts it; until it answers, nothing loads.
export type HelperState = {
  state: "missing" | "connecting" | "ok" | "unanswered" | "failed";
  detail: string;
};

// Registers the dg-proof:// link the panel's Connect button opens; once per machine.
export const HANDLER_SETUP_COMMAND = "npx tsx /mnt/data/projects/dg-demo-videos/proof/roam/cli.ts install-handler";

export const helperState = (server: LocalServer | null): HelperState =>
  !server
    ? { state: "missing", detail: "This kit needs the proof database, which runs on this machine." }
    : server.starting
      ? { state: "connecting", detail: "Starting the proof database and the embeddings stub on this machine…" }
      : !server.database
      ? { state: "failed", detail: server.error ?? "The local helper is up but the proof database isn't." }
      : { state: "ok", detail: `proof database on ${PROOF_DB_HOST}` };
