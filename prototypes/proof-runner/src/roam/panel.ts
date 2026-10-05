import type { MachineState } from "../core/machine";
import { SPEEDS } from "../core/machine";
import type { CheckAction, CheckItem } from "./checklist";
import { roam } from "./roam";

// The run panel inside a {{proof}} block: the live HUD's layout (what the kit
// proves, every case with its steps, what's waiting on you, a feed, the
// controls) moved into the page, where it calls the machine directly instead
// of through a Playwright binding. Its own buttons and text sit in a shadow
// root, so kit selectors and proof.byText never match them. The cases are
// the page's own blocks, rendered by Roam into the light DOM and slotted in:
// editing a step in the panel edits the page, and the run's state shows on
// the blocks themselves (the runner's stylesheet marks them by uid).

// Roam renders a block, live and editable, into any element, and takes it
// down again. Tests pass a stand-in.
export type BlockRenderer = {
  render(uid: string, el: HTMLElement): Promise<unknown> | void;
  unmount(el: HTMLElement): void;
};

const roamBlocks: BlockRenderer = {
  render: (uid, el) => roam().ui.components.renderBlock({ uid, el }),
  unmount: (el) => roam().ui.components.unmountNode({ el }),
};

export type PanelView = {
  title: string;
  kitName: string | null;
  // What the kit needs before Run, each met or with the button that meets it.
  checklist: CheckItem[];
  // Why Run is off: the first need not met; null to run.
  blocked: string | null;
  // Kit or page problems that stop a run, e.g. a block the parser can't read.
  error: string | null;
  // Things to know before running: skipped fixtures, needs this tab can't meet.
  warnings: string[];
  machine: MachineState | null;
  // The run's blocks: each case's, by case id, and the step running now.
  blocks: { cases: Record<string, string>; step: string | null };
  // Cases already judged in an earlier, unfinished run of this kit.
  resumable: { caseIndex: number; results: Record<string, string> } | null;
  // The last finished run, from the page's run log.
  lastRun: string | null;
};

export type PanelAction =
  | { kind: "run" }
  | { kind: CheckAction }
  | { kind: "resume" }
  | { kind: "reset" }
  | { kind: "done-by-hand" }
  | { kind: "command"; cmd: string; args?: Record<string, unknown> };

const OWN_ACTIONS = new Set(["run", "resume", "reset", "done-by-hand", "connect", "disconnect", "load", "reload", "check-database", "ask-agent"]);

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
  .checks { display: flex; flex-direction: column; gap: 3px; }
  .checks:empty { display: none; }
  .check { display: flex; gap: 6px; align-items: baseline; font-size: 12.5px; }
  .check .mark { flex: none; width: 1.1em; text-align: center; font-weight: 700; }
  .check .what { flex: 1; min-width: 0; }
  .check .label { font-weight: 600; }
  .check .detail { color: #4b5567; overflow-wrap: anywhere; }
  .check ul { margin: 3px 0 2px; padding-left: 18px; color: #4b5567; }
  .check .acts { display: flex; gap: 6px; margin-top: 3px; }
  .check.ok .mark { color: #15805a; }
  .check.working .mark { color: #2c62c9; }
  .check.waiting .mark, .check.optional .mark { color: #8a93a3; }
  .check.needs-you { background: #fff6df; border-radius: 6px; padding: 5px 6px; }
  .check.needs-you .mark { color: #a46a00; }
  .check.blocked { background: #fdecea; border-radius: 6px; padding: 5px 6px; }
  .check.blocked .mark { color: #b3261e; }
  .ready { font-size: 12px; color: #15805a; }
  .ready span { margin-right: 10px; white-space: nowrap; }
  .claim { font-weight: 600; }
  .claim:empty, .given:empty, .where:empty { display: none; }
  .given, .muted { color: #5d6778; font-size: 12px; }
  .where { color: #3b4556; font-size: 12px; }
  .warn { color: #8a5a06; font-size: 12px; background: #fff6df; border-radius: 4px; padding: 4px 6px; }
  .err { color: #b3261e; font-size: 12px; white-space: pre-wrap; }
  .err:empty { display: none; }
  .plan { overflow-y: auto; max-height: 46vh; border-top: 1px solid #e3e7ee; padding-top: 6px; }
  .plan[hidden] { display: none; }
  .case { margin: 0 0 6px; }
  .case:empty { display: none; }
  .case-line { display: flex; gap: 6px; align-items: baseline; font-weight: 600; }
  .icon { width: 1.1em; flex: none; text-align: center; }
  .icon.now { color: #2c62c9; }
  .proves { color: #5d6778; font-size: 12px; margin-left: 1.7em; }
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

// The case blocks live in the light DOM, where the shadow root's styles
// don't reach; this sheet goes in with them. Only the case running now shows
// its steps; the others show their case:: line, verdict and note.
const BLOCKS_CSS = `
  .proof-blocks .proof-case { display: flex; gap: 4px; align-items: flex-start; margin: 0 0 2px; }
  .proof-blocks .proof-case-icon { flex: none; width: 1.1em; padding-top: 5px; text-align: center; color: #8a93a3; }
  .proof-blocks .proof-case.current .proof-case-icon { color: #2c62c9; }
  .proof-blocks .proof-case.pass .proof-case-icon { color: #15805a; }
  .proof-blocks .proof-case.fail .proof-case-icon { color: #d9412e; }
  .proof-blocks .proof-case-body { flex: 1; min-width: 0; }
  .proof-blocks .proof-case:not(.current) .rm-block-children { display: none; }
  .proof-blocks .proof-case.later { opacity: .6; }
  .proof-blocks .proof-case-note { margin: 0 0 4px 18px; font-size: 12px; color: #5d6778; white-space: pre-wrap; }
  .proof-blocks .proof-case.fail .proof-case-note { color: #b3261e; }
  .proof-blocks .proof-case-note:empty { display: none; }
`;

// Mouse events the case blocks keep to themselves once Roam has handled them,
// so a click on a step edits the step, not the {{proof}} block around the
// panel. Keys go on: Roam's shortcuts work while editing a step.
const BLOCK_MOUSE_EVENTS = ["mousedown", "mouseup", "click", "pointerdown"];

const ICONS: Record<string, string> = { pass: "✓", fail: "✗", skip: "⏭" };
const MARKS: Record<CheckItem["state"], string> = { ok: "✓", working: "…", waiting: "○", "needs-you": "▶", blocked: "✗", optional: "○" };
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
  checks: HTMLElement;
  claim: HTMLElement;
  given: HTMLElement;
  where: HTMLElement;
  notices: HTMLElement;
  plan: HTMLElement;
  setup: HTMLElement;
  // Light DOM, slotted into plan: the case blocks Roam renders.
  blocks: HTMLElement;
  cases: Map<string, CaseMount>;
  // Which cases' blocks are rendered, and the step last scrolled to.
  rendered: string;
  scrolledTo: string;
  pending: HTMLElement;
  feed: HTMLElement;
  controls: HTMLElement;
  err: HTMLElement;
};

type CaseMount = { wrapper: HTMLElement; icon: HTMLElement; note: HTMLElement; block: HTMLElement; uid: string | null };

export class ProofPanel {
  private view: PanelView | null = null;
  private readonly mounts = new Map<HTMLElement, Parts>();
  private flash = "";
  private flashTimer = 0;
  private stopArmed = 0;

  constructor(
    private readonly onAction: (action: PanelAction) => Promise<string | null> | string | null,
    private readonly renderer: BlockRenderer = roamBlocks,
  ) {}

  // Puts a panel in host. Roam re-renders blocks, so the same panel may be
  // mounted again; every mount shows the same state.
  attach(host: HTMLElement): void {
    if (this.mounts.has(host)) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.replaceChildren();
    host.replaceChildren();
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
      checks: el("div", undefined, "checks"),
      claim: el("div", "", "claim"),
      given: el("div", "", "given"),
      where: el("div", "", "where"),
      notices: el("div"),
      plan: el("div", undefined, "plan"),
      setup: el("div", undefined, "case"),
      blocks: el("div", undefined, "proof-blocks"),
      cases: new Map(),
      rendered: "",
      scrolledTo: "",
      pending: el("div", undefined, "pending"),
      feed: el("div", undefined, "feed"),
      controls: el("div", undefined, "row controls"),
      err: el("div", "", "err"),
    };
    parts.feed.setAttribute("aria-live", "polite");
    parts.err.setAttribute("role", "status");
    const slot = document.createElement("slot");
    slot.name = "blocks";
    parts.plan.append(parts.setup, slot);
    parts.plan.hidden = true;
    const sheet = document.createElement("style");
    sheet.textContent = BLOCKS_CSS;
    parts.blocks.slot = "blocks";
    parts.blocks.append(sheet);
    host.append(parts.blocks);
    panel.append(head, parts.checks, parts.claim, parts.given, parts.where, parts.notices, parts.plan, parts.pending, parts.feed, parts.controls, parts.err);
    root.append(style, panel);
    // Roam handles mouse and key events on blocks; keep ours to ourselves so a
    // click on Run doesn't also open the block for editing. The case blocks'
    // events pass through here too (they're slotted in), and go on to Roam.
    for (const type of ["mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "pointerdown"]) {
      panel.addEventListener(type, (event) => {
        if (event.target instanceof Node && parts.blocks.contains(event.target)) return;
        event.stopPropagation();
      });
    }
    for (const type of BLOCK_MOUSE_EVENTS) {
      parts.blocks.addEventListener(type, (event) => event.stopPropagation());
    }
    panel.addEventListener("click", (event) => {
      const target = (event.target as Element | null)?.closest?.("button") as HTMLButtonElement | null;
      if (target) void this.press(target);
    });
    this.mounts.set(host, parts);
    this.paint(parts);
  }

  detachGone(): void {
    for (const [host, parts] of [...this.mounts]) {
      if (host.isConnected) continue;
      this.unmountCases(parts);
      this.mounts.delete(host);
    }
  }

  // Takes down every block Roam rendered for this panel.
  dispose(): void {
    for (const parts of this.mounts.values()) this.unmountCases(parts);
    this.mounts.clear();
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
    if (OWN_ACTIONS.has(action)) {
      request = { kind: action } as PanelAction;
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
    this.paintChecklist(parts, view);
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

  // Every case of the run as its own block, with its verdict beside it; the
  // case running now shows its steps, and the runner's marks tint the step.
  private paintPlan(parts: Parts, view: PanelView): void {
    const state = view.machine;
    parts.plan.hidden = !state;
    parts.setup.replaceChildren();
    if (state && state.caseIndex < 0) {
      const line = el("div", undefined, "case-line");
      line.append(el("span", "▶", "icon now"), el("span", "Setup: preparing the data and settings the cases need"));
      parts.setup.append(line);
      if (state.stepWhy) parts.setup.append(el("div", `Step ${state.stepIndex + 1}/${state.stepCount}: ${state.stepWhy}`, "proves"));
    }
    const plan = state?.plan ?? [];
    const rendered = plan.map((item) => `${item.id}=${view.blocks.cases[item.id] ?? ""}`).join(" ");
    if (rendered !== parts.rendered) {
      this.renderCases(parts, view);
      parts.rendered = rendered;
    }
    plan.forEach((item, index) => {
      const mount = parts.cases.get(item.id);
      if (!mount || !state) return;
      const current = index === state.caseIndex;
      const later = !item.verdict && index > state.caseIndex;
      mount.wrapper.className = `proof-case${current ? " current" : later ? " later" : ""}${item.verdict ? ` ${item.verdict}` : ""}`;
      mount.icon.textContent = item.verdict ? (ICONS[item.verdict] ?? "•") : current ? "▶" : "○";
      mount.note.textContent = item.verdict && item.note ? item.note : "";
    });
    this.scrollToNow(parts, view);
  }

  private renderCases(parts: Parts, view: PanelView): void {
    this.unmountCases(parts);
    const plan = view.machine?.plan ?? [];
    for (const item of plan) {
      const uid = view.blocks.cases[item.id] ?? null;
      const mount: CaseMount = {
        wrapper: el("div", undefined, "proof-case"),
        icon: el("span", "○", "proof-case-icon"),
        note: el("div", "", "proof-case-note"),
        block: el("div", uid ? undefined : `case:: ${item.title}`, "proof-case-block"),
        uid,
      };
      mount.wrapper.dataset.case = item.id;
      const body = el("div", undefined, "proof-case-body");
      body.append(mount.block, mount.note);
      mount.wrapper.append(mount.icon, body);
      parts.blocks.append(mount.wrapper);
      parts.cases.set(item.id, mount);
      if (uid) {
        void Promise.resolve()
          .then(() => (parts.cases.get(item.id) === mount ? this.renderer.render(uid, mount.block) : undefined))
          .catch((error: unknown) => {
            mount.block.textContent = `case:: ${item.title} (Roam didn't render its block: ${error instanceof Error ? error.message : String(error)})`;
          });
      }
    }
    parts.scrolledTo = "";
  }

  private unmountCases(parts: Parts): void {
    for (const mount of parts.cases.values()) {
      if (mount.uid) {
        try {
          this.renderer.unmount(mount.block);
        } catch {
          // Already gone with its host.
        }
      }
      mount.wrapper.remove();
    }
    parts.cases.clear();
    parts.rendered = "";
  }

  // Brings the step running now into view once each time it changes, and
  // never while someone is editing a block in the panel.
  private scrollToNow(parts: Parts, view: PanelView): void {
    const state = view.machine;
    if (!state || state.caseIndex < 0 || !state.caseId) return;
    const key = `${state.caseId}/${view.blocks.step ?? ""}/${state.phase === "step-failed"}`;
    if (key === parts.scrolledTo) return;
    const active = document.activeElement;
    if (active && parts.blocks.contains(active) && active.matches("textarea, input")) return;
    const step = view.blocks.step ? parts.blocks.querySelector(`[id$="-${view.blocks.step}"]`) : null;
    if (step) {
      (step.closest(".roam-block-container") ?? step).scrollIntoView?.({ block: "nearest" });
      parts.scrolledTo = key;
      return;
    }
    // Roam renders blocks a moment later: show the case until the step is there.
    if (parts.scrolledTo === `${key} case`) return;
    parts.cases.get(state.caseId)?.wrapper.scrollIntoView?.({ block: "nearest" });
    parts.scrolledTo = view.blocks.step ? `${key} case` : key;
  }

  // Each need with its mark and, when it isn't met, the button that meets
  // it. Once every need is met they fold into one line.
  private paintChecklist(parts: Parts, view: PanelView): void {
    const box = parts.checks;
    box.replaceChildren();
    const items = view.checklist;
    if (items.every((item) => item.state === "ok")) {
      const ready = el("div", undefined, "ready");
      for (const item of items) ready.append(el("span", `✓ ${item.label}: ${item.detail}`));
      box.append(ready);
      for (const item of items) {
        if (item.secondary) box.append(button(item.secondary.label, item.secondary.kind, { title: `${item.label}: ${item.secondary.label}` }));
      }
      return;
    }
    for (const item of items) {
      const row = el("div", undefined, `check ${item.state}`);
      row.dataset.check = item.id;
      const what = el("div", undefined, "what");
      what.append(el("span", `${item.label}: `, "label"), el("span", item.detail, "detail"));
      if (item.list?.length) {
        const list = el("ul");
        for (const line of item.list) list.append(el("li", line));
        what.append(list);
      }
      const acts = [item.action, item.secondary].filter((act): act is NonNullable<typeof act> => Boolean(act));
      if (acts.length) {
        const row2 = el("div", undefined, "acts");
        for (const act of acts) row2.append(button(act.label, act.kind, { className: act === item.action ? "primary" : "" }));
        what.append(row2);
      }
      row.append(el("span", MARKS[item.state], "mark"), what);
      box.append(row);
    }
  }

  private paintPending(parts: Parts, view: PanelView): void {
    const box = parts.pending;
    box.replaceChildren();
    const state = view.machine;
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
      if (view.blocks.step) {
        box.append(el("p", "Fix the step in its block above and press Retry to run your fix. Other edits apply from the next Run.", "muted"));
      }
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
    if (!live) {
      const run = button(state ? "Run again" : "Run", "run", {
        className: view.blocked ? "" : "primary",
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
