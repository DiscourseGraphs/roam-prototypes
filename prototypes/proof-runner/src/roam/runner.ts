import { CONNECTING_FLAGS, connectingFlagsAfter } from "../core/database";
import { inSessionSteps, smokeSteps } from "../core/fixtures";
import { Journal } from "../core/journal";
import { decisionOf, runnableKit, validateSteps, type Baseline, type Fixture, type Kit, type Step, type Verdict } from "../core/kit";
import { Machine, type CaseRecord, type MachineState, type PlanCase } from "../core/machine";
import { makeExpander, type RecipeBook } from "../core/recipes";
import { fill, fillDeep, type TemplateContext } from "../core/template";
import type { ExtensionAPI, FetchedBuild, LoadedBuild, PaletteRegistry } from "./build-loader";
import { checklist, runBlocked, type CheckItem } from "./checklist";
import { evaluate, makePageExecutor } from "./executor";
import { blockText, pageKit, rootConfig, runBlocksFor, stepBlockOf, stepFromBlock, type BlockNode, type PageKit, type RunBlocks } from "./page-kit";
import { ProofPanel, type KitSummary, type PanelAction, type PanelView, type RunChoice, type RunInfo } from "./panel";
import { logLine } from "./outcome";
import { createTree, pageOf, readTree, roam, userName } from "./roam";
import type { DatabaseState, FixtureOutcome, HelperState } from "./status";
import { doneWhen, kindOfStep, type RunFacts, type StepKind } from "./words";

export { HANDLER_SETUP_COMMAND, helperState, type DatabaseState, type FixtureOutcome, type HelperState } from "./status";

// One {{proof}} block's runs: reads the kit off the page, runs it on the
// machine the live rehearsal uses, shows it in every panel mounted for the
// block, marks the case and step blocks, keeps enough to resume after a
// reload, and writes a line to the block's run log when a run finishes.

// Before-load fixtures that would change the graph, waiting for a person to
// say go before the build loads.
export type SetupPlan = {
  rootUid: string;
  kit: string;
  branch: string;
  pr: number | null;
  head: string | null;
  apply: Fixture[];
  // Fixtures that need a key this browser doesn't have; they're skipped.
  skip: Array<{ fixture: Fixture; reason: string }>;
  kept: Fixture[];
  // Local-database sign-ins a hosted build does for itself at load; the
  // runner checks the session after load instead.
  byBuild: Fixture[];
  // The kit needs a database session (needs: supabase, or a sign-in above).
  needsDatabase: boolean;
  fetched?: FetchedBuild;
};

export type RunnerEnv = {
  graph: string;
  extensionAPI?: ExtensionAPI;
  build: LoadedBuild | null;
  buildError: string | null;
  // Which kit picked the build, and what its before-load fixtures did.
  buildFor: string | null;
  beforeLoad: FixtureOutcome[];
  setup: SetupPlan | null;
  confirmSetup: () => Promise<void>;
  palette: PaletteRegistry;
  recipes: RecipeBook;
  baselines: Map<string, Baseline>;
  timeout: number;
  secrets: () => Record<string, string>;
  // What the loader decided, for "why didn't my build load?".
  loadTrace: string[];
  loading: boolean;
  database: DatabaseState | null;
  // The runner's version, for the checklist's first line.
  version: string;
  // The local helper, when the kit that picked the build needs it.
  helper: HelperState | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  checkDatabase: () => Promise<void>;
  // Opens the person's local agent on this kit.
  askAgent: (rootUid: string) => Promise<string | null>;
  // When an agent last called one of the runner's tools.
  agentSeenAt: number;
};

type RunRecord = {
  kitHash: string;
  nextCase: number;
  // Each judged case's record: its verdict, how it was reached, and its notes.
  records: Record<string, CaseRecord>;
  commit: string | null;
};

const hash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 5381;
  for (let index = 0; index < text.length; index += 1) h = ((h << 5) + h + text.charCodeAt(index)) | 0;
  return (h >>> 0).toString(36);
};

const runId = (): string => Math.random().toString(36).slice(2, 8);

const pad = (value: number): string => String(value).padStart(2, "0");

const stamp = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

const MISSING_KEY = /\{\{env\.([A-Z0-9_]+)\}\}/;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Fill that says where to put a missing key in this tab, rather than the
// shell export the CLI's message asks for.
const fillIn = <T>(value: T, context: TemplateContext): T => {
  try {
    return fillDeep(value, context);
  } catch (error) {
    const name = MISSING_KEY.exec(String(error))?.[1];
    if (!name) throw error;
    throw new Error(
      `{{env.${name}}} isn't set in this browser. Run proofRunner.setSecret("${name}", "…") in the console (it stays in this browser), then Retry, or skip the step.`,
    );
  }
};

export const contextFor = (kit: string, env: RunnerEnv, run: string): TemplateContext => ({
  env: env.secrets(),
  kit,
  run,
});

// Sorts before-load fixtures (the flags and node types DG reads once when it
// starts) into kept (their check holds), to apply, and skipped (they need a
// key this browser doesn't have: a CI build talks to the hosted backend, so
// a local-database sign-in doesn't apply to it).
type Plan = Pick<SetupPlan, "apply" | "skip" | "kept" | "byBuild">;

// proof.supabase.signIn signs in to the proof database with its service
// key, a stand-in for the create-space call it runs without. A hosted build
// makes that call itself, so for one the fixture is the build's to do.
const LOCAL_SIGN_IN = /proof\.supabase\.signIn\b/;

// Whether a kit needs a database session: it says so, or it signs in.
export const kitNeedsDatabase = (kit: Kit, fixtures: Fixture[]): boolean =>
  Boolean(kit.needs?.includes("supabase")) ||
  fixtures.some((fixture) => "js" in fixture.apply && LOCAL_SIGN_IN.test(fixture.apply.js));

export const planBeforeLoad = async (
  fixtures: Fixture[],
  context: TemplateContext,
  backend: string | null = null,
): Promise<Plan> => {
  const plan: Plan = { apply: [], skip: [], kept: [], byBuild: [] };
  const hosted = Boolean(backend && backend !== "127");
  for (const fixture of fixtures.filter((item) => item.phase === "before-load")) {
    try {
      if (fixture.check && "js" in fixture.check && (await evaluate(fill(fixture.check.js, context)))) {
        plan.kept.push(fixture);
        continue;
      }
    } catch {
      // A check that throws counts as not holding; the apply decides.
    }
    if (hosted && "js" in fixture.apply && LOCAL_SIGN_IN.test(fixture.apply.js)) {
      plan.byBuild.push(fixture);
      continue;
    }
    if (!("js" in fixture.apply)) {
      plan.skip.push({ fixture, reason: "a before-load fixture applies js" });
      continue;
    }
    try {
      fill(fixture.apply.js, context);
      plan.apply.push(fixture);
    } catch (error) {
      const name = MISSING_KEY.exec(String(error))?.[1] ?? "a key";
      plan.skip.push({ fixture, reason: `needs ${name}, which this browser doesn't have` });
    }
  }
  return plan;
};

export const applyBeforeLoad = async (plan: Plan, context: TemplateContext): Promise<FixtureOutcome[]> => {
  const outcomes: FixtureOutcome[] = [
    ...plan.kept.map((fixture): FixtureOutcome => ({ id: fixture.id, why: fixture.why, outcome: "kept" })),
    ...plan.byBuild.map(
      (fixture): FixtureOutcome => ({ id: fixture.id, why: fixture.why, outcome: "build", detail: "the build signs in to its own database" }),
    ),
    ...plan.skip.map(({ fixture, reason }): FixtureOutcome => ({ id: fixture.id, why: fixture.why, outcome: "skipped", detail: reason })),
  ];
  for (const fixture of plan.apply) {
    try {
      await evaluate(fill((fixture.apply as { js: string }).js, context));
      outcomes.push({ id: fixture.id, why: fixture.why, outcome: "ok" });
    } catch (error) {
      outcomes.push({ id: fixture.id, why: fixture.why, outcome: "failed", detail: describe(error) });
    }
  }
  return outcomes;
};

// After Set up and load, the fixtures that failed, as a plan to retry; null
// when they all held. A before-load fixture that failed leaves DG's startup
// state wrong, so the build doesn't load until they hold.
export const retryPlan = (plan: SetupPlan, outcomes: FixtureOutcome[]): SetupPlan | null => {
  const failed = new Set(outcomes.filter((item) => item.outcome === "failed").map((item) => item.id));
  return failed.size ? { ...plan, apply: plan.apply.filter((fixture) => failed.has(fixture.id)) } : null;
};

export type BuildStatus = {
  // The branch (or "PR #n" before it's resolved) the page asks for.
  wanted: string | null;
  // The tab loaded another page's build.
  other: boolean;
  // The PR's head is ahead of the build loaded.
  behind: string | null;
  // Why Run is off; null when the kit can run.
  blocked: string | null;
};

// Whether a kit can run on what this tab loaded. A kit that names a build
// (build:: or pr::) only runs on that build, loaded for it: running it on
// another kit's build, or on none, would write a proof that isn't one.
export const buildStatus = ({
  config,
  loaded,
  mine,
  setup,
  loading,
  buildError,
  needsDatabase = false,
  database = null,
}: {
  config: { build: string | null; pr: number | null };
  loaded: Pick<LoadedBuild, "branch" | "pr" | "commit" | "prHead"> | null;
  mine: boolean;
  setup: boolean;
  loading: boolean;
  buildError: string | null;
  needsDatabase?: boolean;
  database?: DatabaseState | null;
}): BuildStatus => {
  const requested = Boolean(config.build || config.pr);
  const matches = Boolean(
    loaded && (config.build ? loaded.branch === config.build : config.pr ? mine || loaded.pr === config.pr : true),
  );
  const wanted = config.build ?? (config.pr ? (loaded && matches ? loaded.branch : `PR #${config.pr}`) : null);
  const status = { wanted, other: false, behind: null as string | null };
  if (!requested) return { ...status, blocked: null };
  if (loading) return { ...status, blocked: "The build is still loading." };
  if (setup) return { ...status, blocked: "Set up and load the build first." };
  if (loaded && !matches) {
    return { ...status, other: true, blocked: `This tab has ${loaded.branch}; reload on this page to load ${wanted}.` };
  }
  if (!loaded) {
    return { ...status, blocked: buildError ? "The page's build didn't load." : `${wanted} isn't loaded in this tab.` };
  }
  const behind =
    loaded.prHead && loaded.commit && !loaded.prHead.startsWith(loaded.commit.slice(0, 7))
      ? `PR head is ${loaded.prHead.slice(0, 7)}; CI may still be building it`
      : null;
  // A kit that needs the database proves nothing without a session on it.
  if (needsDatabase && database?.state !== "ok") {
    return {
      ...status,
      behind,
      blocked:
        database?.state === "missing" ? `No database session: ${database.detail}` : "Waiting for DG to sign in to its database.",
    };
  }
  return { ...status, behind, blocked: null };
};

// Whether loading this build would put the graph on a database: the kit
// needs one, or sync or node sharing is on once its setup has run (on in
// the graph now and not turned off, or turned on).
export const wouldConnect = ({
  needsDatabase,
  flagsOn,
  apply,
}: {
  needsDatabase: boolean;
  // The connecting flags on in the graph now.
  flagsOn: readonly string[];
  apply: Fixture[];
}): boolean =>
  needsDatabase ||
  connectingFlagsAfter(
    flagsOn,
    apply.flatMap((fixture) => ("js" in fixture.apply ? [fixture.apply.js] : [])),
  ).length > 0;

export { CONNECTING_FLAGS };

// CI compiles PR builds against the production database, and tests never
// run there: a kit that would connect runs on the PR's CI build pointed at
// the proof database (pointBuild), and on nothing else.
export const PRODUCTION_REFUSAL =
  "This build talks to the production database, and this kit would connect to it (it needs a database, or turns on sync or node sharing). It runs only pointed at the proof database.";

// A saved partial run only resumes on the kit and the commit it started on;
// verdicts from another commit can't stand for this one.
export const recordFits = (
  record: { kitHash: string; commit: string | null } | null,
  kitHash: string,
  commit: string | null,
): boolean => Boolean(record && record.kitHash === kitHash && record.commit === commit);

export const fixturesFor = (kit: Kit, env: RunnerEnv): Fixture[] => {
  const baseline = kit.baseline ? env.baselines.get(kit.baseline) : null;
  if (kit.baseline && !baseline) throw new Error(`This runner has no baseline ${kit.baseline}.`);
  return [...(baseline?.prepare ?? []), ...(kit.prepare ?? [])];
};

const MARKS_ID = "proof-run-marks";

// An agent that called one of the runner's tools this recently is there.
const AGENT_FRESH_MS = 45_000;
const AGENT_CONTROLS = ["pause", "resume", "next", "skip-step", "skip-case", "stop"];

// How each run choice plays: Watch it holds on a failed check so the screen
// can be looked at; Just the result runs faster and doesn't wait for anyone
// on a step that doesn't work; Step through waits before every step.
const PLAY: Record<RunChoice, { mode: "auto" | "step"; speed: number; dwellMs: number; holdOnCheckFail: boolean; leadMs: number }> = {
  watch: { mode: "auto", speed: 1, dwellMs: 700, holdOnCheckFail: true, leadMs: 250 },
  result: { mode: "auto", speed: 2, dwellMs: 300, holdOnCheckFail: false, leadMs: 0 },
  step: { mode: "step", speed: 1, dwellMs: 700, holdOnCheckFail: true, leadMs: 0 },
};

const CHOICE_WORDS: Record<RunChoice, string> = { watch: "watched", result: "just the result", step: "stepped through" };

const ticketOf = (kit: Kit): string | null => kit.ticket ?? /\beng-\d+\b/i.exec(kit.name)?.[0]?.toUpperCase() ?? null;

export class ProofRun {
  readonly panel: ProofPanel;
  private tree: BlockNode | null = null;
  private kit: PageKit | null = null;
  private error: string | null = null;
  private machine: Machine | null = null;
  // Settles once the run going now has finished and logged itself.
  private finished: Promise<void> = Promise.resolve();
  private state: MachineState | null = null;
  // Records of the kit's cases this run doesn't play (a resume, or a rerun
  // of the ones that didn't pass), and which this run does.
  private carried: Record<string, CaseRecord> = {};
  private runIds: string[] | null = null;
  private scope: RunInfo["scope"] = "all";
  private runBlocks: RunBlocks | null = null;
  private lastRun: string | null = null;
  private runInfo: { choice: RunChoice; startedAt: number; endedAt: number | null; setup: Step[] } | null = null;
  // Just the result: failed steps already tried again, and failures handled.
  private readonly tries = new Map<string, number>();
  private handled = new WeakSet<object>();

  constructor(
    readonly rootUid: string,
    private readonly env: RunnerEnv,
  ) {
    this.panel = new ProofPanel((action) => this.act(action));
  }

  private get storageKey(): string {
    return `proof:run:${this.env.graph}:${this.rootUid}`;
  }

  private readRecord(): RunRecord | null {
    try {
      const record = JSON.parse(localStorage.getItem(this.storageKey) ?? "null") as RunRecord | null;
      return this.runKit && record?.records && recordFits(record, hash(this.runKit), this.env.build?.commit ?? null) ? record : null;
    } catch {
      return null;
    }
  }

  private writeRecord(record: RunRecord | null): void {
    try {
      if (record) localStorage.setItem(this.storageKey, JSON.stringify(record));
      else localStorage.removeItem(this.storageKey);
    } catch {
      // Without storage a reload starts over; the run itself is unaffected.
    }
  }

  get running(): boolean {
    return Boolean(this.state && this.state.phase !== "done" && this.state.phase !== "stopped");
  }

  // The cases a run plays: written by hand, or approved.
  private get runKit(): Kit | null {
    return this.kit ? runnableKit(this.kit.kit) : null;
  }

  get pageKit(): PageKit | null {
    return this.kit;
  }

  // Re-reads the kit from the page; the run in progress keeps its own copy.
  async refresh(): Promise<void> {
    this.tree = await readTree(this.rootUid);
    try {
      if (!this.tree) throw new Error("The {{proof}} block is gone.");
      this.kit = pageKit(this.tree);
      this.error = null;
    } catch (error) {
      this.kit = null;
      this.error = describe(error);
    }
    const runs = (this.tree?.children ?? []).find((child) => child.string.trim().toLowerCase() === "runs");
    this.lastRun = runs?.children?.[0]?.string ? `Last run: ${runs.children[0].string}` : null;
    this.paint();
  }

  private warnings(): string[] {
    const notes: string[] = [];
    const env = this.env;
    const kit = this.kit?.kit;
    if (!kit) return notes;
    if (env.buildFor === this.rootUid) {
      for (const outcome of env.beforeLoad) {
        if (outcome.outcome === "skipped") notes.push(`Skipped fixture ${outcome.id}: ${outcome.detail}.`);
      }
    } else if (env.build && (kit.prepare?.some((fixture) => fixture.phase === "before-load") || kit.baseline)) {
      notes.push("This tab loaded its build for another kit, before this kit's before-load fixtures ran. Reload on this page to apply them.");
    }
    const outside = (kit.prepare ?? []).filter((fixture) => fixture.phase === "outside");
    if (outside.length) {
      notes.push(`Needs a dev machine for ${outside.map((fixture) => fixture.id).join(", ")} (database or shell work); those fixtures are skipped here.`);
    }
    // Proposed and rejected cases: the run card's folds say how many, and why.
    return notes;
  }

  private buildStatus(): BuildStatus {
    const config = this.tree ? rootConfig(this.tree) : { build: null, pr: null, kit: null };
    return buildStatus({
      config,
      loaded: this.env.build,
      mine: this.env.buildFor === this.rootUid,
      setup: this.env.setup?.rootUid === this.rootUid,
      loading: this.env.loading,
      buildError: this.env.buildError,
      needsDatabase: this.needsDatabase(),
      database: this.env.buildFor === this.rootUid ? this.env.database : null,
    });
  }

  private needsDatabase(): boolean {
    const kit = this.kit?.kit;
    return kit ? kitNeedsDatabase(kit, fixturesFor(kit, this.env)) : false;
  }

  // What this kit needs before Run, one line per need that applies.
  checklist(): CheckItem[] {
    const config = this.tree ? rootConfig(this.tree) : { build: null, pr: null, kit: null };
    const env = this.env;
    const mine = env.buildFor === this.rootUid;
    const loaded = env.build;
    const setup = env.setup?.rootUid === this.rootUid ? env.setup : null;
    const status = this.buildStatus();
    return checklist({
      version: env.version,
      requested: Boolean(config.build || config.pr),
      wanted: status.wanted,
      loading: env.loading,
      loaded: loaded ? { branch: loaded.branch, commit: loaded.commit, pointed: loaded.pointed } : null,
      other: status.other,
      behind: status.behind,
      buildError: mine ? env.buildError : null,
      helper: mine ? env.helper : null,
      setup: setup
        ? {
            branch: setup.branch,
            apply: setup.apply.map((fixture) => fixture.why),
            skip: setup.skip.map(({ fixture, reason }) => `${fixture.why} (${reason})`),
          }
        : null,
      beforeLoad: mine ? env.beforeLoad.filter((item) => item.outcome !== "skipped") : [],
      database: mine && this.needsDatabase() ? (env.database ?? { state: "checking", detail: "" }) : null,
      byHand: this.runKit?.cases.filter((item) => item.steps.length === 0 && item.intent).length ?? 0,
      agentSeen: Date.now() - env.agentSeenAt < AGENT_FRESH_MS,
    });
  }

  view(): PanelView {
    const config = this.tree ? rootConfig(this.tree) : { build: null, pr: null, kit: null };
    const record = this.state ? null : this.readRecord();
    const items = this.checklist();
    const merged = this.state ? this.mergedState(this.state) : null;
    return {
      title: this.kit?.kit.title ?? this.kit?.kit.name ?? config.kit ?? "Proof kit",
      kitName: this.kit?.kit.name ?? null,
      checklist: items,
      blocked: runBlocked(items),
      error: this.error,
      warnings: this.warnings(),
      machine: merged,
      blocks: { cases: this.runBlocks?.cases ?? {}, step: this.stepUid() },
      resumable:
        record && record.nextCase > 0 && record.nextCase < (this.runKit?.cases.length ?? 0)
          ? { caseIndex: record.nextCase, results: Object.fromEntries(Object.entries(record.records).map(([id, item]) => [id, item.verdict])) }
          : null,
      lastRun: this.lastRun,
      kit: this.kitSummary(),
      run: this.runView(),
      agent: Date.now() - this.env.agentSeenAt < AGENT_FRESH_MS,
    };
  }

  // The run's state across every case of the kit, in kit order: the cases
  // this run doesn't play show the records carried from before.
  private mergedState(state: MachineState): MachineState {
    const all = this.runKit?.cases ?? [];
    if (all.length === state.plan.length && all.every((item, index) => state.plan[index]?.id === item.id)) return state;
    const playing = new Map(state.plan.map((item) => [item.id, item]));
    const plan = all.map((item): PlanCase => {
      const live = playing.get(item.id);
      if (live) return live;
      const record = this.carried[item.id] ?? null;
      return {
        id: item.id,
        title: item.title,
        proves: item.proves ?? null,
        checks: item.checks ?? null,
        judge: item.expect?.text ?? null,
        hasCheck: Boolean(item.expect?.js),
        intent: item.intent ?? null,
        verdict: record?.verdict ?? null,
        note: record ? [record.note, record.yourNote].filter(Boolean).join(" · ") || null : null,
        record,
        steps: item.steps.map((step) => ({ why: step.why, source: step.source ?? "kit" })),
      };
    });
    const current = state.plan[state.caseIndex];
    const caseIndex = current ? plan.findIndex((item) => item.id === current.id) : state.caseIndex < 0 ? -1 : plan.length;
    const carried = Object.fromEntries(Object.entries(this.carried).map(([id, record]) => [id, record.verdict]));
    return { ...state, plan, caseIndex, caseCount: plan.length, results: { ...carried, ...state.results } };
  }

  // What the page says about its kit, for the run card before Run.
  private kitSummary(): KitSummary | null {
    const page = this.kit?.kit;
    const run = this.runKit;
    if (!page || !run) return null;
    const cases = run.cases;
    const byHand = (item: (typeof cases)[number]): boolean => item.steps.length === 0 && Boolean(item.intent);
    const { bullets, other } = doneWhen(cases.map((item) => ({ id: item.id, proves: item.proves ?? null })));
    return {
      claim: page.claim ?? null,
      pr: page.target?.pr ?? null,
      ticket: ticketOf(page),
      cases: cases.length,
      steps: cases.reduce((sum, item) => sum + item.steps.length, 0),
      judge: cases.filter((item) => item.expect?.text && !item.expect.js && !byHand(item)).length,
      byHand: cases.filter(byHand).length,
      doneWhen: bullets,
      other: other.length,
      notTested: page.cases
        .filter((item) => decisionOf(item) === "rejected")
        .map((item) => ({ title: item.title, reason: item.decision?.reason ?? null })),
      proposed: page.cases.filter((item) => decisionOf(item) === "proposed").length,
    };
  }

  // What the bar needs beside the machine's state: each step's kind, and the
  // facts a copied result carries.
  private runView(): RunInfo | null {
    const info = this.runInfo;
    const machine = this.machine;
    if (!info || !machine) return null;
    const kinds: Record<string, StepKind[]> = { setup: info.setup.map(kindOfStep) };
    const steps: Record<string, string[]> = {};
    for (const item of machine.kit.cases) {
      kinds[item.id] = item.steps.map(kindOfStep);
      steps[item.id] = item.steps.map((step) => step.why);
    }
    const page = this.kit?.kit;
    const build = this.env.build;
    const behind = this.buildStatus().behind;
    const facts: RunFacts = {
      title: page?.title ?? page?.name ?? "Proof kit",
      pr: page?.target?.pr ?? build?.pr ?? null,
      ticket: page ? ticketOf(page) : null,
      page: page ? `proof/${page.name}` : null,
      build: build ? (build.commit ? build.commit.slice(0, 7) : build.branch) : null,
      latest: build?.prHead ? !behind : null,
      when: stamp(new Date(info.startedAt)),
      how: CHOICE_WORDS[info.choice],
      steps,
    };
    return { choice: info.choice, scope: this.scope, kinds, startedAt: info.startedAt, endedAt: info.endedAt, facts, rerun: this.rerunIds().length };
  }

  // The block of the step running now (or failed), if it has one.
  private stepUid(): string | null {
    const state = this.state;
    if (!state?.caseId || state.caseIndex < 0) return null;
    return this.runBlocks?.steps[state.caseId]?.[state.stepIndex] ?? null;
  }

  paint(): void {
    const view = this.view();
    this.panel.update(view);
    this.mark(view.machine);
  }

  // Colors the case blocks by verdict, tints the step block running now and
  // dims the steps done, with one stylesheet keyed by block uid: it marks
  // every rendering of a block, the panel's and the page's, and Roam
  // re-rendering a block doesn't wipe it.
  private mark(view: PanelView["machine"]): void {
    let style = document.getElementById(MARKS_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = MARKS_ID;
      document.head.append(style);
    }
    const blocks = this.runBlocks;
    if (!blocks || !view) {
      style.textContent = "";
      return;
    }
    const input = (uid: string): string => `.rm-block__input[id$="-${uid}"]`;
    const colors: Record<string, string> = { pass: "#15805a", fail: "#d9412e", skip: "#9aa3b2" };
    const rules: string[] = [];
    for (const item of view.plan) {
      const uid = blocks.cases[item.id];
      if (uid && item.verdict) rules.push(`${input(uid)} { box-shadow: inset 3px 0 0 ${colors[item.verdict]}; }`);
    }
    const state = this.state;
    if (state?.caseId && this.running) {
      const caseUid = blocks.cases[state.caseId];
      if (caseUid) rules.push(`${input(caseUid)} { box-shadow: inset 3px 0 0 #2c62c9; }`);
      const judging = state.phase === "waiting-verdict";
      (blocks.steps[state.caseId] ?? []).forEach((uid, index) => {
        if (!uid) return;
        if (judging || index < state.stepIndex) {
          rules.push(`${input(uid)} { opacity: .55; }`);
        } else if (index === state.stepIndex) {
          const color = state.phase === "step-failed" ? "rgba(217, 65, 46, .14)" : "rgba(44, 98, 201, .12)";
          rules.push(`${input(uid)} { background: ${color}; border-radius: 4px; }`);
        }
      });
    }
    style.textContent = rules.join("\n");
  }

  private async act(action: PanelAction): Promise<string | null> {
    try {
      if (action.kind === "run") return await this.start();
      if (action.kind === "restart") return await this.restart();
      if (action.kind === "resume") return await this.start({ from: this.readRecord()?.nextCase ?? 0 });
      if (action.kind === "rerun") return await this.start({ only: this.rerunIds() });
      if (action.kind === "open-kit") return await this.openKitPage();
      if (action.kind === "load") {
        await this.env.confirmSetup();
        return this.env.buildError;
      }
      if (action.kind === "reload") {
        location.reload();
        return null;
      }
      if (action.kind === "connect") {
        await this.env.connect();
        return null;
      }
      if (action.kind === "disconnect") {
        await this.env.disconnect();
        return null;
      }
      if (action.kind === "check-database") {
        await this.env.checkDatabase();
        return null;
      }
      if (action.kind === "ask-agent") return await this.env.askAgent(this.rootUid);
      if (action.kind === "edit-step") {
        const uid = this.stepUid();
        if (!uid) return "This step has no block on the page to edit.";
        await roam().ui.rightSidebar.addWindow({ window: { type: "block", "block-uid": uid } });
        return null;
      }
      if (action.kind === "reset") {
        this.writeRecord(null);
        this.state = null;
        this.machine = null;
        this.carried = {};
        this.runIds = null;
        this.scope = "all";
        this.runBlocks = null;
        this.paint();
        return null;
      }
      if (action.kind === "done-by-hand") {
        const pending = this.state?.pending;
        if (!this.machine || pending?.kind !== "steps") return "No case is waiting to be done by hand.";
        return this.command("steps", {
          caseId: pending.caseId,
          steps: [{ why: "done by hand", do: { pause: 0 } }],
        });
      }
      if (action.kind !== "command") return null;
      if (action.cmd === "retry") return await this.retry();
      return this.command(action.cmd, action.args ?? {});
    } catch (error) {
      return describe(error);
    }
  }

  // Retry runs the failed step as its block reads now, so a step fixed in the
  // panel runs fixed. The rest of the run keeps the kit it started with.
  private async retry(): Promise<string | null> {
    const state = this.state;
    const pending = state?.pending;
    if (this.machine && pending?.kind === "check-failed") return this.command("retry");
    if (!this.machine || !state || pending?.kind !== "failure") return "No failed step to retry.";
    const uid = this.stepUid();
    const node = uid ? await readTree(uid) : null;
    if (!uid || !node || !this.runBlocks || blockText(node) === this.runBlocks.text[uid]) return this.command("retry");
    let step: Record<string, unknown>;
    try {
      step = stepFromBlock(node);
    } catch (error) {
      return `The step's block doesn't read as a step: ${describe(error)}`;
    }
    const error = this.command("steps", { caseId: pending.caseId, how: "replace-failed", by: "kit", steps: [step] });
    if (!error) this.runBlocks.text[uid] = blockText(node);
    return error;
  }

  // A command to the run: from the panel ("hud"), or from an agent through
  // the runner's tools ("socket"), which can't allow js or give a verdict.
  command(cmd: string, args: Record<string, unknown> = {}, source: "hud" | "socket" = "hud"): string | null {
    if (!this.machine) return "Nothing is running. Press Run.";
    const result = this.machine.command(source, cmd, args);
    this.state = this.machine.state();
    this.paint();
    return result.ok ? null : result.error;
  }

  // What an agent reads first: the kit's cases, what's needed before Run,
  // and where the run stands.
  agentStatus(): Record<string, unknown> {
    const view = this.view();
    const state = this.state;
    return {
      kit: this.kit?.kit.name ?? null,
      title: view.title,
      rootUid: this.rootUid,
      error: view.error,
      checklist: view.checklist.map(({ label, state: met, detail }) => ({ label, state: met, detail })),
      runBlocked: view.blocked,
      cases: (this.runKit?.cases ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        intent: item.intent ?? null,
        expect: item.expect ?? null,
        steps: item.steps.map((step) => step.why),
        verdict: view.machine?.results[item.id] ?? null,
      })),
      run: state
        ? {
            phase: state.phase,
            caseId: state.caseId,
            step: state.stepWhy,
            pending: state.pending,
            feed: state.feed.slice(-8).map((entry) => `${entry.kind}: ${entry.text}`),
          }
        : null,
      lastRun: view.lastRun,
    };
  }

  // Run controls an agent may use; verdicts and allowing js stay with the
  // person at the panel.
  async agentControl(action: string): Promise<string | null> {
    if (action === "run") return this.start();
    if (action === "retry") return this.retry();
    if (!AGENT_CONTROLS.includes(action)) return `Not a run control: ${action}. Use one of run, ${AGENT_CONTROLS.join(", ")}, retry.`;
    return this.command(action, {}, "socket");
  }

  // An agent's steps for the case waiting on them: written under the case's
  // block so the page keeps them, then handed to the run, where js waits
  // for an Allow in the panel.
  async agentAddSteps(caseId: string, raw: unknown): Promise<string | null> {
    const pending = this.state?.pending;
    if (!this.machine || pending?.kind !== "steps" || pending.caseId !== caseId) return `Case ${caseId} isn't waiting for steps.`;
    const steps = validateSteps(raw, "steps", [], "model");
    const caseUid = this.runBlocks?.cases[caseId];
    if (caseUid && this.runBlocks) {
      const nodes = steps.map((step) => ({ ...stepBlockOf(step), uid: roam().util.generateUID() }));
      await createTree(caseUid, nodes);
      this.runBlocks.steps[caseId] = nodes.map((node) => node.uid);
      for (const node of nodes) this.runBlocks.text[node.uid] = blockText(node);
    }
    return this.command("steps", { caseId, steps: raw, by: "model" }, "socket");
  }

  // An agent's fix for the failed step: the step's block rewritten (its why,
  // and its action under it), then run in place of the failed one.
  async agentFixStep(raw: unknown): Promise<string | null> {
    const pending = this.state?.pending;
    if (!this.machine || pending?.kind !== "failure" || !pending.caseId) return "No step has failed.";
    const { id: _id, ...fix } = (raw ?? {}) as Record<string, unknown>;
    const [step] = validateSteps([fix], "step", [], "model");
    const uid = this.stepUid();
    if (uid && this.runBlocks) {
      const block = stepBlockOf(step);
      for (const child of (await readTree(uid))?.children ?? []) {
        if (child.uid) await roam().data.block.delete({ block: { uid: child.uid } });
      }
      await roam().data.block.update({ block: { uid, string: block.string } });
      await createTree(uid, block.children ?? []);
      this.runBlocks.text[uid] = blockText(block);
    }
    return this.command("steps", { caseId: pending.caseId, how: "replace-failed", steps: [fix], by: "model" }, "socket");
  }

  // Starts a run: every case, the cases from `from` on (a resume), or only
  // those listed (the ones that didn't pass).
  async start(options: { from?: number; only?: string[] } = {}): Promise<string | null> {
    if (this.running) return "A run is already going.";
    await this.refresh();
    if (!this.kit) return this.error ?? "This page has no kit.";
    const blocked = runBlocked(this.checklist());
    if (blocked) return blocked;
    // Proposed and rejected cases stay on the page and don't run.
    const source = runnableKit(this.kit.kit);
    if (source.cases.length === 0) return "No case on this page is approved yet, so there's nothing to run.";
    const kit: Kit = JSON.parse(JSON.stringify(source)) as Kit;
    this.runBlocks = this.tree ? runBlocksFor(this.kit, this.tree, source) : null;
    const earlier = this.bestRecords();
    if (options.only) {
      const only = new Set(options.only);
      kit.cases = kit.cases.filter((item) => only.has(item.id));
      this.carried = Object.fromEntries(Object.entries(earlier).filter(([id]) => !only.has(id)));
      this.scope = "failed";
    } else if (options.from) {
      const record = this.readRecord();
      kit.cases = kit.cases.slice(Math.min(options.from, kit.cases.length - 1));
      this.carried = record ? { ...record.records } : {};
      this.scope = "resume";
    } else {
      this.carried = {};
      this.scope = "all";
    }
    if (kit.cases.length === 0) return "There's no case to run.";
    this.runIds = kit.cases.map((item) => item.id);
    const baseline = kit.baseline ? this.env.baselines.get(kit.baseline) : null;
    const setup = [...inSessionSteps(fixturesFor(kit, this.env)), ...smokeSteps(baseline?.smoke ?? [])];
    const context = contextFor(kit.name, this.env, runId());
    const { choice, pauseBetween } = this.panel.runSettings();
    const play = PLAY[choice];
    this.runInfo = { choice, startedAt: Date.now(), endedAt: null, setup };
    this.tries.clear();
    this.handled = new WeakSet();
    const journal = new Journal((event) => {
      if (event.type === "case-end" && this.machine) this.saveProgress(source, this.machine);
    });
    const executor = makePageExecutor({
      timeout: this.env.timeout,
      render: (state) => {
        this.state = state;
        this.paint();
        this.unattended(state);
      },
      target: (element, verb) => this.panel.target(element, verb),
      lead: () => play.leadMs,
      palette: (label) => this.env.palette.run(label),
      fill: (value) => fillIn(value, context),
      note: (text) => {
        this.machine?.command("socket", "note", { text });
      },
    });
    const machine = new Machine({
      kit,
      setup,
      journal,
      executor,
      mode: pauseBetween ? "case" : play.mode,
      speed: play.speed,
      dwellMs: play.dwellMs,
      holdOnCheckFail: play.holdOnCheckFail,
      expand: makeExpander(this.env.recipes),
    });
    this.machine = machine;
    this.state = machine.state();
    this.paint();
    this.finished = machine
      .run()
      .then(() => this.finish(machine, source))
      .catch((error: unknown) => this.panel.showError(`The run stopped: ${describe(error)}`));
    return null;
  }

  // Just the result: a step that doesn't work is tried once more, then its
  // case is skipped, so the run reaches the end without anyone at the screen.
  private unattended(state: MachineState): void {
    const pending = state.pending;
    if (this.runInfo?.choice !== "result" || pending?.kind !== "failure" || this.handled.has(pending)) return;
    this.handled.add(pending);
    const key = `${pending.caseId}/${pending.stepId}`;
    const tries = this.tries.get(key) ?? 0;
    this.tries.set(key, tries + 1);
    const why = state.stepWhy ?? "a step";
    setTimeout(() => {
      if (this.state?.pending !== pending) return;
      if (tries === 0) this.command("retry");
      else this.command("skip-case", { note: `"${why}" didn't work twice: ${pending.error.split("\n")[0].slice(0, 200)}` });
    }, 600);
  }

  // Ends the run going now, then plays every case again from setup.
  private async restart(): Promise<string | null> {
    if (this.running) {
      this.machine?.stop();
      await this.finished;
    }
    return this.start();
  }

  stop(): void {
    this.machine?.stop();
  }

  private records(machine: Machine): Record<string, CaseRecord> {
    return { ...this.carried, ...machine.caseRecords };
  }

  // Every case's latest record: carried from before, or from the run just played.
  private bestRecords(): Record<string, CaseRecord> {
    const records: Record<string, CaseRecord> = { ...this.carried };
    for (const item of this.state?.plan ?? []) if (item.record) records[item.id] = item.record;
    return records;
  }

  // The cases that didn't pass: what "Run the ones that didn't pass" plays.
  private rerunIds(): string[] {
    const records = this.bestRecords();
    return (this.runKit?.cases ?? []).filter((item) => records[item.id] && records[item.id].verdict !== "pass").map((item) => item.id);
  }

  // A run ends wherever its last case left Roam; this goes back to the kit.
  private async openKitPage(): Promise<string | null> {
    const uid = await pageOf(this.rootUid);
    if (!uid) return "Couldn't find the kit's page.";
    await roam().ui.mainWindow.openPage({ page: { uid } });
    return null;
  }

  private saveProgress(source: Kit, machine: Machine): void {
    const records = this.records(machine);
    const next = source.cases.findIndex((item) => !(item.id in records));
    this.writeRecord({
      kitHash: hash(source),
      nextCase: next < 0 ? source.cases.length : next,
      records,
      commit: this.env.build?.commit ?? null,
    });
  }

  private async finish(machine: Machine, source: Kit): Promise<void> {
    if (this.runInfo) this.runInfo.endedAt = Date.now();
    this.state = machine.state();
    const stopped = this.state.phase === "stopped";
    const records = this.records(machine);
    if (stopped) this.saveProgress(source, machine);
    else this.writeRecord(null);
    try {
      await this.writeRunLog(source, records, Object.keys(machine.caseRecords), stopped);
    } catch (error) {
      this.panel.showError(`Couldn't write the run log: ${describe(error)}`);
    }
    await this.refresh();
  }

  // A line in the {{proof}} block's runs list, newest first, with a child
  // per case, so whoever opens the page sees what passed on which build.
  private async writeRunLog(source: Kit, records: Record<string, CaseRecord>, ran: string[], stopped: boolean): Promise<void> {
    const tree = await readTree(this.rootUid);
    if (!tree) return;
    let runs = (tree.children ?? []).find((child) => child.string.trim().toLowerCase() === "runs");
    if (!runs?.uid) {
      const uid = roam().util.generateUID();
      await roam().data.block.create({
        location: { "parent-uid": this.rootUid, order: "last" },
        block: { string: "runs", uid, open: false },
      });
      runs = { uid, string: "runs" };
    }
    const count = (verdict: Verdict): number => source.cases.filter((item) => records[item.id]?.verdict === verdict).length;
    const passed = count("pass");
    const failed = count("fail");
    const skipped = count("skip");
    const notRun = source.cases.length - passed - failed - skipped;
    const build = this.env.build;
    const summary = [
      `${passed === source.cases.length ? "✓" : "✗"} ${passed}/${source.cases.length} passed`,
      failed ? `${failed} failed` : null,
      skipped ? `${skipped} couldn't run` : null,
      notRun ? `${notRun} not run` : null,
      stopped ? "stopped" : null,
      this.scope === "failed" ? "re-ran the cases that didn't pass" : this.scope === "resume" ? "resumed" : null,
      build ? `build ${build.branch}${build.commit ? ` @ ${build.commit.slice(0, 7)}` : ""}` : "no build loaded",
      this.runInfo ? CHOICE_WORDS[this.runInfo.choice] : "",
      stamp(new Date()),
      await userName(),
    ]
      .filter(Boolean)
      .join(" · ");
    const fresh = new Set(ran);
    await createTree(
      runs.uid as string,
      [
        {
          string: summary,
          open: false,
          children: source.cases.map((item) => ({
            string: logLine(item.title, records[item.id] ?? null, Boolean(records[item.id]) && !fresh.has(item.id)),
          })),
        },
      ],
      0,
    );
  }

  status(): Record<string, unknown> {
    const view = this.view();
    return {
      rootUid: this.rootUid,
      error: this.error,
      kit: this.kit?.kit.name ?? null,
      running: this.running,
      state: view.machine,
      checklist: view.checklist,
      warnings: this.warnings(),
    };
  }
}
