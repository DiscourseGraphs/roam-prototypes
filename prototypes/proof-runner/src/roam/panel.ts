import type { MachineState } from "../core/machine";
import { SPEEDS } from "../core/machine";

// The run panel inside a {{proof}} block: the live HUD's layout (what the kit
// proves, every case with its steps, what's waiting on you, a feed, the
// controls) moved into the page, where it calls the machine directly instead
// of through a Playwright binding. It sits in a shadow root, so kit selectors
// and proof.byText never match the panel's own buttons and text.

export type BuildInfo = {
  // What the page asks for, and what this tab actually loaded.
  wanted: string | null;
  loaded: string | null;
  commit: string | null;
  pr: number | null;
  // Set when the loaded build isn't the one the page asks for.
  mismatch: string | null;
  loading?: boolean;
};

// Before-load fixtures that would change the graph, shown before the build
// loads so nothing graph-wide changes without a click.
export type SetupView = {
  branch: string;
  apply: string[];
  skip: string[];
};

export type PanelView = {
  title: string;
  kitName: string | null;
  build: BuildInfo;
  setup: SetupView | null;
  // Why Run is off (the build isn't this kit's, or isn't loaded); null to run.
  blocked: string | null;
  // Kit or page problems that stop a run, e.g. a block the parser can't read.
  error: string | null;
  // Things to know before running: skipped fixtures, needs this tab can't meet.
  warnings: string[];
  machine: MachineState | null;
  // Cases already judged in an earlier, unfinished run of this kit.
  resumable: { caseIndex: number; results: Record<string, string> } | null;
  // The last finished run, from the page's run log.
  lastRun: string | null;
};

export type PanelAction =
  | { kind: "run" }
  | { kind: "load" }
  | { kind: "resume" }
  | { kind: "reload" }
  | { kind: "reset" }
  | { kind: "done-by-hand" }
  | { kind: "command"; cmd: string; args?: Record<string, unknown> };

const CSS = `
  :host { all: initial; display: block; }
  .panel { box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; max-width: 560px;
    padding: 10px 12px; margin: 4px 0; border-radius: 8px; border: 1px solid #d5dbe5; background: #fbfcfe;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2733; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .badge { font: 600 10.5px/1 ui-monospace, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase;
    padding: 4px 6px; border-radius: 4px; background: #e3e7ee; color: #3b4556; }
  .badge.running { background: #2c62c9; color: #fff; }
  .badge.paused, .badge.waiting-next, .badge.dwell { background: #f3d58a; color: #5a3d00; }
  .badge.step-failed, .badge.error { background: #d9412e; color: #fff; }
  .badge.waiting-steps, .badge.waiting-approval, .badge.waiting-verdict { background: #7c4dcc; color: #fff; }
  .badge.done { background: #15805a; color: #fff; }
  .badge.stopped { background: #6b7385; color: #fff; }
  .title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .build { font: 11.5px ui-monospace, Menlo, monospace; color: #4b5567; }
  .build.bad { color: #b3261e; }
  .claim { font-weight: 600; }
  .claim:empty, .given:empty, .where:empty { display: none; }
  .given, .muted { color: #5d6778; font-size: 12px; }
  .where { color: #3b4556; font-size: 12px; }
  .warn { color: #8a5a06; font-size: 12px; background: #fff6df; border-radius: 4px; padding: 4px 6px; }
  .err { color: #b3261e; font-size: 12px; white-space: pre-wrap; }
  .err:empty { display: none; }
  .plan { overflow-y: auto; max-height: 46vh; border-top: 1px solid #e3e7ee; padding-top: 6px; }
  .plan:empty { display: none; }
  .case { margin: 0 0 6px; }
  .case-line { display: flex; gap: 6px; align-items: baseline; }
  .icon { width: 1.1em; flex: none; text-align: center; }
  .icon.pass { color: #15805a; }
  .icon.fail { color: #d9412e; }
  .icon.skip { color: #8a93a3; }
  .icon.now { color: #2c62c9; }
  .case.current > .case-line { font-weight: 600; }
  .case.later { color: #8a93a3; }
  .proves, .note { color: #5d6778; font-size: 12px; margin-left: 1.7em; }
  .note.fail { color: #b3261e; }
  .steps { list-style: none; margin: 3px 0 2px 1.7em; padding: 0; }
  .steps li { display: flex; gap: 6px; font-size: 12.5px; color: #3b4556; }
  .steps li.done { color: #8a93a3; }
  .steps li.now { color: #10233f; background: #e4ecfb; border-radius: 4px; }
  .pending { padding: 8px; border-radius: 6px; background: #f0f2f7; }
  .pending:empty { display: none; }
  .pending p { margin: 0 0 6px; }
  .pending ul { margin: 0 0 6px; padding-left: 18px; }
  pre { margin: 6px 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    font: 11px/1.45 ui-monospace, Menlo, monospace; background: #fff; border: 1px solid #e3e7ee;
    padding: 6px 7px; border-radius: 4px; }
  .feed { border-top: 1px solid #e3e7ee; padding-top: 5px; font-size: 12px; }
  .feed:empty { display: none; }
  .feed div { display: flex; gap: 6px; color: #4b5567; }
  .feed .who { flex: none; width: 3.8em; color: #8a93a3; }
  .feed .pass { color: #15805a; }
  .feed .fail { color: #b3261e; }
  .feed .wait { color: #8a5a06; }
  button { font: 600 12px system-ui, -apple-system, sans-serif; color: #1f2733; background: #fff;
    border: 1px solid #c9d0db; border-radius: 6px; padding: 4px 9px; cursor: pointer; }
  button:hover { background: #f0f2f7; }
  button:focus-visible { outline: 2px solid #2c62c9; outline-offset: 1px; }
  button.primary { background: #2c62c9; border-color: #2c62c9; color: #fff; }
  button.go { background: #15805a; border-color: #15805a; color: #fff; }
  button.no { background: #d9412e; border-color: #d9412e; color: #fff; }
  button.hot { box-shadow: 0 0 0 2px #e7b04c; }
  button[hidden] { display: none; }
  .speed { min-width: 36px; text-align: center; font: 12px ui-monospace, Menlo, monospace; }
`;

const ICONS: Record<string, string> = { pass: "✓", fail: "✗", skip: "⏭" };
const MODES = ["auto", "step", "case"];
const FEED_SHOWN = 6;
const WHO: Record<string, string> = {
  you: "you",
  agent: "agent",
  pass: "check",
  fail: "check",
  wait: "waiting",
  case: "case",
  step: "",
  note: "note",
};

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const button = (label: string, action: string, extra: { className?: string; title?: string; args?: unknown } = {}): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.dataset.action = action;
  if (extra.className) node.className = extra.className;
  if (extra.title) node.title = extra.title;
  if (extra.args !== undefined) node.dataset.args = JSON.stringify(extra.args);
  return node;
};

type Parts = {
  root: ShadowRoot;
  badge: HTMLElement;
  title: HTMLElement;
  build: HTMLElement;
  claim: HTMLElement;
  given: HTMLElement;
  where: HTMLElement;
  notices: HTMLElement;
  plan: HTMLElement;
  pending: HTMLElement;
  feed: HTMLElement;
  controls: HTMLElement;
  err: HTMLElement;
};

export class ProofPanel {
  private view: PanelView | null = null;
  private readonly mounts = new Map<HTMLElement, Parts>();
  private flash = "";
  private flashTimer = 0;
  private stopArmed = 0;

  constructor(private readonly onAction: (action: PanelAction) => Promise<string | null> | string | null) {}

  // Puts a panel in host. Roam re-renders blocks, so the same panel may be
  // mounted again; every mount shows the same state.
  attach(host: HTMLElement): void {
    if (this.mounts.has(host)) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = CSS;
    const panel = el("div", undefined, "panel");
    const head = el("div", undefined, "row");
    const badge = el("span", "idle", "badge");
    const title = el("span", "", "title");
    head.append(badge, title);
    const parts: Parts = {
      root,
      badge,
      title,
      build: el("div", "", "build"),
      claim: el("div", "", "claim"),
      given: el("div", "", "given"),
      where: el("div", "", "where"),
      notices: el("div"),
      plan: el("div", undefined, "plan"),
      pending: el("div", undefined, "pending"),
      feed: el("div", undefined, "feed"),
      controls: el("div", undefined, "row controls"),
      err: el("div", "", "err"),
    };
    parts.feed.setAttribute("aria-live", "polite");
    parts.err.setAttribute("role", "status");
    panel.append(head, parts.build, parts.claim, parts.given, parts.where, parts.notices, parts.plan, parts.pending, parts.feed, parts.controls, parts.err);
    root.append(style, panel);
    // Roam handles mouse and key events on blocks; keep ours to ourselves so a
    // click on Run doesn't also open the block for editing.
    for (const type of ["mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "pointerdown"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.addEventListener("click", (event) => {
      const target = (event.target as Element | null)?.closest?.("button") as HTMLButtonElement | null;
      if (target) void this.press(target);
    });
    this.mounts.set(host, parts);
    this.paint(parts);
  }

  detachGone(): void {
    for (const host of [...this.mounts.keys()]) {
      if (!host.isConnected) this.mounts.delete(host);
    }
  }

  get attached(): number {
    this.detachGone();
    return this.mounts.size;
  }

  update(view: PanelView): void {
    this.view = view;
    this.detachGone();
    for (const parts of this.mounts.values()) this.paint(parts);
  }

  private async press(target: HTMLButtonElement): Promise<void> {
    const action = target.dataset.action ?? "";
    const args = target.dataset.args ? (JSON.parse(target.dataset.args) as Record<string, unknown>) : {};
    const state = this.view?.machine ?? null;
    let request: PanelAction | null = null;
    if (action === "run" || action === "load" || action === "resume" || action === "reload" || action === "reset" || action === "done-by-hand") {
      request = { kind: action };
    } else if (action === "toggle") {
      request = { kind: "command", cmd: state?.paused ? "resume" : "pause" };
    } else if (action === "slower" || action === "faster") {
      const current = state ? state.speed : 1;
      const index = SPEEDS.findIndex((value) => value >= current);
      const at = index < 0 ? SPEEDS.length - 1 : index;
      const next = action === "faster" ? Math.min(SPEEDS.length - 1, at + 1) : Math.max(0, at - 1);
      request = { kind: "command", cmd: "speed", args: { speed: SPEEDS[next] } };
    } else if (action === "mode") {
      const current = state ? state.mode : "auto";
      request = { kind: "command", cmd: "mode", args: { mode: MODES[(MODES.indexOf(current) + 1) % MODES.length] } };
    } else if (action === "stop") {
      if (Date.now() < this.stopArmed) {
        this.stopArmed = 0;
        request = { kind: "command", cmd: "stop" };
      } else {
        this.stopArmed = Date.now() + 3000;
        this.repaint();
        setTimeout(() => this.repaint(), 3100);
        return;
      }
    } else {
      request = { kind: "command", cmd: action, args };
    }
    if (!request) return;
    const error = await this.onAction(request);
    if (error) this.showError(error);
  }

  showError(message: string): void {
    this.flash = message;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash = "";
      this.repaint();
    }, 6000);
    this.repaint();
  }

  private repaint(): void {
    for (const parts of this.mounts.values()) this.paint(parts);
  }

  private paint(parts: Parts): void {
    const view = this.view;
    if (!view) return;
    const state = view.machine;
    const phase = view.error ? "error" : state ? state.phase : "idle";
    parts.badge.className = `badge ${phase}`;
    parts.badge.textContent = phase.replace("-", " ");
    parts.title.textContent = view.title;
    const build = view.build;
    const buildText = [
      build.loaded
        ? `build ${build.loaded}`
        : build.wanted
          ? `build ${build.wanted} (${build.loading ? "loading…" : "not loaded"})`
          : "no build:: on this page",
      build.commit ? `@ ${build.commit.slice(0, 7)}` : "",
      build.pr && (build.loaded || !build.wanted?.startsWith("PR #")) ? `· PR #${build.pr}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    parts.build.textContent = build.mismatch ? `${buildText} · ${build.mismatch}` : buildText;
    parts.build.className = build.mismatch || (build.wanted && !build.loaded && !build.loading) ? "build bad" : "build";
    parts.claim.textContent = state?.claim ? `Proving: ${state.claim}` : "";
    parts.given.textContent = state?.given ? `Given: ${state.given}` : "";
    parts.where.textContent = !state
      ? view.lastRun ?? ""
      : state.caseIndex < 0
        ? "Setup"
        : state.caseIndex >= state.caseCount
          ? "Plan finished"
          : `Case ${state.caseIndex + 1}/${state.caseCount} · step ${state.stepIndex + 1}/${state.stepCount}`;
    parts.notices.replaceChildren(...view.warnings.map((text) => el("div", text, "warn")));
    this.paintPlan(parts, view);
    this.paintPending(parts, view);
    this.paintFeed(parts, state);
    this.paintControls(parts, view);
    parts.err.textContent = [view.error, this.flash].filter(Boolean).join("\n");
  }

  private paintPlan(parts: Parts, view: PanelView): void {
    const box = parts.plan;
    box.replaceChildren();
    const state = view.machine;
    if (!state) return;
    if (state.caseIndex < 0) {
      const setup = el("div", undefined, "case current");
      const line = el("div", undefined, "case-line");
      line.append(el("span", "▶", "icon now"), el("span", "Setup: preparing the data and settings the cases need"));
      setup.append(line);
      if (state.stepWhy) setup.append(el("div", `Step ${state.stepIndex + 1}/${state.stepCount}: ${state.stepWhy}`, "proves"));
      box.append(setup);
    }
    state.plan.forEach((item, index) => {
      const current = index === state.caseIndex;
      const node = el("div", undefined, `case${current ? " current" : !item.verdict && index > state.caseIndex ? " later" : ""}`);
      const line = el("div", undefined, "case-line");
      const icon = item.verdict ? (ICONS[item.verdict] ?? "•") : current ? "▶" : "○";
      line.append(el("span", icon, `icon ${item.verdict ?? (current ? "now" : "")}`), el("span", `${index + 1}. ${item.title}`));
      node.append(line);
      if (item.proves) node.append(el("div", `Proves: ${item.proves}`, "proves"));
      if (current) {
        if (item.steps.length === 0 && item.intent) {
          node.append(el("div", `Do this by hand: ${item.intent}`, "proves"));
        }
        const list = el("ol", undefined, "steps");
        item.steps.forEach((step, stepIndex) => {
          const failedHere = state.phase === "step-failed" && stepIndex === state.stepIndex;
          const done = stepIndex < state.stepIndex || state.phase === "waiting-verdict";
          const now = stepIndex === state.stepIndex && !done;
          const li = el("li", undefined, now ? "now" : done ? "done" : "");
          li.append(el("span", failedHere ? "✗" : done ? "✓" : now ? "▶" : "○", `icon${failedHere ? " fail" : ""}`), el("span", step.why));
          list.append(li);
        });
        node.append(list);
        node.append(el("div", `Then checks: ${item.checks ?? "the case's expect check"}`, "proves"));
      } else if (item.note && item.verdict) {
        node.append(el("div", item.note, `note${item.verdict === "fail" ? " fail" : ""}`));
      }
      box.append(node);
    });
    const now = box.querySelector(".steps li.now") ?? box.querySelector(".case.current");
    now?.scrollIntoView?.({ block: "nearest" });
  }

  private paintPending(parts: Parts, view: PanelView): void {
    const box = parts.pending;
    box.replaceChildren();
    const state = view.machine;
    if (!state && view.setup) {
      box.append(el("p", `Before loading ${view.setup.branch}, this kit sets up the graph:`));
      const list = el("ul");
      for (const why of view.setup.apply) list.append(el("li", why));
      box.append(list);
      if (view.setup.skip.length) {
        box.append(el("p", "Skipped here:", "muted"));
        const skipped = el("ul", undefined, "muted");
        for (const why of view.setup.skip) skipped.append(el("li", why));
        box.append(skipped);
      }
      return;
    }
    if (!state) {
      if (view.resumable) {
        box.append(el("p", `An earlier run stopped after case ${view.resumable.caseIndex}. Resume from case ${view.resumable.caseIndex + 1}, or run every case again.`));
      }
      return;
    }
    const pending = state.pending;
    if (pending?.kind === "steps") {
      box.append(el("p", "This case is done by hand. Do what it says above, then press Done to run its check."));
      const row = el("div", undefined, "row");
      row.append(button("Done", "done-by-hand", { className: "go" }), button("Skip case", "skip-case"));
      box.append(row);
    } else if (pending?.kind === "failure") {
      box.append(el("p", "This step failed:"), el("pre", pending.error));
      const row = el("div", undefined, "row");
      row.append(button("Retry", "retry", { className: "go" }), button("Skip step", "skip-step"), button("Skip case", "skip-case"));
      box.append(row);
    } else if (pending?.kind === "approval") {
      box.append(el("p", `This step runs js it didn't come with: ${pending.why}`), el("pre", pending.js));
      const row = el("div", undefined, "row");
      row.append(
        button("Allow", "approve", { className: "go", args: { stepId: pending.stepId } }),
        button("Deny", "deny", { className: "no", args: { stepId: pending.stepId } }),
      );
      box.append(row);
    } else if (pending?.kind === "verdict") {
      box.append(el("p", `Your call: ${pending.text}`));
    } else if (state.phase === "done" || state.phase === "stopped") {
      const values = Object.values(state.results);
      const count = (verdict: string): number => values.filter((value) => value === verdict).length;
      box.append(el("p", `${state.phase === "done" ? "Every case ran" : "Stopped"}: ${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped.`));
    }
  }

  private paintFeed(parts: Parts, state: MachineState | null): void {
    const box = parts.feed;
    box.replaceChildren();
    for (const entry of (state?.feed ?? []).slice(-FEED_SHOWN)) {
      const row = el("div", undefined, entry.kind);
      // In Roam no agent writes steps: a case without them is done by hand.
      const text = entry.text.replace(/^Waiting for the agent to work out steps: /, "Do this by hand, then press Done: ");
      row.append(el("span", WHO[entry.kind] ?? "", "who"), el("span", text));
      box.append(row);
    }
  }

  private paintControls(parts: Parts, view: PanelView): void {
    const box = parts.controls;
    box.replaceChildren();
    const state = view.machine;
    const live = state && state.phase !== "done" && state.phase !== "stopped";
    if (view.setup) box.append(button("Set up and load", "load", { className: "primary", title: "Apply the setup above, then load the build" }));
    if (view.build.mismatch) box.append(button("Reload with this build", "reload", { className: "primary" }));
    if (!live) {
      const run = button(state ? "Run again" : "Run", "run", {
        className: view.setup || view.blocked ? "" : "primary",
        title: view.blocked ?? "Run every case on this page",
      });
      run.disabled = Boolean(view.error) || Boolean(view.blocked);
      box.append(run);
      if (view.resumable && !state) box.append(button(`Resume from case ${view.resumable.caseIndex + 1}`, "resume"));
      if (state || view.resumable) box.append(button("Reset", "reset", { title: "Forget this tab's run of the kit" }));
      return;
    }
    const verdictHot = state.pending?.kind === "verdict";
    box.append(
      button(state.paused ? "Resume" : "Pause", "toggle", { title: "Ctrl+Alt+Space" }),
      button("Next", "next", { title: "Run one step (Ctrl+Alt+.)" }),
      button("−", "slower", { title: "Slower" }),
      el("span", `${state.speed}×`, "speed"),
      button("+", "faster", { title: "Faster" }),
      button(state.mode, "mode", { title: "auto runs on; step stops before each step; case stops between cases" }),
      button("✓ Pass", "verdict", { className: `go${verdictHot ? " hot" : ""}`, args: { verdict: "pass" } }),
      button("✗ Fail", "verdict", { className: `no${verdictHot ? " hot" : ""}`, args: { verdict: "fail" } }),
      button(Date.now() < this.stopArmed ? "Stop?" : "Stop", "stop", { title: "Press twice to end the run" }),
    );
  }
}
