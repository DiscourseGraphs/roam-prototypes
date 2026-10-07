import type { MachineState } from "../core/machine";
import { CaptionBar, type BarAction, type RunChoice } from "./bar";
import type { CheckAction, CheckItem } from "./checklist";
import { roam } from "./roam";
import { Stage } from "./stage";
import { bulletVerdict, doneWhen, duration, type DoneWhen, type RunFacts, type StepKind } from "./words";

export type { RunChoice } from "./bar";

// The proof runner's surfaces, from the tester's side of the screen. On the
// page, inside the {{proof}} block, a run card says what the PR does and what
// running it asks of you, and after a run shows the cases with their
// verdicts. During a run, Roam is the stage: a caption bar on the window's
// bottom edge narrates, a ring marks where each step acts, a frame says who
// has the screen, and the bar grows in place when the run needs you. The
// card's buttons and text sit in a shadow root, so kit selectors never match
// them; the case blocks are the page's own, rendered by Roam into the light
// DOM and slotted in, so editing a step in the card edits the page.

// Roam renders a block, live and editable, into any element, and takes it
// down again. Tests pass a stand-in.
export type BlockRenderer = {
  render(uid: string, el: HTMLElement): Promise<unknown> | void;
  unmount(el: HTMLElement): void;
};

// Rendered open whatever the page says, so the case running now shows its
// steps even when its block is collapsed on the page.
const roamBlocks: BlockRenderer = {
  render: (uid, el) => roam().ui.components.renderBlock({ uid, el, "open?": true }),
  unmount: (el) => roam().ui.components.unmountNode({ el }),
};

// What the page says about the kit, for the run card before Run.
export type KitSummary = {
  claim: string | null;
  pr: number | null;
  ticket: string | null;
  // The cases a run plays, and how many steps they have in all.
  cases: number;
  steps: number;
  // Cases a person decides by eye, and cases done by hand.
  judge: number;
  byHand: number;
  doneWhen: DoneWhen[];
  // Cases tied to no Done When bullet.
  other: number;
  // Rejected cases, with why.
  notTested: Array<{ title: string; reason: string | null }>;
  proposed: number;
};

// What a run carries beside the machine's state.
export type RunInfo = {
  choice: RunChoice;
  // Every case, a resume, or only the cases that didn't pass last time.
  scope: "all" | "resume" | "failed";
  // How many cases didn't pass, for "Run the ones that didn't pass".
  rerun: number;
  // Whether a failed check holds the screen until the person goes on.
  stopOnFail: boolean;
  kinds: Record<string, StepKind[]>;
  startedAt: number;
  endedAt: number | null;
  facts: RunFacts;
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
  kit: KitSummary | null;
  run: RunInfo | null;
  // An agent called the runner's tools lately.
  agent: boolean;
};

export type PanelAction =
  | { kind: "run" }
  | { kind: CheckAction }
  | { kind: "resume" }
  | { kind: "reset" }
  | { kind: "restart" }
  | { kind: "done-by-hand" }
  | { kind: "edit-step" }
  | { kind: "rerun" }
  | { kind: "open-kit" }
  | { kind: "stop-on-fail"; on: boolean }
  | { kind: "command"; cmd: string; args?: Record<string, unknown> };

const OWN_ACTIONS = new Set(["run", "resume", "reset", "rerun", "done-by-hand", "connect", "disconnect", "load", "reload", "check-database", "ask-agent"]);

const CSS = `
  :host { all: initial; display: block; }
  * { box-sizing: border-box; }
  .card { max-width: 640px; margin: 6px 0; border-radius: 12px; overflow: hidden; border: 1px solid #d9d6e4; background: #fbfbfd;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f1d29; }
  .head { background: #17151f; color: #efedf7; padding: 14px 16px 13px; }
  .eyebrow { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: #a9a5bd; font-weight: 800; }
  .title { font-size: 17px; font-weight: 750; line-height: 1.3; margin-top: 4px; }
  .claim { color: #c7c3d8; margin-top: 5px; }
  .claim:empty { display: none; }
  .facts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .fact { background: #26233a; border-radius: 6px; padding: 2px 8px; font-size: 12.5px; }
  .fact.ok { background: rgba(69, 196, 126, .15); color: #9fe7bd; }
  .fact.you { background: rgba(255, 181, 71, .16); color: #ffcf85; }
  .body { padding: 12px 16px 14px; display: grid; gap: 10px; }
  .checks { display: grid; gap: 4px; }
  .checks:empty { display: none; }
  .check { display: flex; gap: 7px; align-items: baseline; }
  .check .mark { flex: none; width: 1.1em; text-align: center; font-weight: 800; }
  .check .what { flex: 1; min-width: 0; }
  .check .label { font-weight: 650; }
  .check .detail { color: #4c4a5c; overflow-wrap: anywhere; }
  .check ul { margin: 3px 0 2px; padding-left: 18px; color: #4c4a5c; }
  .check .acts { margin-top: 4px; }
  .check.ok .mark { color: #1c7a45; }
  .check.working .mark { color: #5541d2; }
  .check.waiting .mark, .check.optional .mark { color: #8b889c; }
  .check.needs-you { background: #fff3dc; border-radius: 7px; padding: 6px 8px; }
  .check.needs-you .mark { color: #975600; }
  .check.blocked { background: #fdecea; border-radius: 7px; padding: 6px 8px; }
  .check.blocked .mark { color: #b9342b; }
  .ready { color: #1c7a45; }
  .ready b { font-weight: 800; }
  .ready span { color: #4c4a5c; }
  .warn { color: #7a4a00; background: #fff3dc; border-radius: 6px; padding: 5px 8px; font-size: 12.5px; }
  .err { color: #b9342b; white-space: pre-wrap; }
  .err:empty { display: none; }
  .lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #6b6880; font-weight: 800; }
  .choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .choice { text-align: left; border: 1px solid #d9d6e4; background: #fff; border-radius: 8px; padding: 7px 9px; font: 12px/1.4 system-ui, -apple-system, sans-serif;
    color: #4c4a5c; cursor: pointer; }
  .choice b { display: block; color: #1f1d29; font-size: 13px; margin-bottom: 1px; }
  .choice.on { border-color: #5541d2; background: #f1eeff; box-shadow: 0 0 0 1px #5541d2; }
  .paces { margin-top: 8px; }
  button.pick { font-weight: 500; padding: 3px 9px; }
  button.pick.on { background: #5541d2; border-color: #5541d2; color: #fff; }
  button.tick { display: block; margin-top: 7px; background: none; border: 0; padding: 2px 0; font-weight: 500; color: #4c4a5c; text-align: left; }
  button.tick:hover { background: none; color: #1f1d29; }
  button.tick .box { color: #5541d2; font-size: 14px; }
  .meta.held { margin-top: 8px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .meta { color: #6b6880; font-size: 12px; }
  button { font: 650 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f1d29; background: #fff; border: 1px solid #cfccdc;
    border-radius: 7px; padding: 5px 11px; cursor: pointer; }
  button:hover { background: #f2f1f7; }
  button:focus-visible, .choice:focus-visible { outline: 2px solid #5541d2; outline-offset: 1px; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  button.primary { background: #5541d2; border-color: #5541d2; color: #fff; font-size: 13.5px; padding: 7px 16px; }
  button.primary:hover { background: #4836c0; }
  button.primary:disabled { background: #a9a2dd; border-color: #a9a2dd; }
  button.link { background: none; border: 0; padding: 0; color: #5541d2; text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
  details { border-top: 1px solid #e6e4ee; padding-top: 7px; }
  summary { cursor: pointer; color: #1f1d29; }
  details ul { margin: 6px 0 0; padding-left: 18px; color: #4c4a5c; }
  details li { margin: 2px 0; }
  .status { background: #f1eeff; border-radius: 8px; padding: 7px 10px; color: #2d2370; }
  .status.done { background: #e9f6ee; color: #14532d; }
  .status.fail { background: #fdecea; color: #7f1d1d; }
  .plan[hidden] { display: none; }
  .setup { color: #4c4a5c; font-size: 12.5px; }
  .setup:empty { display: none; }
`;

// The case blocks live in the light DOM, where the shadow root's styles
// don't reach; this sheet goes in with them. Only the case running now shows
// its steps; the others show their case:: line, verdict and note. The open
// case hides its attribute lines (id::, proves::, decision:: and the rest).
const BLOCKS_CSS = `
  .proof-blocks .proof-case { display: flex; gap: 4px; align-items: flex-start; margin: 0 0 2px; }
  .proof-blocks .proof-case-icon { flex: none; width: 1.1em; padding-top: 5px; text-align: center; color: #8b889c; }
  .proof-blocks .proof-case.current .proof-case-icon { color: #5541d2; }
  .proof-blocks .proof-case.pass .proof-case-icon { color: #1c7a45; }
  .proof-blocks .proof-case.fail .proof-case-icon { color: #b9342b; }
  .proof-blocks .proof-case-body { flex: 1; min-width: 0; }
  .proof-blocks .proof-case:not(.current) .rm-block-children { display: none; }
  .proof-blocks .proof-case.current .rm-block-children > .roam-block-container:has(> .rm-block-main .rm-block__input > span:first-child > .rm-attr-ref:first-child) { display: none; }
  .proof-blocks .proof-case.later { opacity: .6; }
  .proof-blocks .proof-case-note { margin: 0 0 4px 18px; font-size: 12px; color: #6b6880; white-space: pre-wrap; }
  .proof-blocks .proof-case.fail .proof-case-note { color: #b9342b; }
  .proof-blocks .proof-case-note:empty { display: none; }
`;

// Room for the bar: the page's article ends far enough down that its last
// lines scroll clear of the bar, and scrolling to an element keeps it above.
const ROOM_ID = "proof-runner-room";
const ROOM_CSS = `.rm-article-wrapper::after { content: ""; display: block; height: 96px; }
.roam-body-main { scroll-padding-bottom: 96px; }`;

// Mouse events the case blocks keep to themselves once Roam has handled them,
// so a click on a step edits the step, not the {{proof}} block around the
// card. Keys go on: Roam's shortcuts work while editing a step.
const BLOCK_MOUSE_EVENTS = ["mousedown", "mouseup", "click", "pointerdown"];

const CHOICE_KEY = "proof-runner:run-choice";
const PAUSE_BETWEEN_KEY = "proof-runner:pause-between";
const PACE_KEY = "proof-runner:pace";
const STOP_ON_FAIL_KEY = "proof-runner:stop-on-fail";
const PACES: Array<{ pace: number; label: string }> = [
  { pace: 0.5, label: "Slower" },
  { pace: 1, label: "Normal" },
  { pace: 2, label: "Faster" },
];
const CHOICES: Array<{ choice: RunChoice; label: string; hint: string }> = [
  { choice: "watch", label: "Watch it", hint: "Normal pace. Holds on a failure so you can look." },
  { choice: "result", label: "Just the result", hint: "Faster. Tries a failed step again, then moves on." },
  { choice: "step", label: "Step through", hint: "Waits before each step. Next step runs one." },
];

// How a run plays, picked before Run and kept in this browser. Watch it can
// also stop after each case, so a reviewer can look around before the next
// case's first step clears the screen.
export type RunSettings = { choice: RunChoice; pauseBetween: boolean; pace: number; stopOnFail: boolean };

const readFlag = (key: string, otherwise: boolean): boolean => {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? otherwise : saved === "1";
  } catch {
    return otherwise;
  }
};

const saveFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Kept for this tab only.
  }
};

const readPace = (): number => {
  try {
    const saved = Number(localStorage.getItem(PACE_KEY));
    if (PACES.some((item) => item.pace === saved)) return saved;
  } catch {
    // No storage here: the default.
  }
  return 1;
};

const readPauseBetween = (): boolean => {
  try {
    return localStorage.getItem(PAUSE_BETWEEN_KEY) === "1";
  } catch {
    return false;
  }
};

const readChoice = (): RunChoice => {
  try {
    const saved = localStorage.getItem(CHOICE_KEY);
    if (saved === "watch" || saved === "result" || saved === "step") return saved;
  } catch {
    // No storage here: the default.
  }
  return "watch";
};

const ICONS: Record<string, string> = { pass: "✓", fail: "✗", skip: "–" };
const MARKS: Record<CheckItem["state"], string> = { ok: "✓", working: "…", waiting: "○", "needs-you": "▶", blocked: "✗", optional: "○" };

// A step takes about this long at 1×, before the run has timed any.
const STEP_MS = 2200;

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

// A press on the runner's buttons leaves focus where the run put it: Roam
// stops editing a block that loses focus, and takes its menus with it.
const keepFocus = (event: Event): void => {
  if (event.type === "mousedown" && (event.target as Element | null)?.closest?.("button")) event.preventDefault();
};

type Parts = {
  root: ShadowRoot;
  card: HTMLElement;
  plan: HTMLElement;
  setup: HTMLElement;
  // Light DOM, slotted into plan: the case blocks Roam renders.
  blocks: HTMLElement;
  cases: Map<string, CaseMount>;
  // Which cases' blocks are rendered, and the step last scrolled to.
  rendered: string;
  scrolledTo: string;
  err: HTMLElement;
};

type CaseMount = { wrapper: HTMLElement; icon: HTMLElement; note: HTMLElement; block: HTMLElement; uid: string | null };

const isLive = (state: MachineState | null | undefined): boolean => Boolean(state && state.phase !== "done" && state.phase !== "stopped");

export class ProofPanel {
  private view: PanelView | null = null;
  private readonly mounts = new Map<HTMLElement, Parts>();
  private flash = "";
  private flashTimer = 0;
  private choice: RunChoice = readChoice();
  private pauseBetween = readPauseBetween();
  private pace = readPace();
  private stopOnFail = readFlag(STOP_ON_FAIL_KEY, true);
  private readonly bar: CaptionBar;
  private readonly stage: Stage;
  private lastAsk = "";
  // How long steps take here, from the run so far.
  private stepTimes: number[] = [];
  private lastStep: { key: string; at: number } | null = null;

  constructor(
    private readonly onAction: (action: PanelAction) => Promise<string | null> | string | null,
    private readonly renderer: BlockRenderer = roamBlocks,
  ) {
    this.bar = new CaptionBar((action) => this.fromBar(action));
    this.stage = new Stage({
      held: () => {
        void Promise.resolve(this.onAction({ kind: "command", cmd: "pause", args: { why: "page" } }));
      },
      toggle: () => {
        const state = this.view?.machine;
        if (!state || !isLive(state)) return;
        void Promise.resolve(this.onAction({ kind: "command", cmd: state.paused ? "resume" : "pause" }));
      },
      next: () => {
        if (isLive(this.view?.machine)) void Promise.resolve(this.onAction({ kind: "command", cmd: "next" }));
      },
      ours: (event) => {
        const path = event.composedPath();
        if (path.includes(this.bar.host)) return true;
        for (const [host, parts] of this.mounts) {
          if (path.includes(parts.blocks)) return false;
          if (path.includes(host)) return true;
        }
        return false;
      },
    });
  }

  runSettings(): RunSettings {
    return {
      choice: this.choice,
      pauseBetween: this.choice === "watch" && this.pauseBetween,
      pace: this.choice === "watch" ? this.pace : 1,
      stopOnFail: this.choice === "result" ? false : this.choice === "step" || this.stopOnFail,
    };
  }

  // Puts a run card in host. Roam re-renders blocks, so the same panel may be
  // mounted again; every mount shows the same state.
  attach(host: HTMLElement): void {
    if (this.mounts.has(host)) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.replaceChildren();
    host.replaceChildren();
    const style = document.createElement("style");
    style.textContent = CSS;
    const card = el("div", undefined, "card");
    const parts: Parts = {
      root,
      card,
      plan: el("div", undefined, "plan"),
      setup: el("div", undefined, "setup"),
      blocks: el("div", undefined, "proof-blocks"),
      cases: new Map(),
      rendered: "",
      scrolledTo: "",
      err: el("div", "", "err"),
    };
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
    root.append(style, card);
    // Roam handles mouse and key events on blocks; keep ours to ourselves so a
    // click on Run doesn't also open the block for editing. The case blocks'
    // events pass through here too (they're slotted in), and go on to Roam.
    for (const type of ["mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "pointerdown"]) {
      card.addEventListener(type, (event) => {
        if (event.target instanceof Node && parts.blocks.contains(event.target)) return;
        keepFocus(event);
        event.stopPropagation();
      });
    }
    for (const type of BLOCK_MOUSE_EVENTS) {
      parts.blocks.addEventListener(type, (event) => event.stopPropagation());
    }
    card.addEventListener("click", (event) => {
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

  // Takes down every block Roam rendered for this panel, the bar and the stage.
  dispose(): void {
    for (const parts of this.mounts.values()) this.unmountCases(parts);
    this.mounts.clear();
    this.bar.dispose();
    this.stage.dispose();
    document.getElementById(ROOM_ID)?.remove();
  }

  get attached(): number {
    this.detachGone();
    return this.mounts.size;
  }

  update(view: PanelView): void {
    this.view = view;
    this.detachGone();
    this.timeSteps(view.machine);
    for (const parts of this.mounts.values()) this.paint(parts);
    this.syncRun(view);
  }

  // The step a run is about to act on, from the executor: the ring goes on
  // it, and the bar steps aside when it's underneath.
  target(element: Element | null, verb = ""): void {
    this.stage.ring(element, verb);
    this.bar.setDodge(Boolean(element && this.bar.covers(element.getBoundingClientRect())));
  }

  showError(message: string): void {
    this.flash = message;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash = "";
      this.repaint();
    }, 7000);
    this.repaint();
    if (this.bar.showing) this.bar.showError(message);
  }

  private repaint(): void {
    for (const parts of this.mounts.values()) this.paint(parts);
  }

  // Keeps a moving average of how long a step takes, for the forecast.
  private timeSteps(state: MachineState | null): void {
    if (!state || !isLive(state) || state.paused || state.pending) {
      this.lastStep = null;
      return;
    }
    const key = `${state.caseIndex}/${state.stepIndex}`;
    const now = Date.now();
    if (this.lastStep && this.lastStep.key !== key) {
      const took = now - this.lastStep.at;
      if (took > 0 && took < 30_000) this.stepTimes = [...this.stepTimes.slice(-19), took];
    }
    if (!this.lastStep || this.lastStep.key !== key) this.lastStep = { key, at: now };
  }

  private msPerStep(state: MachineState): number {
    if (this.stepTimes.length >= 3) return this.stepTimes.reduce((sum, value) => sum + value, 0) / this.stepTimes.length;
    return STEP_MS / Math.max(0.25, state.speed);
  }

  // The bar, the frame, the ring, held input and the tab title follow the run.
  private syncRun(view: PanelView): void {
    const state = view.machine;
    const run = view.run;
    if (!state || !run) {
      this.bar.update(null);
      this.stage.setLive(false);
      this.stage.setDriver("none");
      this.stage.ring(null);
      this.stage.setTitle(null);
      document.getElementById(ROOM_ID)?.remove();
      return;
    }
    const live = isLive(state);
    this.bar.update({
      title: view.title,
      state,
      kinds: run.kinds,
      msPerStep: this.msPerStep(state),
      facts: run.facts,
      notTested: view.kit?.notTested.length ?? 0,
      stepUid: view.blocks.step,
      choice: run.choice,
      scope: run.scope,
      rerun: run.rerun,
      stopOnFail: run.stopOnFail,
      agent: view.agent,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    });
    const driving = live && !state.paused && !state.pending && state.phase !== "waiting-next";
    this.stage.setLive(live);
    this.stage.setHolding(driving);
    this.stage.setDriver(!live ? "none" : state.pending?.kind === "check-failed" ? "held" : driving ? "run" : "you");
    if (!live || (!state.executing && state.phase !== "dwell")) {
      this.stage.ring(null);
      this.bar.setDodge(false);
    }
    // The tab says where the run is, and whether it needs you.
    const failed = state.plan.filter((item) => state.results[item.id] === "fail").length;
    if (live) {
      const where = state.caseIndex < 0 ? "setup" : `${state.caseIndex + 1}/${state.caseCount}`;
      this.stage.setTitle(driving ? `▶ ${where}` : state.paused ? `❚❚ Paused ${where}` : "● Your turn");
    } else if (this.bar.showing) {
      this.stage.setTitle(state.phase === "stopped" ? "❚❚ Stopped" : failed ? `✗ ${failed} failed` : "✓ Passed");
    } else {
      this.stage.setTitle(null);
    }
    // A chime when the run starts waiting on a person who looked away.
    const ask = live && state.pending ? `${state.pending.kind}:${state.pending.caseId}` : "";
    if (ask && ask !== this.lastAsk) this.stage.chime();
    this.lastAsk = ask;
    if (live && !document.getElementById(ROOM_ID)) {
      const style = document.createElement("style");
      style.id = ROOM_ID;
      style.textContent = ROOM_CSS;
      document.head.append(style);
    } else if (!live && !this.bar.showing) {
      document.getElementById(ROOM_ID)?.remove();
    }
  }

  private async fromBar(action: BarAction): Promise<string | null> {
    if (action.kind === "closed") {
      if (this.view) this.syncRun(this.view);
      return null;
    }
    if (action.kind === "run" || action.kind === "rerun") {
      this.stage.prime();
      return this.onAction({ kind: action.kind });
    }
    if (action.kind === "ask-agent") return this.onAction({ kind: "ask-agent" });
    // A setting changed in the bar during the run: kept for later runs too.
    if (action.kind === "setting") {
      if (action.key === "pauseBetween") {
        this.pauseBetween = action.on;
        saveFlag(PAUSE_BETWEEN_KEY, action.on);
        return this.onAction({ kind: "command", cmd: "mode", args: { mode: action.on ? "case" : "auto" } });
      }
      this.stopOnFail = action.on;
      saveFlag(STOP_ON_FAIL_KEY, action.on);
      return this.onAction({ kind: "stop-on-fail", on: action.on });
    }
    const result = await this.onAction(action);
    if (this.view) this.syncRun(this.view);
    return result;
  }

  private async press(target: HTMLButtonElement): Promise<void> {
    const action = target.dataset.action ?? "";
    const args = target.dataset.args ? (JSON.parse(target.dataset.args) as Record<string, unknown>) : {};
    if (action === "choose") {
      this.choice = args.choice as RunChoice;
      try {
        localStorage.setItem(CHOICE_KEY, this.choice);
      } catch {
        // Kept for this tab only.
      }
      this.repaint();
      return;
    }
    if (action === "pace") {
      this.pace = Number(args.pace);
      try {
        localStorage.setItem(PACE_KEY, String(this.pace));
      } catch {
        // Kept for this tab only.
      }
      this.repaint();
      return;
    }
    if (action === "stop-on-fail") {
      this.stopOnFail = !this.stopOnFail;
      saveFlag(STOP_ON_FAIL_KEY, this.stopOnFail);
      this.repaint();
      return;
    }
    if (action === "pause-between") {
      this.pauseBetween = !this.pauseBetween;
      try {
        localStorage.setItem(PAUSE_BETWEEN_KEY, this.pauseBetween ? "1" : "0");
      } catch {
        // Kept for this tab only.
      }
      this.repaint();
      return;
    }
    if (action === "show-result") {
      this.bar.openResult();
      if (this.view) this.syncRun(this.view);
      return;
    }
    if (action === "run" || action === "resume" || action === "rerun") this.stage.prime();
    const request: PanelAction | null = OWN_ACTIONS.has(action) ? ({ kind: action } as PanelAction) : { kind: "command", cmd: action, args };
    const error = await this.onAction(request);
    if (error) this.showError(error);
  }

  private paint(parts: Parts): void {
    const view = this.view;
    if (!view) return;
    const state = view.machine;
    const card = parts.card;
    card.replaceChildren();
    card.append(this.paintHead(view));
    const body = el("div", undefined, "body");
    if (state && isLive(state)) {
      const where = state.caseIndex < 0 ? "Setting up the graph" : `Case ${state.caseIndex + 1} of ${state.caseCount} is running`;
      body.append(el("div", `${where}. The controls are in the bar at the bottom of the window.`, "status"));
    } else {
      body.append(this.paintChecklist(view));
      for (const text of view.warnings) body.append(el("div", text, "warn"));
      if (state) body.append(this.paintEnded(state));
      body.append(this.paintStart(view));
      const folds = this.paintFolds(view);
      if (folds) body.append(folds);
    }
    body.append(parts.plan);
    parts.err.textContent = [view.error, this.flash].filter(Boolean).join("\n");
    body.append(parts.err);
    card.append(body);
    this.paintPlan(parts, view);
  }

  private paintHead(view: PanelView): HTMLElement {
    const head = el("div", undefined, "head");
    const kit = view.kit;
    const eyebrow = ["Proof", kit?.pr ? `PR #${kit.pr}` : null, kit?.ticket].filter(Boolean).join(" · ");
    head.append(el("div", eyebrow, "eyebrow"), el("div", view.title, "title"), el("div", kit?.claim ?? "", "claim"));
    if (kit) {
      const facts = el("div", undefined, "facts");
      const minutes = duration(kit.steps * STEP_MS + kit.cases * 1500);
      facts.append(el("span", `${kit.cases} case${kit.cases === 1 ? "" : "s"}`, "fact"), el("span", minutes, "fact"));
      const asks = [kit.judge ? `${kit.judge} call${kit.judge === 1 ? "" : "s"} by eye` : "", kit.byHand ? `${kit.byHand} by hand` : ""].filter(Boolean);
      facts.append(
        asks.length
          ? el("span", `Needs you ${kit.judge + kit.byHand} time${kit.judge + kit.byHand === 1 ? "" : "s"}: ${asks.join(", ")}`, "fact you")
          : el("span", "Won't need you unless a step doesn't work", "fact ok"),
      );
      head.append(facts);
    }
    return head;
  }

  // Each need with its mark and, when it isn't met, the button that meets
  // it. Once every need is met they fold into one line.
  private paintChecklist(view: PanelView): HTMLElement {
    const box = el("div", undefined, "checks");
    const items = view.checklist;
    if (items.length && items.every((item) => item.state === "ok")) {
      const ready = el("div", undefined, "ready");
      ready.append(el("b", "✓ Ready"), el("span", ` · ${items.filter((item) => item.id !== "runner").map((item) => item.detail).join(" · ") || items[0].detail}`));
      box.append(ready);
      const extras = items.filter((item) => item.secondary);
      if (extras.length) {
        const row = el("div", undefined, "row");
        for (const item of extras) if (item.secondary) row.append(button(item.secondary.label, item.secondary.kind, { title: `${item.label}: ${item.secondary.label}` }));
        box.append(row);
      }
      return box;
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
        const row2 = el("div", undefined, "row acts");
        for (const act of acts) row2.append(button(act.label, act.kind, { className: act === item.action ? "primary" : "" }));
        what.append(row2);
      }
      row.append(el("span", MARKS[item.state], "mark"), what);
      box.append(row);
    }
    return box;
  }

  private paintEnded(state: MachineState): HTMLElement {
    const failed = state.plan.filter((item) => state.results[item.id] === "fail").length;
    const passed = state.plan.filter((item) => state.results[item.id] === "pass").length;
    const stopped = state.phase === "stopped";
    const line = el("div", undefined, `status ${stopped ? "" : failed ? "fail" : "done"}`);
    const words = stopped
      ? `Stopped after ${passed} passed${failed ? `, ${failed} failed` : ""}.`
      : `${failed ? "✗" : "✓"} ${passed} of ${state.plan.length} passed${failed ? `, ${failed} failed` : ""}.`;
    line.append(document.createTextNode(`${words} `), button("See the result", "show-result", { className: "link" }));
    return line;
  }

  private paintStart(view: PanelView): HTMLElement {
    const box = el("div", undefined, "start");
    const state = view.machine;
    box.append(el("div", "How will you run it?", "lbl"));
    const choices = el("div", undefined, "choices");
    for (const option of CHOICES) {
      const node = button("", "choose", { className: `choice${this.choice === option.choice ? " on" : ""}`, args: { choice: option.choice } });
      node.setAttribute("aria-pressed", String(this.choice === option.choice));
      node.append(el("b", `${this.choice === option.choice ? "◉" : "○"} ${option.label}`), document.createTextNode(option.hint));
      choices.append(node);
    }
    box.append(choices);
    if (this.choice === "watch") {
      const paces = el("div", undefined, "row paces");
      paces.append(el("span", "Pace", "lbl"));
      for (const item of PACES) {
        const pick = button(item.label, "pace", { className: `pick${this.pace === item.pace ? " on" : ""}`, args: { pace: item.pace } });
        pick.setAttribute("aria-pressed", String(this.pace === item.pace));
        paces.append(pick);
      }
      paces.append(el("span", "You can also change it during the run, in the bar.", "meta"));
      box.append(paces);
      const tick = button("", "pause-between", { className: "tick" });
      tick.setAttribute("role", "checkbox");
      tick.setAttribute("aria-checked", String(this.pauseBetween));
      tick.append(el("span", this.pauseBetween ? "☑" : "☐", "box"), document.createTextNode(" Pause after each case, so you can look around before the next one starts"));
      box.append(tick);
      const stop = button("", "stop-on-fail", { className: "tick" });
      stop.setAttribute("role", "checkbox");
      stop.setAttribute("aria-checked", String(this.stopOnFail));
      stop.append(el("span", this.stopOnFail ? "☑" : "☐", "box"), document.createTextNode(" Stop when a check fails, so you can look at the screen"));
      box.append(stop);
    }
    const row = el("div", undefined, "row");
    row.style.marginTop = "10px";
    const count = view.kit?.cases ?? 0;
    const run = button(state ? "Run again" : count ? `▶ Run ${count} case${count === 1 ? "" : "s"}` : "▶ Run", "run", {
      className: "primary",
      title: view.blocked ?? "Run every case on this page",
    });
    run.disabled = Boolean(view.error) || Boolean(view.blocked);
    row.append(run);
    if (view.resumable && !state) row.append(button(`Resume from case ${view.resumable.caseIndex + 1}`, "resume"));
    const rerun = view.run?.rerun ?? 0;
    if (state && rerun) row.append(button(`Run the ${rerun === 1 ? "one" : rerun} that didn't pass`, "rerun"));
    if (state || view.resumable) row.append(button("Reset", "reset", { title: "Forget this tab's run of the kit" }));
    if (view.blocked) row.append(el("span", `Waiting on ${view.blocked.split(":")[0]}`, "meta"));
    box.append(row);
    // Said before the first click is held, so it doesn't read as Roam freezing.
    box.append(el("div", "While it runs, a click on the page pauses the run instead of landing. Scrolling still works, and Ctrl+Alt+Space pauses too.", "meta held"));
    return box;
  }

  private paintFolds(view: PanelView): HTMLElement | null {
    const kit = view.kit;
    const box = el("div");
    const fold = (summary: string, lines: string[]): void => {
      const details = el("details");
      details.append(el("summary", summary));
      const list = el("ul");
      for (const line of lines) list.append(el("li", line));
      details.append(list);
      box.append(details);
    };
    if (kit) {
      const results = view.machine?.results ?? {};
      if (kit.doneWhen.length || kit.other) {
        const lines = kit.doneWhen.map((bullet) => {
          const verdict = view.machine ? bulletVerdict(bullet, results) : null;
          return `${verdict ? `${ICONS[verdict]} ` : ""}Done When ${bullet.number}: ${bullet.text || "(the kit doesn't say)"} · ${bullet.caseIds.length} case${bullet.caseIds.length === 1 ? "" : "s"}`;
        });
        if (kit.other) lines.push(`${kit.other} more case${kit.other === 1 ? "" : "s"} for what the change could break next to it.`);
        fold(`What it checks: ${kit.doneWhen.length ? `${kit.doneWhen.length} Done When bullet${kit.doneWhen.length === 1 ? "" : "s"}, ` : ""}${kit.other} more case${kit.other === 1 ? "" : "s"}`, lines);
      }
      if (kit.notTested.length) {
        fold(
          `Not tested, and why (${kit.notTested.length})`,
          kit.notTested.map((item) => `${item.title}${item.reason ? `: ${item.reason}` : ""}`),
        );
      }
      if (kit.proposed) box.append(el("div", `${kit.proposed} proposed case${kit.proposed === 1 ? " waits" : "s wait"} for a decision and won't run.`, "meta"));
    }
    if (view.lastRun) box.append(el("div", view.lastRun, "meta"));
    return box.childElementCount ? box : null;
  }

  // Every case of the run as its own block, with its verdict beside it; the
  // case running now shows its steps, and the runner's marks tint the step.
  private paintPlan(parts: Parts, view: PanelView): void {
    const state = view.machine;
    parts.plan.hidden = !state;
    parts.setup.replaceChildren();
    if (state && state.caseIndex < 0 && isLive(state)) {
      parts.setup.textContent = `Setup, step ${state.stepIndex + 1} of ${state.stepCount}: ${state.stepWhy ?? "preparing the data and settings the cases need"}`;
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
      const current = index === state.caseIndex && isLive(state);
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
  // never while someone is editing a block in the card.
  private scrollToNow(parts: Parts, view: PanelView): void {
    const state = view.machine;
    if (!state || !isLive(state) || state.caseIndex < 0 || !state.caseId) return;
    // Never while the run drives: scrolling the page could move what a step is about to click.
    if (!state.pending && !state.paused) return;
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
}
