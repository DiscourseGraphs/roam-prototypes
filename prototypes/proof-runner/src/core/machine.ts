import type { Action } from "./action";
import type { Journal } from "./journal";
import {
  actionJs,
  validateCase,
  validateSteps,
  type Kit,
  type Step,
  type StepSource,
  type TestCase,
  type Verdict,
} from "./kit";

export type Mode = "auto" | "step" | "case";

export type Phase =
  | "starting"
  | "running"
  | "dwell"
  | "checking"
  | "paused"
  | "waiting-next"
  | "waiting-steps"
  | "waiting-approval"
  | "waiting-verdict"
  | "step-failed"
  | "check-failed"
  | "done"
  | "stopped";

// The HUD is the person at the screen; the socket is the brain. Only the HUD
// can approve model-written js or give a final verdict.
export type CommandSource = "hud" | "socket";

export type Pending =
  | { kind: "steps"; caseId: string; reason: string }
  | { kind: "failure"; caseId: string | null; stepId: string; error: string; why?: string; index?: number }
  | {
      kind: "approval";
      caseId: string | null;
      stepId: string;
      js: string;
      why: string;
    }
  | {
      kind: "verdict";
      caseId: string;
      text: string;
      proposal?: { verdict: Verdict; reason?: string };
    }
  | { kind: "check-failed"; caseId: string; error: string };

export type PauseCause = "you" | "page" | "between-cases" | "agent";

export type How = "checked" | "judged" | "marked" | "skipped" | "unchecked";

export type CaseRecord = {
  verdict: Verdict;
  how: How;
  note: string | null;
  yourNote: string | null;
  byHand: boolean;
  skippedSteps: string[];
  fixedSteps: string[];
  deniedSteps: string[];
  retries: number;
};

// The live panel's view of the whole kit: what it proves, every case with
// its steps and verdict, and a short feed of what just happened.
export type PlanCase = {
  id: string;
  title: string;
  proves: string | null;
  checks: string | null;
  // What a person judges at the end (expect.text), when the case has one.
  judge: string | null;
  hasCheck: boolean;
  intent: string | null;
  verdict: Verdict | null;
  note: string | null;
  record: CaseRecord | null;
  steps: { why: string; source: StepSource }[];
};

export type FeedEntry = {
  t: number;
  kind: "case" | "step" | "pass" | "fail" | "wait" | "you" | "agent" | "note";
  text: string;
};

export type MachineState = {
  phase: Phase;
  mode: Mode;
  speed: number;
  dwellMs: number;
  paused: boolean;
  pausedBy: PauseCause | null;
  executing: boolean;
  stepStartedAt: number | null;
  caseIndex: number;
  caseCount: number;
  caseId: string | null;
  caseTitle: string | null;
  stepIndex: number;
  stepCount: number;
  stepWhy: string | null;
  stepSource: StepSource | null;
  pending: Pending | null;
  results: Record<string, Verdict>;
  claim: string | null;
  given: string | null;
  plan: PlanCase[];
  feed: FeedEntry[];
  // "listening" when the agent used the control socket in the last 45 s.
  agent: "listening" | "away";
};

const FEED_LIMIT = 40;
const AGENT_FRESH_MS = 45_000;

export type Executor = {
  run(action: Action): Promise<void>;
  check(js: string): Promise<void>;
  snapshot(): Promise<string>;
  render(state: MachineState): Promise<void>;
};

export type CommandResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: string };

export type CaseOutcome = { verdict: Verdict; how: How; note?: string; yourNote?: string };

type Tracks = Pick<CaseRecord, "byHand" | "skippedSteps" | "fixedSteps" | "deniedSteps" | "retries">;

const freshTracks = (): Tracks => ({ byHand: false, skippedSteps: [], fixedSteps: [], deniedSteps: [], retries: 0 });

const joinNotes = (...notes: Array<string | null | undefined>): string =>
  notes.filter((note): note is string => Boolean(note)).join(" · ");

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

export const MIN_SPEED = SPEEDS[0];
export const MAX_SPEED = SPEEDS[SPEEDS.length - 1];

const STEP_HOW = [
  "append",
  "insert-next",
  "replace-rest",
  "replace-failed",
] as const;

type StepHow = (typeof STEP_HOW)[number];

const describe = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 800);

const nextCaseId = (cases: TestCase[]): string => {
  const used = new Set(cases.map((testCase) => testCase.id));
  let index = cases.length + 1;
  while (used.has(`c${index}`)) index += 1;
  return `c${index}`;
};

export const scaleAction = (action: Action, speed: number): Action => {
  if (speed === 1) return action;
  if ("pause" in action) return { pause: action.pause / speed };
  if ("type" in action) {
    return {
      type: {
        ...action.type,
        delay_ms: Math.round((action.type.delay_ms ?? 50) / speed),
      },
    };
  }
  if ("command_palette" in action) {
    const value = action.command_palette;
    const label = typeof value === "string" ? value : value.label;
    const delay = typeof value === "string" ? 60 : (value.type_delay_ms ?? 60);
    return {
      command_palette: { label, type_delay_ms: Math.round(delay / speed) },
    };
  }
  return action;
};

export type MachineOptions = {
  kit: Kit;
  // Steps that run once before the first case, e.g. in-session fixtures.
  setup?: Step[];
  journal: Journal;
  executor: Executor;
  mode?: Mode;
  speed?: number;
  dwellMs?: number;
  // Steps that arrive over the socket may only `open` URLs on this origin.
  origin?: string;
  // After the last case, wait for added cases or an explicit stop.
  stayOpen?: boolean;
  // Turns a step into the actions it runs; recipes expand here.
  expand?: (step: Step) => Action[];
  // Runs each time every case has a verdict, e.g. to write an interim bake.
  onIdle?: () => Promise<void>;
  holdOnCheckFail?: boolean;
};

const firstLine = (value: unknown, limit = 160): string =>
  String(value ?? "").split("\n")[0].slice(0, limit);

// The plain-words line the live panel shows for a journal event, if any.
export const feedEntry = (
  type: string,
  payload: Record<string, unknown>,
  kit: Kit,
): Omit<FeedEntry, "t"> | null => {
  const title = (caseId: unknown): string =>
    kit.cases.find((item) => item.id === caseId)?.title ?? String(caseId ?? "");
  switch (type) {
    case "setup-start":
      return { kind: "step", text: "Setting up the data and settings the cases need." };
    case "case-start":
      return { kind: "case", text: `Case: ${title(payload.caseId)}` };
    case "step-start":
      return { kind: "step", text: `Doing: ${firstLine(payload.why)}` };
    case "step-failed":
      return { kind: "fail", text: `Step failed (${firstLine(payload.why, 60)}): ${firstLine(payload.error)}` };
    case "step-resolved":
      return { kind: "step", text: `Failed step: ${String(payload.resolution)}` };
    case "check-failed":
      return { kind: "fail", text: `Check failed: ${firstLine(payload.error)}` };
    case "case-end": {
      const verdict = String(payload.verdict);
      const kind = verdict === "pass" ? "pass" : verdict === "fail" ? "fail" : "note";
      const note = payload.note ? `: ${firstLine(payload.note)}` : "";
      return { kind, text: `${verdict === "pass" ? "Passed" : verdict === "fail" ? "Failed" : "Skipped"}: ${title(payload.caseId)}${note}` };
    }
    case "need-steps":
      return { kind: "wait", text: `Waiting for the agent to work out steps: ${firstLine(payload.intent ?? payload.title)}` };
    case "steps-added": {
      const count = Array.isArray(payload.steps) ? payload.steps.length : 0;
      return payload.by === "you"
        ? { kind: "you", text: `You added ${count} step(s).` }
        : { kind: "agent", text: `Agent added ${count} step(s).` };
    }
    case "case-added":
      return { kind: "agent", text: `New case: ${firstLine((payload.case as Record<string, unknown> | undefined)?.title ?? payload.title)}` };
    case "need-approval":
      return { kind: "wait", text: `The agent wants to run js (${firstLine(payload.why, 80)}). Allow or Deny below.` };
    case "need-verdict":
      return { kind: "wait", text: `Your call: ${firstLine(payload.expect)}` };
    case "said":
      return { kind: "you", text: firstLine(payload.text, 400) };
    case "reply":
      return { kind: "agent", text: firstLine(payload.text, 400) };
    case "note":
      return payload.by === "you" ? null : { kind: "note", text: `Note: ${firstLine(payload.text)}` };
    case "cases-done":
      return { kind: "note", text: "Every case ran. Ask for another, or press Stop." };
    default:
      return null;
  }
};

export class Machine {
  readonly kit: Kit;
  private readonly setup: Step[];
  private readonly journal: Journal;
  private readonly executor: Executor;
  private readonly origin?: string;
  private readonly stayOpen: boolean;
  private readonly onIdle?: () => Promise<void>;
  private readonly expand: (step: Step) => Action[];
  private readonly holdOnCheckFail: boolean;

  private mode: Mode;
  private speed: number;
  private dwellMs: number;
  private phase: Phase = "starting";
  private paused = false;
  private pausedBy: PauseCause | null = null;
  private executing = false;
  private stepStartedAt: number | null = null;
  private caseIndex = -1;
  private stepIndex = 0;
  private cursor = 0;
  private pending: Pending | null = null;
  private readonly verdicts: Record<string, Verdict> = {};
  private readonly verdictNotes: Record<string, string> = {};
  private readonly records: Record<string, CaseRecord> = {};
  private tracks: Tracks = freshTracks();
  private lastFailure: { why: string; index: number; error: string } | null = null;
  private skipNote: string | undefined;
  private checkResolution: "retry" | "continue" | "pass" | null = null;
  private checkNote: string | undefined;

  private wakers: Array<() => void> = [];
  private renderChain: Promise<void> = Promise.resolve();
  private readonly feed: FeedEntry[] = [];
  private agentSeenAt = 0;

  private stepOnce = false;
  private skipDwell = false;
  private stopRequested = false;
  private skipCaseRequested = false;
  private forcedVerdict: CaseOutcome | null = null;
  private failureResolution: "retry" | "skip" | "replaced" | null = null;
  private approval: "allow" | "deny" | null = null;
  private humanVerdict: CaseOutcome | null = null;

  constructor(options: MachineOptions) {
    this.kit = options.kit;
    this.setup = options.setup ?? [];
    this.journal = options.journal;
    this.executor = options.executor;
    this.origin = options.origin;
    this.stayOpen = options.stayOpen ?? false;
    this.onIdle = options.onIdle;
    this.holdOnCheckFail = options.holdOnCheckFail ?? false;
    this.expand =
      options.expand ??
      ((step) => {
        if (step.do) return [step.do];
        throw new Error(`Step ${step.id} uses a recipe, but no recipes are loaded.`);
      });
    this.mode = options.mode ?? "auto";
    this.speed = options.speed ?? 1;
    this.dwellMs = options.dwellMs ?? 1200;
  }

  get results(): Record<string, Verdict> {
    return { ...this.verdicts };
  }

  get notes(): Record<string, string> {
    return { ...this.verdictNotes };
  }

  get caseRecords(): Record<string, CaseRecord> {
    return { ...this.records };
  }

  state(): MachineState {
    const testCase = this.currentCase();
    const steps = this.currentSteps();
    const step = steps[this.stepIndex];
    return {
      phase: this.phase,
      mode: this.mode,
      speed: this.speed,
      dwellMs: this.dwellMs,
      paused: this.paused,
      pausedBy: this.paused ? this.pausedBy : null,
      executing: this.executing,
      stepStartedAt: this.stepStartedAt,
      caseIndex: this.caseIndex,
      caseCount: this.kit.cases.length,
      caseId: testCase?.id ?? null,
      caseTitle: testCase?.title ?? (this.caseIndex < 0 ? "Setup" : null),
      stepIndex: this.stepIndex,
      stepCount: steps.length,
      stepWhy: step?.why ?? null,
      stepSource: step?.source ?? null,
      pending: this.pending,
      results: { ...this.verdicts },
      claim: this.kit.claim ?? null,
      given: this.kit.given ?? null,
      plan: this.kit.cases.map((item) => ({
        id: item.id,
        title: item.title,
        proves: item.proves ?? null,
        checks: item.checks ?? null,
        judge: item.expect?.text ?? null,
        hasCheck: Boolean(item.expect?.js),
        intent: item.intent ?? null,
        verdict: this.verdicts[item.id] ?? null,
        note: this.verdictNotes[item.id] ?? null,
        record: this.records[item.id] ?? null,
        steps: item.steps.map((planStep) => ({
          why: planStep.why,
          source: planStep.source ?? "kit",
        })),
      })),
      feed: this.feed.slice(-FEED_LIMIT),
      agent: Date.now() - this.agentSeenAt < AGENT_FRESH_MS ? "listening" : "away",
    };
  }

  // The live session calls this on every control socket command, so the
  // panel can say whether an agent is there to answer.
  noteAgentSeen(): void {
    const wasAway = Date.now() - this.agentSeenAt >= AGENT_FRESH_MS;
    this.agentSeenAt = Date.now();
    if (wasAway) void this.render();
  }

  status(): Record<string, unknown> {
    return {
      ...this.state(),
      cases: this.kit.cases.map((testCase, index) => ({
        id: testCase.id,
        title: testCase.title,
        intent: testCase.intent ?? null,
        expect: testCase.expect ?? null,
        current: index === this.caseIndex,
        verdict: this.verdicts[testCase.id] ?? null,
        steps: testCase.steps.map((step) => ({
          id: step.id,
          why: step.why,
          source: step.source ?? "kit",
          ...(step.use ? { use: step.use, with: step.with ?? {} } : { do: step.do }),
        })),
      })),
    };
  }

  command(
    source: CommandSource,
    cmd: string,
    args: Record<string, unknown> = {},
  ): CommandResult {
    try {
      const value = this.apply(source, cmd, args);
      this.wake();
      void this.render();
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: describe(error) };
    }
  }

  stop(): void {
    this.command("socket", "stop");
  }

  async run(): Promise<void> {
    this.log("session-start", {
      kit: this.kit.name,
      mode: this.mode,
      speed: this.speed,
      cases: this.kit.cases.map(({ id, title }) => ({ id, title })),
    });
    if (this.setup.length) {
      this.caseIndex = -1;
      this.log("setup-start", { stepCount: this.setup.length });
      const finished = await this.runSteps(null, this.setup);
      this.skipCaseRequested = false;
      this.log("setup-end", { finished });
    }
    let index = 0;
    while (!this.stopRequested) {
      if (index < this.kit.cases.length) {
        this.caseIndex = index;
        await this.runCase(this.kit.cases[index]);
        index += 1;
        if (this.mode === "case" && index < this.kit.cases.length && !this.paused) {
          this.paused = true;
          this.pausedBy = "between-cases";
        }
        continue;
      }
      this.caseIndex = this.kit.cases.length;
      this.stepIndex = 0;
      this.setPhase("done");
      this.log("cases-done", { results: { ...this.verdicts } });
      if (this.onIdle) await this.onIdle();
      if (!this.stayOpen) break;
      while (!this.stopRequested && index >= this.kit.cases.length) {
        await this.signal();
      }
    }
    this.setPhase(this.stopRequested ? "stopped" : "done");
    this.log("session-end", {
      results: { ...this.verdicts },
      stopped: this.stopRequested,
    });
    await this.renderChain;
  }

  private apply(
    source: CommandSource,
    cmd: string,
    args: Record<string, unknown>,
  ): unknown {
    switch (cmd) {
      case "hello":
        return this.state();
      case "status":
        return this.status();
      case "pause":
        if (!this.paused) {
          this.paused = true;
          this.pausedBy = source === "socket" ? "agent" : args.why === "page" ? "page" : "you";
        }
        this.log("paused", { by: source, why: this.pausedBy });
        return this.state();
      case "resume":
        this.paused = false;
        this.pausedBy = null;
        this.log("resumed", { by: source });
        return this.state();
      case "next":
        this.stepOnce = true;
        this.skipDwell = true;
        return this.state();
      case "mode": {
        const mode = args.mode;
        if (mode !== "auto" && mode !== "step" && mode !== "case") {
          throw new Error("mode must be auto, step or case.");
        }
        this.mode = mode;
        this.log("mode", { mode, by: source });
        return this.state();
      }
      case "speed": {
        const speed = Number(args.speed);
        if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
          throw new Error(
            `speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`,
          );
        }
        this.speed = speed;
        this.log("speed", { speed, by: source });
        return this.state();
      }
      case "dwell": {
        const ms = Number(args.ms);
        if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) {
          throw new Error("dwell ms must be between 0 and 10000.");
        }
        this.dwellMs = ms;
        this.log("dwell", { ms, by: source });
        return this.state();
      }
      case "skip-step": {
        if (this.pending?.kind === "failure") {
          this.failureResolution = "skip";
          return this.state();
        }
        if (this.pending?.kind === "approval") {
          this.approval = "deny";
          return this.state();
        }
        throw new Error(
          "Nothing to skip: skip-step works on a failed step or one waiting for approval.",
        );
      }
      case "skip-case": {
        const testCase = this.currentCase();
        if (!testCase) throw new Error("No case is running.");
        const reason = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 1000) : undefined;
        this.skipNote = reason;
        this.skipCaseRequested = true;
        this.log("skip-case", { caseId: testCase.id, by: source, note: reason ?? null });
        return this.state();
      }
      case "retry":
        if (this.pending?.kind === "check-failed") {
          this.checkResolution = "retry";
          return this.state();
        }
        if (this.pending?.kind !== "failure") {
          throw new Error("No failed step or check to retry.");
        }
        this.failureResolution = "retry";
        return this.state();
      case "continue": {
        if (this.pending?.kind !== "check-failed") {
          throw new Error("Nothing is waiting: continue goes on after a failed check.");
        }
        const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 1000) : undefined;
        this.checkNote = note;
        this.checkResolution = "continue";
        return this.state();
      }
      case "steps":
        return this.receiveSteps(source, args);
      case "add-case":
        return this.addCase(source, args);
      case "approve":
      case "deny": {
        if (source !== "hud") {
          throw new Error("Only the HUD can approve or deny a step.");
        }
        const pending = this.pending;
        if (pending?.kind !== "approval" || pending.stepId !== args.stepId) {
          throw new Error("No step with that id is waiting for approval.");
        }
        this.approval = cmd === "approve" ? "allow" : "deny";
        return this.state();
      }
      case "verdict":
        return this.receiveVerdict(source, args);
      case "note": {
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) throw new Error("A note needs text.");
        this.log("note", {
          caseId:
            typeof args.caseId === "string"
              ? args.caseId
              : (this.currentCase()?.id ?? null),
          text: text.slice(0, 2000),
          by: source === "hud" ? "you" : args.by === "you" ? "you" : "model",
        });
        return this.state();
      }
      case "say": {
        if (source !== "hud") throw new Error("Only the HUD can say something as you.");
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) throw new Error("Type something first.");
        const caseId = this.currentCase()?.id ?? null;
        this.log("said", { caseId, text: text.slice(0, 2000), by: "you" });
        // With no agent listening, keep it as a note so it isn't lost.
        if (Date.now() - this.agentSeenAt >= AGENT_FRESH_MS) {
          this.log("note", { caseId, text: text.slice(0, 2000), by: "you" });
        }
        return this.state();
      }
      case "reply": {
        if (source !== "socket") throw new Error("Replies come from the agent.");
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) throw new Error("A reply needs text.");
        this.log("reply", { text: text.slice(0, 2000) });
        return this.state();
      }
      case "stop":
        if (!this.stopRequested) {
          this.stopRequested = true;
          this.log("stop-requested", { by: source });
        }
        return this.state();
      default:
        throw new Error(`Unknown command "${cmd}".`);
    }
  }

  private receiveSteps(
    source: CommandSource,
    args: Record<string, unknown>,
  ): unknown {
    const how = (args.how ?? "append") as StepHow;
    if (!STEP_HOW.includes(how)) {
      throw new Error(`how must be one of ${STEP_HOW.join(", ")}.`);
    }
    const testCase =
      typeof args.caseId === "string"
        ? this.findCase(args.caseId)
        : this.currentCase();
    if (!testCase) throw new Error("No such case is running.");
    // The in-Roam panel sends a step fixed on the kit's page as "kit": it's
    // the kit's own text and runs like the rest of it. Only the HUD may say
    // so; the live HUD can't send steps at all, and the socket never can.
    const by: StepSource =
      source === "hud"
        ? args.by === "kit"
          ? "kit"
          : "you"
        : args.by === "you"
          ? "you"
          : "model";
    const steps = validateSteps(args.steps, "steps", testCase.steps, by);
    if (steps.length === 0) throw new Error("Send at least one step.");
    for (const step of steps) this.checkOrigin(step);

    const isCurrent = testCase === this.currentCase();
    if (isCurrent && source === "hud" && this.pending?.kind === "steps") this.tracks.byHand = true;
    const list = testCase.steps;
    if (how === "append") {
      list.push(...steps);
    } else if (how === "insert-next") {
      const at = isCurrent ? Math.min(this.cursor, list.length) : list.length;
      list.splice(at, 0, ...steps);
    } else if (how === "replace-rest") {
      const from = isCurrent ? Math.min(this.cursor, list.length) : 0;
      list.splice(from, list.length - from, ...steps);
    } else {
      const pending = this.pending;
      if (pending?.kind !== "failure" || !isCurrent) {
        throw new Error("No failed step to replace.");
      }
      const index = list.findIndex((step) => step.id === pending.stepId);
      if (index < 0)
        throw new Error("The failed step is no longer in the case.");
      list.splice(index, 1, ...steps);
      this.failureResolution = "replaced";
    }
    this.log("steps-added", { caseId: testCase.id, how, by, steps });
    return { caseId: testCase.id, stepIds: steps.map((step) => step.id) };
  }

  private addCase(
    source: CommandSource,
    args: Record<string, unknown>,
  ): unknown {
    const by: StepSource =
      source === "hud" || args.by === "you" ? "you" : "model";
    const taken = new Set(this.kit.cases.map((testCase) => testCase.id));
    const testCase = validateCase(
      args.case,
      "case",
      taken,
      nextCaseId(this.kit.cases),
      by,
    );
    for (const step of testCase.steps) this.checkOrigin(step);
    this.kit.cases.push(testCase);
    this.log("case-added", { caseId: testCase.id, title: testCase.title, by });
    return { caseId: testCase.id };
  }

  private receiveVerdict(
    source: CommandSource,
    args: Record<string, unknown>,
  ): unknown {
    const verdict = args.verdict;
    if (verdict !== "pass" && verdict !== "fail") {
      throw new Error('verdict must be "pass" or "fail".');
    }
    const rawNote = typeof args.note === "string" ? args.note : args.reason;
    const note =
      typeof rawNote === "string" && rawNote.trim()
        ? rawNote.trim().slice(0, 1000)
        : undefined;
    const pending = this.pending;
    if (source === "socket") {
      if (pending?.kind !== "verdict") {
        throw new Error("No case is waiting for a verdict.");
      }
      pending.proposal = { verdict, reason: note };
      this.log("verdict-proposed", {
        caseId: pending.caseId,
        verdict,
        reason: note,
      });
      return this.state();
    }
    if (pending?.kind === "verdict") {
      this.humanVerdict = { verdict, how: "judged", yourNote: note };
      return this.state();
    }
    const testCase = this.currentCase();
    if (!testCase) throw new Error("No case is running.");
    // A case done by hand, with no check of its own, ends on the person's word.
    if (pending?.kind === "steps") {
      this.tracks.byHand = true;
      this.forcedVerdict = { verdict, how: "judged", yourNote: note };
      this.skipCaseRequested = true;
      this.log("verdict-by-hand", { caseId: testCase.id, verdict, note });
      return this.state();
    }
    // After a failed check, the person can record the failure and go on,
    // or pass the case on what they saw.
    if (pending?.kind === "check-failed") {
      this.checkNote = note;
      this.checkResolution = verdict === "pass" ? "pass" : "continue";
      return this.state();
    }
    // Pass also ends a case whose step didn't work but the person saw it work.
    if (verdict === "pass" && pending?.kind !== "failure") {
      throw new Error("Pass is only for a case that asks for your verdict, a failed check, or a step that didn't work. To end this case, fail it with a reason, or skip it.");
    }
    const failed = pending?.kind === "failure" ? this.lastFailure : null;
    this.forcedVerdict = {
      verdict,
      how: "marked",
      note: failed ? `Step ${failed.index + 1}, "${failed.why}", failed: ${failed.error}` : undefined,
      yourNote: note,
    };
    this.skipCaseRequested = true;
    this.log("verdict-forced", { caseId: testCase.id, verdict, note });
    return this.state();
  }

  private checkOrigin(step: Step): void {
    const actions = this.expand(step);
    if (!this.origin) return;
    for (const action of actions) {
      if (!("open" in action)) continue;
      const target: URL = new URL(action.open, this.origin);
      if (target.origin !== this.origin) {
        throw new Error(`open must stay on ${this.origin}.`);
      }
    }
  }

  private async runCase(testCase: TestCase): Promise<void> {
    this.skipCaseRequested = false;
    this.forcedVerdict = null;
    this.tracks = freshTracks();
    this.lastFailure = null;
    this.skipNote = undefined;
    this.stepIndex = 0;
    this.cursor = 0;
    this.log("case-start", {
      caseId: testCase.id,
      title: testCase.title,
      intent: testCase.intent ?? null,
      stepCount: testCase.steps.length,
    });
    await this.holdWhilePaused();
    if (!this.interrupted() && testCase.steps.length === 0 && testCase.intent) {
      await this.waitForSteps(testCase, "no-steps");
    }
    const finished =
      !this.interrupted() && (await this.runSteps(testCase, testCase.steps));
    if (this.stopRequested && !this.forcedVerdict) {
      this.log("case-interrupted", { caseId: testCase.id });
      return;
    }
    let outcome: CaseOutcome | null;
    if (this.forcedVerdict) outcome = this.forcedVerdict;
    else if (!finished) outcome = this.skipped();
    else outcome = await this.judge(testCase);
    // A Fail pressed while the check ran wins over the check.
    if (this.forcedVerdict) outcome = this.forcedVerdict;
    if (!outcome) {
      if (this.stopRequested) {
        this.log("case-interrupted", { caseId: testCase.id });
        return;
      }
      outcome = this.forcedVerdict ?? this.skipped();
    }
    this.verdicts[testCase.id] = outcome.verdict;
    const combined = joinNotes(outcome.note, outcome.yourNote);
    if (combined) this.verdictNotes[testCase.id] = combined;
    this.records[testCase.id] = {
      verdict: outcome.verdict,
      how: outcome.how,
      note: outcome.note ?? null,
      yourNote: outcome.yourNote ?? null,
      ...this.tracks,
    };
    this.log("case-end", {
      caseId: testCase.id,
      verdict: outcome.verdict,
      note: combined || null,
      how: outcome.how,
      ...this.tracks,
    });
    this.skipCaseRequested = false;
    this.forcedVerdict = null;
  }

  private async runSteps(
    testCase: TestCase | null,
    steps: Step[],
  ): Promise<boolean> {
    for (let index = 0; index < steps.length; index += 1) {
      this.stepIndex = index;
      this.cursor = index;
      await this.gate();
      if (this.interrupted()) return false;
      const step = steps[index];
      if (this.needsApproval(step)) {
        const allowed = await this.waitForApproval(testCase, step);
        if (this.interrupted()) return false;
        if (!allowed) {
          this.tracks.deniedSteps.push(step.why);
          steps.splice(index, 1);
          index -= 1;
          continue;
        }
        step.approved = true;
      }
      this.cursor = index + 1;
      const outcome = await this.execute(testCase, step);
      if (this.interrupted()) return false;
      if (outcome === "retry" || outcome === "replaced") {
        index -= 1;
        continue;
      }
      await this.dwell();
    }
    return true;
  }

  private needsApproval(step: Step): boolean {
    return (
      step.do !== undefined &&
      actionJs(step.do) !== null &&
      (step.source ?? "kit") !== "kit" &&
      !step.approved
    );
  }

  private async gate(): Promise<void> {
    for (;;) {
      if (this.interrupted()) return;
      if (this.stepOnce) {
        this.stepOnce = false;
        return;
      }
      if (this.paused) {
        this.setPhase("paused");
        await this.signal();
        continue;
      }
      if (this.mode === "step") {
        this.setPhase("waiting-next");
        await this.signal();
        continue;
      }
      return;
    }
  }

  private async holdWhilePaused(): Promise<void> {
    while (this.paused && !this.interrupted()) {
      if (this.stepOnce) {
        this.stepOnce = false;
        return;
      }
      this.setPhase("paused");
      await this.signal();
    }
  }

  private async dwell(): Promise<void> {
    const ms = this.dwellMs / this.speed;
    this.skipDwell = false;
    if (ms <= 0) return;
    const until = Date.now() + ms;
    this.setPhase("dwell");
    while (
      Date.now() < until &&
      !this.skipDwell &&
      !this.paused &&
      !this.interrupted()
    ) {
      await this.signal(until - Date.now());
    }
    this.skipDwell = false;
  }

  private async execute(
    testCase: TestCase | null,
    step: Step,
  ): Promise<"ok" | "skip" | "retry" | "replaced"> {
    const ids = { caseId: testCase?.id ?? null, stepId: step.id };
    this.executing = true;
    this.stepStartedAt = Date.now();
    this.setPhase("running");
    this.log("step-start", {
      ...ids,
      why: step.why,
      source: step.source ?? "kit",
      ...(step.use ? { use: step.use, with: step.with ?? {} } : { do: step.do }),
    });
    try {
      const actions = this.expand(step);
      for (let index = 0; index < actions.length; index += 1) {
        if (index > 0) await this.holdMidStep();
        if (this.interrupted()) {
          this.log("step-interrupted", ids);
          return "skip";
        }
        await this.executor.run(scaleAction(actions[index], this.speed));
      }
      this.executing = false;
      this.log("step-done", ids);
      return "ok";
    } catch (error) {
      this.executing = false;
      this.stepStartedAt = null;
      const message = describe(error);
      const aria = await this.snapshot();
      this.lastFailure = { why: step.why, index: this.stepIndex, error: message };
      this.pending = {
        kind: "failure",
        caseId: ids.caseId,
        stepId: step.id,
        error: message,
        why: step.why,
        index: this.stepIndex,
      };
      this.failureResolution = null;
      this.setPhase("step-failed");
      this.log("step-failed", { ...ids, why: step.why, error: message, aria });
      while (!this.failureResolution && !this.interrupted()) {
        await this.signal();
      }
      // The wait above sets it from a command; read it fresh, not as narrowed before the wait.
      const resolution = (this.failureResolution as "retry" | "skip" | "replaced" | null) ?? "skip";
      this.failureResolution = null;
      this.pending = null;
      if (resolution === "skip" && !this.interrupted()) this.tracks.skippedSteps.push(step.why);
      if (resolution === "retry") this.tracks.retries += 1;
      if (resolution === "replaced") this.tracks.fixedSteps.push(step.why);
      this.log("step-resolved", { ...ids, resolution });
      return resolution;
    } finally {
      this.executing = false;
      this.stepStartedAt = null;
      void this.render();
    }
  }

  private async holdMidStep(): Promise<void> {
    if (!this.paused || this.interrupted()) return;
    this.executing = false;
    while (this.paused && !this.interrupted()) {
      if (this.stepOnce) {
        this.stepOnce = false;
        break;
      }
      this.setPhase("paused");
      await this.signal();
    }
    this.executing = true;
    this.setPhase("running");
  }

  private skipped(): CaseOutcome {
    const failed = this.lastFailure;
    return {
      verdict: "skip",
      how: "skipped",
      note: failed ? `Skipped after step ${failed.index + 1}, "${failed.why}", failed: ${failed.error}` : undefined,
      yourNote: this.skipNote,
    };
  }

  private async waitForSteps(
    testCase: TestCase,
    reason: string,
  ): Promise<void> {
    const aria = await this.snapshot();
    this.pending = { kind: "steps", caseId: testCase.id, reason };
    this.setPhase("waiting-steps");
    this.log("need-steps", {
      caseId: testCase.id,
      title: testCase.title,
      intent: testCase.intent ?? null,
      expect: testCase.expect ?? null,
      reason,
      aria,
    });
    while (testCase.steps.length === 0 && !this.interrupted()) {
      await this.signal();
    }
    this.pending = null;
  }

  private async waitForApproval(
    testCase: TestCase | null,
    step: Step,
  ): Promise<boolean> {
    const js = (step.do && actionJs(step.do)) ?? "";
    const ids = { caseId: testCase?.id ?? null, stepId: step.id };
    this.pending = { kind: "approval", ...ids, js, why: step.why };
    this.approval = null;
    this.setPhase("waiting-approval");
    this.log("need-approval", { ...ids, why: step.why, js });
    while (!this.approval && !this.interrupted()) await this.signal();
    const allowed = this.approval === "allow";
    this.approval = null;
    this.pending = null;
    this.log(allowed ? "step-allowed" : "step-denied", ids);
    return allowed;
  }

  private async judge(testCase: TestCase): Promise<CaseOutcome | null> {
    const expectation = testCase.expect;
    if (expectation?.js) {
      for (;;) {
        this.setPhase("checking");
        let message: string;
        try {
          await this.executor.check(expectation.js);
          return { verdict: "pass", how: "checked" };
        } catch (error) {
          message = describe(error);
        }
        if (!this.holdOnCheckFail || this.interrupted()) return { verdict: "fail", how: "checked", note: message };
        this.pending = { kind: "check-failed", caseId: testCase.id, error: message };
        this.checkResolution = null;
        this.checkNote = undefined;
        this.setPhase("check-failed");
        this.log("check-failed", { caseId: testCase.id, error: message });
        while (!this.checkResolution && !this.interrupted()) await this.signal();
        const resolution = this.checkResolution;
        const yourNote = this.checkNote;
        this.checkResolution = null;
        this.checkNote = undefined;
        this.pending = null;
        if (resolution === "retry") {
          this.tracks.retries += 1;
          continue;
        }
        if (resolution === "pass") return { verdict: "pass", how: "marked", note: message, yourNote };
        if (resolution !== "continue") return null;
        return { verdict: "fail", how: "checked", note: message, yourNote };
      }
    }
    if (expectation?.text) {
      this.pending = {
        kind: "verdict",
        caseId: testCase.id,
        text: expectation.text,
      };
      this.humanVerdict = null;
      this.setPhase("waiting-verdict");
      this.log("need-verdict", {
        caseId: testCase.id,
        title: testCase.title,
        expect: expectation.text,
      });
      while (!this.humanVerdict && !this.interrupted()) await this.signal();
      const verdict = this.humanVerdict;
      this.humanVerdict = null;
      this.pending = null;
      return verdict;
    }
    return { verdict: "pass", how: "unchecked", note: "No expectation; every step ran." };
  }

  private async snapshot(): Promise<string> {
    try {
      return await this.executor.snapshot();
    } catch (error) {
      return `(aria snapshot unavailable: ${describe(error)})`;
    }
  }

  private interrupted(): boolean {
    return this.stopRequested || this.skipCaseRequested;
  }

  private currentCase(): TestCase | undefined {
    return this.caseIndex >= 0 ? this.kit.cases[this.caseIndex] : undefined;
  }

  private currentSteps(): Step[] {
    if (this.caseIndex < 0) return this.setup;
    return this.currentCase()?.steps ?? [];
  }

  private findCase(id: string): TestCase | undefined {
    return this.kit.cases.find((testCase) => testCase.id === id);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    void this.render();
  }

  private render(): Promise<void> {
    const state = this.state();
    this.renderChain = this.renderChain
      .then(() => this.executor.render(state))
      .catch(() => undefined);
    return this.renderChain;
  }

  private log(type: string, payload: Record<string, unknown> = {}): void {
    this.journal.append(type, payload);
    const entry = feedEntry(type, payload, this.kit);
    if (entry) {
      this.feed.push({ t: Date.now(), ...entry });
      if (this.feed.length > FEED_LIMIT * 2) this.feed.splice(0, FEED_LIMIT);
      void this.render();
    }
  }

  private signal(timeoutMs?: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      this.wakers.push(done);
      if (timeoutMs !== undefined) {
        timer = setTimeout(done, Math.max(0, timeoutMs));
      }
    });
  }

  private wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const wake of wakers) wake();
  }
}
