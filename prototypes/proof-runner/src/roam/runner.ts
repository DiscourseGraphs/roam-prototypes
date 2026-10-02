import { inSessionSteps, smokeSteps } from "../core/fixtures";
import { Journal } from "../core/journal";
import type { Baseline, Fixture, Kit, Verdict } from "../core/kit";
import { Machine, type MachineState } from "../core/machine";
import { makeExpander, type RecipeBook } from "../core/recipes";
import { fill, fillDeep, type TemplateContext } from "../core/template";
import type { ExtensionAPI, LoadedBuild, PaletteRegistry } from "./build-loader";
import { evaluate, makePageExecutor } from "./executor";
import { pageKit, rootConfig, type BlockNode, type PageKit } from "./page-kit";
import { ProofPanel, type PanelAction, type PanelView } from "./panel";
import { createTree, readTree, roam, userName } from "./roam";

// One {{proof}} block's runs: reads the kit off the page, runs it on the
// machine the live rehearsal uses, shows it in every panel mounted for the
// block, marks the case and step blocks, keeps enough to resume after a
// reload, and writes a line to the block's run log when a run finishes.

export type FixtureOutcome = {
  id: string;
  why: string;
  outcome: "ok" | "kept" | "skipped" | "failed";
  detail?: string;
};

// Before-load fixtures that would change the graph, waiting for a person to
// say go before the build loads.
export type SetupPlan = {
  rootUid: string;
  kit: string;
  branch: string;
  head: string | null;
  apply: Fixture[];
  // Fixtures that need a key this browser doesn't have; they're skipped.
  skip: Array<{ fixture: Fixture; reason: string }>;
  kept: Fixture[];
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
};

type RunRecord = {
  kitHash: string;
  nextCase: number;
  results: Record<string, Verdict>;
  notes: Record<string, string>;
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

const ICON: Record<Verdict, string> = { pass: "✓", fail: "✗", skip: "⏭" };

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
export const planBeforeLoad = async (
  fixtures: Fixture[],
  context: TemplateContext,
): Promise<Pick<SetupPlan, "apply" | "skip" | "kept">> => {
  const plan: Pick<SetupPlan, "apply" | "skip" | "kept"> = { apply: [], skip: [], kept: [] };
  for (const fixture of fixtures.filter((item) => item.phase === "before-load")) {
    try {
      if (fixture.check && "js" in fixture.check && (await evaluate(fill(fixture.check.js, context)))) {
        plan.kept.push(fixture);
        continue;
      }
    } catch {
      // A check that throws counts as not holding; the apply decides.
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

export const applyBeforeLoad = async (
  plan: Pick<SetupPlan, "apply" | "skip" | "kept">,
  context: TemplateContext,
): Promise<FixtureOutcome[]> => {
  const outcomes: FixtureOutcome[] = [
    ...plan.kept.map((fixture): FixtureOutcome => ({ id: fixture.id, why: fixture.why, outcome: "kept" })),
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

export const fixturesFor = (kit: Kit, env: RunnerEnv): Fixture[] => {
  const baseline = kit.baseline ? env.baselines.get(kit.baseline) : null;
  if (kit.baseline && !baseline) throw new Error(`This runner has no baseline ${kit.baseline}.`);
  return [...(baseline?.prepare ?? []), ...(kit.prepare ?? [])];
};

const MARKS_ID = "proof-run-marks";

export class ProofRun {
  readonly panel: ProofPanel;
  private tree: BlockNode | null = null;
  private kit: PageKit | null = null;
  private error: string | null = null;
  private machine: Machine | null = null;
  private state: MachineState | null = null;
  private earlier: { results: Record<string, Verdict>; notes: Record<string, string> } | null = null;
  private offset = 0;
  private lastRun: string | null = null;

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
      return record && this.kit && record.kitHash === hash(this.kit.kit) ? record : null;
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
    if (env.buildError) notes.push(env.buildError);
    const kit = this.kit?.kit;
    if (!kit) return notes;
    if (env.buildFor === this.rootUid) {
      for (const outcome of env.beforeLoad) {
        if (outcome.outcome === "skipped") notes.push(`Skipped fixture ${outcome.id}: ${outcome.detail}.`);
        if (outcome.outcome === "failed") notes.push(`Fixture ${outcome.id} failed before load: ${outcome.detail}`);
      }
    } else if (env.build && (kit.prepare?.some((fixture) => fixture.phase === "before-load") || kit.baseline)) {
      notes.push("This tab loaded its build for another kit, before this kit's before-load fixtures ran. Reload on this page to apply them.");
    }
    const outside = (kit.prepare ?? []).filter((fixture) => fixture.phase === "outside");
    if (outside.length) {
      notes.push(`Needs a dev machine for ${outside.map((fixture) => fixture.id).join(", ")} (database or shell work); those fixtures are skipped here.`);
    }
    return notes;
  }

  view(): PanelView {
    const config = this.tree ? rootConfig(this.tree) : { build: null, pr: null, kit: null };
    const loaded = this.env.build;
    const mine = this.env.buildFor === this.rootUid;
    const wanted = config.build ?? (config.pr && loaded && mine ? loaded.branch : null);
    const setup = this.env.setup?.rootUid === this.rootUid ? this.env.setup : null;
    let mismatch: string | null = null;
    if (wanted && loaded && loaded.branch !== wanted) mismatch = `this page wants ${wanted}`;
    else if ((wanted || config.pr) && !loaded && !this.env.buildError && !this.env.loading && !setup) mismatch = "reload to load it";
    else if (loaded?.prHead && loaded.commit && !loaded.prHead.startsWith(loaded.commit.slice(0, 7))) {
      mismatch = `PR head is ${loaded.prHead.slice(0, 7)}; CI may still be building it`;
    }
    const record = this.state ? null : this.readRecord();
    const merged = this.state
      ? {
          ...this.state,
          caseIndex: this.state.caseIndex + this.offset,
          caseCount: this.state.caseCount + this.offset,
          results: { ...(this.earlier?.results ?? {}), ...this.state.results },
          plan: [
            ...(this.kit?.kit.cases.slice(0, this.offset) ?? []).map((item) => ({
              id: item.id,
              title: item.title,
              proves: item.proves ?? null,
              checks: item.checks ?? null,
              intent: item.intent ?? null,
              verdict: this.earlier?.results[item.id] ?? null,
              note: this.earlier?.notes[item.id] ?? null,
              steps: item.steps.map((step) => ({ why: step.why, source: step.source ?? "kit" })),
            })),
            ...this.state.plan,
          ],
        }
      : null;
    return {
      title: this.kit?.kit.title ?? this.kit?.kit.name ?? config.kit ?? "Proof kit",
      kitName: this.kit?.kit.name ?? null,
      build: {
        wanted: wanted ?? (config.pr ? `PR #${config.pr}` : null),
        loaded: loaded?.branch ?? null,
        commit: loaded?.commit ?? null,
        pr: config.pr,
        mismatch,
        loading: this.env.loading,
      },
      setup: setup
        ? {
            branch: setup.branch,
            apply: setup.apply.map((fixture) => fixture.why),
            skip: setup.skip.map(({ fixture, reason }) => `${fixture.why} (${reason})`),
          }
        : null,
      error: this.error,
      warnings: this.warnings(),
      machine: merged,
      resumable:
        record && record.nextCase > 0 && record.nextCase < (this.kit?.kit.cases.length ?? 0)
          ? { caseIndex: record.nextCase, results: record.results }
          : null,
      lastRun: this.lastRun,
    };
  }

  paint(): void {
    const view = this.view();
    this.panel.update(view);
    this.mark(view.machine);
  }

  // Colors the case blocks by verdict and tints the step block running now,
  // with one stylesheet keyed by block uid, so Roam re-rendering a block
  // doesn't wipe the marks.
  private mark(view: PanelView["machine"]): void {
    let style = document.getElementById(MARKS_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = MARKS_ID;
      document.head.append(style);
    }
    const kit = this.kit;
    if (!kit || !view) {
      style.textContent = "";
      return;
    }
    const colors: Record<string, string> = { pass: "#15805a", fail: "#d9412e", skip: "#9aa3b2" };
    const rules: string[] = [];
    for (const item of view.plan) {
      const uid = kit.blocks.cases[item.id];
      if (uid && item.verdict) {
        rules.push(`.rm-block__input[id$="-${uid}"] { box-shadow: inset 3px 0 0 ${colors[item.verdict]}; }`);
      }
    }
    const caseId = this.state?.caseId;
    const testCase = caseId ? kit.kit.cases.find((item) => item.id === caseId) : null;
    if (testCase && this.state && this.running) {
      const caseUid = kit.blocks.cases[testCase.id];
      if (caseUid) rules.push(`.rm-block__input[id$="-${caseUid}"] { box-shadow: inset 3px 0 0 #2c62c9; }`);
      const step = testCase.steps[this.state.stepIndex];
      const stepUid = step ? kit.blocks.steps[`${testCase.id}/${step.id}`] : null;
      if (stepUid) {
        const color = this.state.phase === "step-failed" ? "rgba(217, 65, 46, .14)" : "rgba(44, 98, 201, .12)";
        rules.push(`.rm-block__input[id$="-${stepUid}"] { background: ${color}; border-radius: 4px; }`);
      }
    }
    style.textContent = rules.join("\n");
  }

  private async act(action: PanelAction): Promise<string | null> {
    try {
      if (action.kind === "run") return await this.start(0);
      if (action.kind === "resume") return await this.start(this.readRecord()?.nextCase ?? 0);
      if (action.kind === "load") {
        await this.env.confirmSetup();
        return this.env.buildError;
      }
      if (action.kind === "reload") {
        location.reload();
        return null;
      }
      if (action.kind === "reset") {
        this.writeRecord(null);
        this.state = null;
        this.machine = null;
        this.earlier = null;
        this.offset = 0;
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
      return this.command(action.cmd, action.args ?? {});
    } catch (error) {
      return describe(error);
    }
  }

  command(cmd: string, args: Record<string, unknown> = {}): string | null {
    if (!this.machine) return "Nothing is running. Press Run.";
    const result = this.machine.command("hud", cmd, args);
    this.state = this.machine.state();
    this.paint();
    return result.ok ? null : result.error;
  }

  // Starts a run at case `from` (0 for all of them).
  async start(from: number): Promise<string | null> {
    if (this.running) return "A run is already going.";
    await this.refresh();
    if (!this.kit) return this.error ?? "This page has no kit.";
    if (this.env.setup?.rootUid === this.rootUid) return "Set up and load the build first.";
    const source = this.kit.kit;
    const kit: Kit = JSON.parse(JSON.stringify(source)) as Kit;
    const record = from > 0 ? this.readRecord() : null;
    this.offset = from > 0 ? Math.min(from, kit.cases.length - 1) : 0;
    kit.cases = kit.cases.slice(this.offset);
    this.earlier = record ? { results: record.results, notes: record.notes } : null;
    const baseline = kit.baseline ? this.env.baselines.get(kit.baseline) : null;
    const setup = [...inSessionSteps(fixturesFor(kit, this.env)), ...smokeSteps(baseline?.smoke ?? [])];
    const context = contextFor(kit.name, this.env, runId());
    const journal = new Journal((event) => {
      if (event.type === "case-end" && this.machine) this.saveProgress(source);
    });
    const executor = makePageExecutor({
      timeout: this.env.timeout,
      render: (state) => {
        this.state = state;
        this.paint();
      },
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
      mode: "auto",
      speed: 1,
      dwellMs: 700,
      expand: makeExpander(this.env.recipes),
    });
    this.machine = machine;
    this.state = machine.state();
    this.paint();
    void machine
      .run()
      .then(() => this.finish(machine, source))
      .catch((error: unknown) => this.panel.showError(`The run stopped: ${describe(error)}`));
    return null;
  }

  stop(): void {
    this.machine?.stop();
  }

  private results(machine: Machine): { results: Record<string, Verdict>; notes: Record<string, string> } {
    return {
      results: { ...(this.earlier?.results ?? {}), ...machine.results },
      notes: { ...(this.earlier?.notes ?? {}), ...machine.notes },
    };
  }

  private saveProgress(source: Kit): void {
    if (!this.machine) return;
    const { results, notes } = this.results(this.machine);
    const judged = source.cases.findIndex((item) => !(item.id in results));
    this.writeRecord({
      kitHash: hash(source),
      nextCase: judged < 0 ? source.cases.length : judged,
      results,
      notes,
      commit: this.env.build?.commit ?? null,
    });
  }

  private async finish(machine: Machine, source: Kit): Promise<void> {
    this.state = machine.state();
    const stopped = this.state.phase === "stopped";
    const { results, notes } = this.results(machine);
    if (!stopped) {
      this.writeRecord(null);
      try {
        await this.writeRunLog(source, results, notes);
      } catch (error) {
        this.panel.showError(`Couldn't write the run log: ${describe(error)}`);
      }
    }
    await this.refresh();
  }

  // A line in the {{proof}} block's runs list, newest first, with a child
  // per case, so whoever opens the page sees what passed on which build.
  private async writeRunLog(source: Kit, results: Record<string, Verdict>, notes: Record<string, string>): Promise<void> {
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
    const passed = source.cases.filter((item) => results[item.id] === "pass").length;
    const build = this.env.build;
    const summary = [
      `${passed === source.cases.length ? "✓" : "✗"} ${passed}/${source.cases.length} passed`,
      build ? `build ${build.branch}${build.commit ? ` @ ${build.commit.slice(0, 7)}` : ""}` : "no build loaded",
      stamp(new Date()),
      await userName(),
    ]
      .filter(Boolean)
      .join(" · ");
    await createTree(
      runs.uid as string,
      [
        {
          string: summary,
          open: false,
          children: source.cases.map((item) => {
            const verdict = results[item.id];
            const note = notes[item.id] ? `: ${notes[item.id].split("\n")[0].slice(0, 300)}` : "";
            return { string: `${verdict ? ICON[verdict] : "○"} ${item.title}${note}` };
          }),
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
      setup: view.setup,
      warnings: this.warnings(),
    };
  }
}
