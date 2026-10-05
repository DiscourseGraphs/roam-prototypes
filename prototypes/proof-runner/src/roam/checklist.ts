import { HANDLER_SETUP_COMMAND, type DatabaseState, type FixtureOutcome, type HelperState } from "./status";

// What a kit page needs before Run, as the panel shows it: one line per
// prerequisite that applies to this kit, each met (✓) or with the one button
// that meets it. Lines that don't apply aren't shown, and a met line needs
// nothing from anyone, so a page whose needs are met is one press of Run.

export type CheckState = "ok" | "working" | "waiting" | "needs-you" | "blocked" | "optional";

export type CheckAction = "connect" | "disconnect" | "load" | "reload" | "check-database" | "ask-agent";

export type CheckItem = {
  id: "runner" | "machine" | "setup" | "build" | "database" | "agent";
  label: string;
  state: CheckState;
  detail: string;
  list?: string[];
  action?: { kind: CheckAction; label: string };
  secondary?: { kind: CheckAction; label: string };
};

export type ChecklistInput = {
  version: string;
  // The page names a build (build:: or pr::) and the one it wants.
  requested: boolean;
  wanted: string | null;
  loading: boolean;
  // The build this tab loaded, and whether it's this page's.
  loaded: { branch: string; commit: string | null; pointed: boolean } | null;
  other: boolean;
  // The PR's head is ahead of the loaded build.
  behind: string | null;
  buildError: string | null;
  // The local helper, for a kit that needs the proof database; null otherwise.
  helper: HelperState | null;
  // Before-load setup waiting for a press, or what it did.
  setup: { branch: string; apply: string[]; skip: string[] } | null;
  beforeLoad: FixtureOutcome[];
  // A database session, for a kit that needs one; null otherwise.
  database: DatabaseState | null;
  // Approved cases with only an intent, and whether a run waits on steps or a fix.
  byHand: number;
  waitingOnAgent: boolean;
  agentSeen: boolean;
};

const short = (commit: string | null): string => (commit ? ` @ ${commit.slice(0, 7)}` : "");

export const checklist = (input: ChecklistInput): CheckItem[] => {
  const items: CheckItem[] = [{ id: "runner", label: "Proof runner", state: "ok", detail: input.version }];
  const helper = input.helper;
  if (helper) {
    const machine = { id: "machine" as const, label: "This machine" };
    if (helper.state === "ok") {
      items.push({ ...machine, state: "ok", detail: helper.detail, secondary: { kind: "disconnect", label: "Disconnect" } });
    } else if (helper.state === "connecting") {
      items.push({ ...machine, state: "working", detail: helper.detail });
    } else if (helper.state === "missing") {
      items.push({ ...machine, state: "needs-you", detail: helper.detail, action: { kind: "connect", label: "Connect this machine" } });
    } else {
      items.push({
        ...machine,
        state: "blocked",
        detail: helper.state === "unanswered" ? `${helper.detail} Set this machine up once, then Try again: ${HANDLER_SETUP_COMMAND}` : helper.detail,
        action: { kind: "connect", label: "Try again" },
      });
    }
  }
  if (input.setup) {
    items.push({
      id: "setup",
      label: "Graph setup",
      state: "needs-you",
      detail: `Before ${input.setup.branch} loads, this kit sets up the graph:`,
      list: [...input.setup.apply, ...input.setup.skip.map((why) => `skipped: ${why}`)],
      action: { kind: "load", label: "Set up and load" },
    });
  } else if (input.beforeLoad.length) {
    const failed = input.beforeLoad.filter((item) => item.outcome === "failed");
    items.push(
      failed.length
        ? { id: "setup", label: "Graph setup", state: "blocked", detail: failed.map((item) => `${item.id}: ${item.detail}`).join("; ") }
        : { id: "setup", label: "Graph setup", state: "ok", detail: `${input.beforeLoad.length} setting${input.beforeLoad.length === 1 ? "" : "s"} in place` },
    );
  }
  const build = { id: "build" as const, label: "Build" };
  if (!input.requested) {
    items.push({ ...build, state: "ok", detail: "This page names no build:: or pr::, so the kit runs on the DG this tab has." });
  } else if (input.loading) {
    items.push({ ...build, state: "working", detail: `Loading ${input.wanted ?? "the build"}…` });
  } else if (input.loaded && input.other) {
    items.push({
      ...build,
      state: "needs-you",
      detail: `This tab has ${input.loaded.branch}; this page wants ${input.wanted}.`,
      action: { kind: "reload", label: "Reload with this build" },
    });
  } else if (input.loaded) {
    const how = input.loaded.pointed ? "CI build pointed at the proof database" : "CI build";
    items.push({
      ...build,
      state: "ok",
      detail: [`${input.loaded.branch}${short(input.loaded.commit)}`, how, input.behind].filter(Boolean).join(" · "),
    });
  } else if (input.buildError) {
    items.push({ ...build, state: "blocked", detail: input.buildError, action: { kind: "reload", label: "Reload" } });
  } else if (helper && helper.state !== "ok") {
    items.push({ ...build, state: "waiting", detail: `${input.wanted} loads once this machine is connected.` });
  } else if (input.setup) {
    items.push({ ...build, state: "waiting", detail: `${input.wanted} loads after the graph setup.` });
  } else {
    items.push({ ...build, state: "needs-you", detail: `${input.wanted} isn't loaded in this tab.`, action: { kind: "reload", label: "Reload" } });
  }
  if (input.database) {
    const database = { id: "database" as const, label: "Database session" };
    if (!input.loaded || input.other) {
      items.push({ ...database, state: "waiting", detail: "Checked once the build loads." });
    } else if (input.database.state === "ok") {
      items.push({ ...database, state: "ok", detail: input.database.detail });
    } else if (input.database.state === "checking") {
      items.push({ ...database, state: "working", detail: `Waiting for DG to sign in: ${input.database.detail}` });
    } else {
      items.push({ ...database, state: "blocked", detail: input.database.detail, action: { kind: "check-database", label: "Check again" } });
    }
  }
  if (input.byHand > 0 || input.waitingOnAgent) {
    items.push(
      input.agentSeen
        ? { id: "agent", label: "Agent", state: "ok", detail: "Your agent is connected." }
        : {
            id: "agent",
            label: "Agent",
            state: "optional",
            detail: input.waitingOnAgent
              ? "The run is waiting on steps or a fix, which your agent can write."
              : `${input.byHand} case${input.byHand === 1 ? " is" : "s are"} done by hand; your agent can write the steps instead.`,
            action: { kind: "ask-agent", label: "Ask your agent" },
          },
    );
  }
  return items;
};

// Why Run is off: the first line, the agent's aside, that isn't met.
export const runBlocked = (items: CheckItem[]): string | null => {
  const open = items.find((item) => item.id !== "agent" && item.state !== "ok");
  return open ? `${open.label}: ${open.detail}` : null;
};
