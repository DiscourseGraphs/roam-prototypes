import type { MachineState, PlanCase } from "../core/machine";
import {
  KIND_WORDS,
  bugReport,
  bulletVerdict,
  clock,
  doneWhen,
  duration,
  forecast,
  forecastWords,
  howWords,
  needOf,
  pauseWords,
  purposeLine,
  resultMarkdown,
  seeAnswer,
  trouble,
  verdictWord,
  type RunFacts,
  type StepKind,
} from "./words";

// The caption bar: one bar on the window's bottom edge for the whole run. It
// says which case runs, what it must show, the step now and when the person
// is next needed; it grows upward, in place, when the run needs them; and at
// the end it opens into the result. Its buttons and text sit in a shadow root,
// so kit selectors never match them.

export type RunChoice = "watch" | "result" | "step";

export type BarModel = {
  title: string;
  state: MachineState;
  // Each case's step kinds by case id, and the setup's under "setup".
  kinds: Record<string, StepKind[]>;
  msPerStep: number;
  facts: RunFacts;
  notTested: number;
  // The block of the step that failed, when the page has one.
  stepUid: string | null;
  choice: RunChoice;
  scope: "all" | "resume" | "failed";
  // How many cases didn't pass, for "Run the ones that didn't pass".
  rerun: number;
  agent: boolean;
  startedAt: number;
  endedAt: number | null;
};

export type BarAction =
  | { kind: "command"; cmd: string; args?: Record<string, unknown> }
  | { kind: "done-by-hand" }
  | { kind: "ask-agent" }
  | { kind: "edit-step" }
  | { kind: "run" }
  | { kind: "rerun" }
  | { kind: "open-kit" }
  // The result was closed: the page's title and room for the bar go back.
  | { kind: "closed" };

const LIVE = new Set(["starting", "running", "dwell", "checking"]);
const KEEP_OPEN_KEY = "proof-runner:cases-open";

const CSS = `
  :host { all: initial; }
  :host([hidden]) { display: none !important; }
  * { box-sizing: border-box; }
  .wrap { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #efedf7; }
  .bar { background: #17151f; box-shadow: 0 -1px 0 #2d2a3b, 0 -10px 30px -18px rgba(0, 0, 0, .55); }
  .bar.strip .main, .bar.strip .ask { display: none; }
  .prog { display: flex; gap: 2px; height: 5px; background: #17151f; }
  .seg { position: relative; flex: 1; background: #38344d; }
  .seg.setup { flex: .55; background: #4a4563; }
  .seg.setup.done { background: #6c6788; }
  .seg.pass { background: #45c47e; }
  .seg.fail { background: #ff655b; }
  .seg.skip { background: #8e8aa3; }
  .seg.you { box-shadow: inset 0 -2px 0 #ffb547; }
  .seg.now > b { position: absolute; left: 0; top: 0; bottom: 0; background: #8f7fff; }
  .seg.now.am > b { background: #ffb547; }
  .main { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 24px; padding: 8px 16px 9px; }
  .left, .right { min-width: 0; }
  .ln { display: flex; align-items: center; gap: 8px; min-height: 24px; white-space: nowrap; min-width: 0; }
  .right .ln { justify-content: flex-end; }
  .sub { margin-top: 2px; color: #c7c3d8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 18px; }
  .right .sub { text-align: right; max-width: 52vw; }
  .sub b { color: #efedf7; font-weight: 650; margin-right: 4px; }
  .cn { color: #a9a5bd; flex: none; }
  .ct { font-weight: 650; font-size: 14px; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #8f7fff; box-shadow: 0 0 0 3px rgba(143, 127, 255, .25); flex: none; }
  @media (prefers-reduced-motion: no-preference) { .dot { animation: pulse 1.8s ease-in-out infinite; } }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(143, 127, 255, .08); } }
  .kd { color: #a9a5bd; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700; margin-right: 7px; }
  .fc { color: #a9a5bd; overflow: hidden; text-overflow: ellipsis; }
  .fc b { color: #9fe7bd; font-weight: 650; }
  .fc b.soon { color: #ffcf85; }
  .wait { color: #ffcf85; font-weight: 700; }
  .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 4px; white-space: nowrap; flex: none; background: rgba(255, 181, 71, .17); color: #ffcf85; }
  .pill.pass { background: rgba(69, 196, 126, .17); color: #8fe3b4; }
  .pill.fail { background: rgba(255, 101, 91, .17); color: #ffa49d; }
  .pill.grey { background: #2b2840; color: #c7c3d8; }
  button { font: 650 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #efedf7; background: #26233a;
    border: 1px solid #3d3955; border-radius: 6px; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
  button:hover { background: #2f2b47; }
  button:focus-visible { outline: 2px solid #c4bbff; outline-offset: 1px; }
  button.go { background: #8f7fff; border-color: transparent; color: #110c26; }
  button.go:hover { background: #a194ff; }
  button.pass { background: #45c47e; border-color: transparent; color: #06210f; }
  button.fail { background: #ff655b; border-color: transparent; color: #2a0603; }
  button.am { background: #ffb547; border-color: transparent; color: #2a1a00; }
  button.hot { box-shadow: 0 0 0 2px #ffb547; }
  button.link { background: none; border: 0; padding: 2px 0; color: #c4bbff; text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
  .ask { padding: 0 18px 14px; display: grid; gap: 8px; }
  .ask:empty { display: none; }
  .lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #a9a5bd; font-weight: 800; }
  .say { font-size: 15.5px; line-height: 1.45; max-width: 75ch; }
  .hint { color: #c7c3d8; max-width: 80ch; }
  .acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .grow { flex: 1; }
  input.note { font: 13px system-ui, -apple-system, sans-serif; color: #efedf7; background: #0f0e15; border: 1px solid #3d3955;
    border-radius: 6px; padding: 5px 9px; min-width: 240px; flex: 1; max-width: 520px; }
  input.note::placeholder { color: #8e8aa3; }
  input.note:focus { outline: 2px solid #8f7fff; outline-offset: 0; }
  pre { margin: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e6e2ff; background: #0e0d14;
    border: 1px solid #2f2c40; border-radius: 8px; padding: 8px 11px; max-height: 160px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
  .guide { background: rgba(255, 181, 71, .1); border-radius: 7px; padding: 7px 10px; color: #ffe2b5; max-width: 80ch; }
  .err { color: #ffa49d; padding: 0 16px 8px; }
  .err:empty { display: none; }
  .sheet { background: #1d1a28; border-top: 1px solid #34304a; max-height: 52vh; overflow: auto; box-shadow: 0 -16px 34px -14px rgba(0, 0, 0, .45); }
  .sheet.result { max-height: 78vh; padding: 16px 22px 18px; }
  .sh-hd { position: sticky; top: 0; display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: #1d1a28;
    border-bottom: 1px solid #2f2c40; font-weight: 700; }
  .crow { display: grid; grid-template-columns: 18px 24px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 4px 16px; }
  .crow .ix { color: #a9a5bd; font-variant-numeric: tabular-nums; }
  .crow .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .crow .tg { color: #a9a5bd; font-size: 12px; white-space: nowrap; }
  .crow.cur { background: rgba(143, 127, 255, .13); }
  .steps { padding: 2px 16px 8px 66px; color: #c7c3d8; display: grid; gap: 1px; background: rgba(143, 127, 255, .13); font-size: 12.5px; }
  .steps .d { color: #8e8aa3; }
  .steps .n { color: #efedf7; font-weight: 700; }
  .g { color: #45c47e; } .r { color: #ff655b; } .v { color: #a597ff; } .gr { color: #77738c; } .a { color: #ffb547; }
  .res-hd { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .big { font-size: 21px; font-weight: 750; letter-spacing: -.01em; }
  .meta { color: #a9a5bd; font-size: 12.5px; }
  .sec { margin-top: 14px; }
  .dw { display: grid; grid-template-columns: 18px 22px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 5px 0; border-bottom: 1px solid #2a2739; }
  .dw .tg { color: #a9a5bd; font-size: 12.5px; white-space: nowrap; }
  .fbox { margin-top: 8px; border: 1px solid #4a2a2a; background: rgba(255, 101, 91, .07); border-radius: 9px; padding: 9px 13px; }
  .fbox.skip { border-color: #3d3955; background: rgba(142, 138, 163, .08); }
  .kv { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 3px 10px; margin: 6px 0 8px; color: #d9d5ea; }
  .kv span:nth-child(odd) { color: #a9a5bd; }
  details { margin-top: 10px; border-top: 1px solid #2a2739; padding-top: 8px; }
  summary { cursor: pointer; color: #efedf7; }
  details ul { margin: 6px 0 0; padding-left: 18px; color: #c7c3d8; }
  .sub.lead { color: inherit; font-size: 14px; }
  /* The bar takes the frame's colour: dark while the run drives, amber when
     it's your turn, red while a failed check holds the screen. A block of
     colour says "your turn" to someone who looked away; a 3 px frame may not. */
  .bar.you { background: #f6b04a; color: #231700; box-shadow: 0 -1px 0 #c98a1e, 0 -10px 30px -18px rgba(0, 0, 0, .4); }
  .bar.held { background: #f08074; color: #2a0603; box-shadow: 0 -1px 0 #c94a40, 0 -10px 30px -18px rgba(0, 0, 0, .4); }
  .bar.you .prog, .bar.held .prog { background: transparent; }
  .bar.you .seg, .bar.held .seg { background: rgba(35, 20, 0, .2); }
  .bar.you .seg.setup.done, .bar.held .seg.setup.done { background: rgba(35, 20, 0, .4); }
  .bar.you .seg.pass, .bar.held .seg.pass { background: #17713f; }
  .bar.you .seg.fail, .bar.held .seg.fail { background: #9f241c; }
  .bar.you .seg.skip, .bar.held .seg.skip { background: #5f5a6b; }
  .bar.you .seg.now > b, .bar.held .seg.now > b { background: #231700; }
  .bar.you .seg.you, .bar.held .seg.you { box-shadow: inset 0 -2px 0 #231700; }
  .bar.you .sub, .bar.you .hint, .bar.you .cn, .bar.you .kd, .bar.you .lbl, .bar.you .meta,
  .bar.held .sub, .bar.held .hint, .bar.held .cn, .bar.held .kd, .bar.held .lbl, .bar.held .meta { color: rgba(35, 20, 0, .75); }
  .bar.you .sub b, .bar.you .wait, .bar.held .sub b, .bar.held .wait, .bar.you .sub.lead, .bar.held .sub.lead { color: inherit; }
  .bar.you .pill, .bar.held .pill { background: rgba(35, 20, 0, .14); color: inherit; }
  .bar.you button, .bar.held button { background: rgba(255, 255, 255, .55); border-color: rgba(35, 20, 0, .28); color: #231700; }
  .bar.you button:hover, .bar.held button:hover { background: rgba(255, 255, 255, .8); }
  .bar.you button.go, .bar.you button.am, .bar.held button.go { background: #231700; border-color: transparent; color: #ffd38a; }
  .bar.you button.pass, .bar.held button.pass { background: #17713f; border-color: transparent; color: #fff; }
  .bar.you button.fail, .bar.held button.fail { background: #9f241c; border-color: transparent; color: #fff; }
  .bar.you button.link, .bar.held button.link { background: none; border: 0; color: #3d2600; }
  .bar.you button.hot, .bar.held button.hot { box-shadow: 0 0 0 2px #231700; }
  .bar.you button:focus-visible, .bar.held button:focus-visible { outline-color: #231700; }
  .bar.you input.note, .bar.held input.note { background: rgba(255, 255, 255, .85); color: #231700; border-color: rgba(35, 20, 0, .3); }
  .bar.you input.note::placeholder, .bar.held input.note::placeholder { color: rgba(35, 20, 0, .5); }
  .bar.you input.note:focus, .bar.held input.note:focus { outline-color: #231700; }
  .bar.you pre, .bar.held pre { background: #1c1405; color: #ffe9c2; border-color: transparent; }
  .bar.you .guide, .bar.held .guide { background: rgba(255, 255, 255, .45); color: #231700; }
  .bar.you details, .bar.held details { border-top-color: rgba(35, 20, 0, .2); }
  .bar.you summary, .bar.held summary { color: inherit; }
  .bar.you .err, .bar.held .err { color: #7a1a12; }
  .bar.you .kv, .bar.held .kv { color: inherit; }
  .bar.you .kv span:nth-child(odd), .bar.held .kv span:nth-child(odd) { color: rgba(35, 20, 0, .7); }
`;

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const button = (label: string, action: string, className = "", args?: unknown, title?: string): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.dataset.action = action;
  if (className) node.className = className;
  if (args !== undefined) node.dataset.args = JSON.stringify(args);
  if (title) node.title = title;
  return node;
};

const ICON: Record<string, string> = { pass: "✓", fail: "✗", skip: "–" };
const ICON_CLASS: Record<string, string> = { pass: "g", fail: "r", skip: "gr" };

type Local = {
  casesOpen: boolean;
  keepOpen: boolean;
  resultOpen: boolean;
  flagOpen: boolean;
  tucked: boolean;
  // The answer to "Is what this step needs on the screen?", for one failure.
  seen: { key: string; value: boolean } | null;
  failNote: boolean;
  details: boolean;
  countdown: { until: number; timer: number } | null;
  armedStop: number;
  copied: string;
  // A skip waiting for its one-line why: Can't tell, or Skip on a by-hand case.
  why: "cant-tell" | "hand-skip" | null;
};

export class CaptionBar {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly box: HTMLElement;
  private readonly casesSheet: HTMLElement;
  private readonly resultSheet: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly prog: HTMLElement;
  private readonly left1: HTMLElement;
  private readonly left2: HTMLElement;
  private readonly right1: HTMLElement;
  private readonly right2: HTMLElement;
  private readonly ask: HTMLElement;
  private readonly err: HTMLElement;
  private model: BarModel | null = null;
  private askKey = "";
  private flash = "";
  private flashTimer = 0;
  private ticker = 0;
  private waitingSince = 0;
  private lastPending = "";
  private dodging = false;
  private readonly local: Local = {
    casesOpen: false,
    keepOpen: false,
    resultOpen: false,
    flagOpen: false,
    tucked: false,
    seen: null,
    failNote: false,
    details: false,
    countdown: null,
    armedStop: 0,
    copied: "",
    why: null,
  };

  constructor(private readonly act: (action: BarAction) => Promise<string | null> | string | null) {
    this.host = document.createElement("div");
    this.host.className = "proof-runner-bar";
    // The input layer looks through anything marked so: the bar never counts
    // as covering what a step clicks.
    this.host.setAttribute("data-proof-runner-ui", "");
    this.host.style.cssText = "position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483645;";
    this.host.hidden = true;
    this.root = this.host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;
    this.box = el("div", undefined, "wrap");
    this.casesSheet = el("div", undefined, "sheet cases");
    this.resultSheet = el("div", undefined, "sheet result");
    this.bar = el("div", undefined, "bar");
    this.prog = el("div", undefined, "prog");
    const main = el("div", undefined, "main");
    const left = el("div", undefined, "left");
    const right = el("div", undefined, "right");
    this.left1 = el("div", undefined, "ln");
    this.left2 = el("div", undefined, "sub");
    this.right1 = el("div", undefined, "ln");
    this.right2 = el("div", undefined, "sub");
    left.append(this.left1, this.left2);
    right.append(this.right1, this.right2);
    main.append(left, right);
    this.ask = el("div", undefined, "ask");
    this.ask.setAttribute("aria-live", "polite");
    this.err = el("div", "", "err");
    this.err.setAttribute("role", "status");
    this.bar.append(this.prog, main, this.ask, this.err);
    this.box.append(this.casesSheet, this.resultSheet, this.bar);
    this.root.append(style, this.box);
    try {
      this.local.keepOpen = localStorage.getItem(KEEP_OPEN_KEY) === "1";
      this.local.casesOpen = this.local.keepOpen;
    } catch {
      // No storage: closed.
    }
    // Presses keep focus where the run put it, and stay out of Roam's handlers.
    for (const type of ["mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "pointerdown"]) {
      this.box.addEventListener(type, (event) => {
        const target = event.target as Element | null;
        if (type === "mousedown" && target?.closest?.("button")) event.preventDefault();
        event.stopPropagation();
      });
    }
    this.box.addEventListener("click", (event) => {
      const target = (event.target as Element | null)?.closest?.("button") as HTMLButtonElement | null;
      if (target) void this.press(target);
    });
    this.box.addEventListener("keydown", (event) => {
      const input = event.target as HTMLElement | null;
      if (event.key === "Enter" && input?.matches?.("input.note")) {
        const submit = input.dataset.submit;
        const target = submit ? (this.root.querySelector(`button[data-action="${submit}"]`) as HTMLButtonElement | null) : null;
        if (target) void this.press(target);
      }
    });
    document.body.append(this.host);
  }

  get height(): number {
    return this.host.hidden ? 0 : this.bar.getBoundingClientRect().height;
  }

  // Whether an element sits where the bar (with an open sheet) covers it.
  covers(rect: DOMRect): boolean {
    if (this.host.hidden) return false;
    const top = this.box.getBoundingClientRect().top;
    return rect.bottom > top && rect.top < window.innerHeight;
  }

  // While a step acts on something under the bar, the bar drops to its
  // progress line and lets clicks through; it comes back after.
  setDodge(on: boolean): void {
    if (on === this.dodging) return;
    this.dodging = on;
    this.bar.classList.toggle("strip", on);
    this.casesSheet.hidden = on || !this.local.casesOpen;
    this.host.style.pointerEvents = on ? "none" : "";
  }

  openResult(): void {
    this.local.resultOpen = true;
    this.paint();
  }

  get showing(): boolean {
    return !this.host.hidden;
  }

  showError(message: string): void {
    this.flash = message;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash = "";
      this.paint();
    }, 7000);
    this.paint();
  }

  update(model: BarModel | null): void {
    const before = this.model?.state.phase;
    this.model = model;
    const phase = model?.state.phase;
    if (phase && (phase === "done" || phase === "stopped") && before && before !== "done" && before !== "stopped") {
      this.local.resultOpen = true;
      this.local.casesOpen = false;
    }
    // A new run: the case list opens again when it was kept open.
    if (phase && phase !== "done" && phase !== "stopped" && (!before || before === "done" || before === "stopped")) {
      this.local.casesOpen = this.local.keepOpen;
      this.local.resultOpen = false;
    }
    if (!model) this.local.resultOpen = false;
    this.paint();
  }

  dispose(): void {
    clearInterval(this.ticker);
    clearTimeout(this.flashTimer);
    if (this.local.countdown) clearTimeout(this.local.countdown.timer);
    this.host.remove();
  }

  private pendingKey(state: MachineState): string {
    const pending = state.pending;
    if (!pending) return state.paused ? "paused" : state.phase === "waiting-next" ? "next" : "";
    return `${pending.kind}:${pending.caseId ?? ""}:${"stepId" in pending ? pending.stepId : ""}`;
  }

  private paint(): void {
    const model = this.model;
    const state = model?.state ?? null;
    const live = Boolean(state && state.phase !== "done" && state.phase !== "stopped");
    this.host.hidden = !state || (!live && !this.local.resultOpen);
    if (!model || !state || this.host.hidden) {
      clearInterval(this.ticker);
      this.ticker = 0;
      return;
    }
    const key = this.pendingKey(state);
    if (key !== this.lastPending) {
      this.lastPending = key;
      this.waitingSince = Date.now();
      this.local.tucked = false;
      this.local.failNote = false;
      this.local.details = false;
      this.local.why = null;
      if (key) this.local.flagOpen = false;
    }
    const ticking = live && (Boolean(state.pending) || state.paused || Boolean(this.local.countdown));
    if (ticking && !this.ticker) this.ticker = window.setInterval(() => this.paint(), 1000);
    if (!ticking && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = 0;
    }
    const yours = live && (Boolean(state.pending) || state.paused || state.phase === "waiting-next" || Boolean(this.local.countdown));
    const held = live && state.pending?.kind === "check-failed";
    this.bar.classList.toggle("held", held);
    this.bar.classList.toggle("you", yours && !held);
    this.paintProgress(model);
    if (live) this.paintLines(model);
    else this.paintEnded(model);
    this.paintAsk(model);
    this.paintCases(model);
    this.paintResult(model);
    this.err.textContent = this.flash;
  }

  private paintProgress(model: BarModel): void {
    const state = model.state;
    this.prog.replaceChildren();
    const setup = el("i", undefined, `seg setup${state.caseIndex >= 0 ? " done" : ""}`);
    setup.title = "Setup";
    this.prog.append(setup);
    state.plan.forEach((item, index) => {
      const seg = el("i", undefined, "seg");
      const verdict = state.results[item.id] ?? item.verdict;
      if (verdict) seg.classList.add(verdict);
      if (needOf(item)) seg.classList.add("you");
      if (index === state.caseIndex && !verdict && state.phase !== "done" && state.phase !== "stopped") {
        seg.classList.add("now");
        if (state.pending || state.paused) seg.classList.add("am");
        const fill = el("b");
        const share = state.stepCount ? Math.min(1, (state.stepIndex + (state.executing ? 0.5 : 1)) / state.stepCount) : 1;
        fill.style.width = `${Math.round(share * 100)}%`;
        seg.append(fill);
      }
      seg.title = `${index + 1}. ${item.title}${verdict ? ` · ${verdictWord(verdict)}` : ""}`;
      this.prog.append(seg);
    });
  }

  private caseLine(state: MachineState, into: HTMLElement): void {
    const setup = state.caseIndex < 0;
    const item = state.plan[state.caseIndex];
    into.append(el("span", setup ? "Setup" : `Case ${state.caseIndex + 1} of ${state.caseCount}`, "cn"));
    into.append(el("span", setup ? `Getting the graph ready · step ${state.stepIndex + 1} of ${Math.max(1, state.stepCount)}` : (item?.title ?? state.caseTitle ?? ""), "ct"));
  }

  private stepWords(model: BarModel, ahead = false): { kind: string; text: string } {
    const state = model.state;
    const setup = state.caseIndex < 0;
    const kinds = model.kinds[setup ? "setup" : (state.caseId ?? "")] ?? [];
    const kind: StepKind = kinds[state.stepIndex] ?? "doing";
    const item = state.plan[state.caseIndex];
    let text = state.stepWhy ?? "";
    // A case's hold is when to look: a judge line beside a code check says what for.
    if (kind === "look" && item?.judge && item.hasCheck && !setup) text = item.judge;
    const count = state.stepCount ? ` · ${state.stepIndex + 1} of ${state.stepCount}` : "";
    return { kind: `${ahead ? "Next · " : ""}${KIND_WORDS[kind]}${ahead ? "" : count}`, text };
  }

  private paintLines(model: BarModel): void {
    const state = model.state;
    const pending = state.pending;
    this.left1.replaceChildren();
    this.left2.replaceChildren();
    this.right1.replaceChildren();
    this.right2.replaceChildren();
    const item = state.plan[state.caseIndex];
    const waited = clock(Date.now() - this.waitingSince);
    const left = state.plan.filter((entry) => !(state.results[entry.id] ?? entry.verdict)).length;
    if (pending) {
      const pills: Record<string, [string, string]> = {
        verdict: ["● Your call", ""],
        steps: ["● Your turn", ""],
        approval: ["● Allow code?", ""],
        failure: ["▲ A step didn't work", ""],
        "check-failed": ["✗ Failed", "fail"],
      };
      const [label, tone] = pills[pending.kind] ?? ["● Your turn", ""];
      this.left1.append(el("span", label, `pill ${tone}`));
      this.caseLine(state, this.left1);
      this.right1.append(el("span", pending.kind === "check-failed" ? "Held so you can look" : `Waiting for you · ${waited}`, "wait"));
      if (pending.kind === "check-failed") {
        this.right1.append(button(`Continue · ${Math.max(0, left - 1)} left`, "continue", "go"), button("Check again", "retry"));
      }
      this.right1.append(button(this.local.casesOpen ? "Cases ▾" : "Cases ▴", "cases"));
      this.left2.hidden = true;
      this.right2.hidden = true;
      return;
    }
    this.left2.hidden = false;
    this.right2.hidden = false;
    this.left2.classList.remove("lead");
    if (this.local.countdown) {
      this.left1.append(el("span", "❚❚ Paused", "pill"));
      this.caseLine(state, this.left1);
      const seconds = Math.max(1, Math.ceil((this.local.countdown.until - Date.now()) / 1000));
      this.right1.append(el("span", `Starting again in ${seconds}`, "wait"), button("Wait", "countdown-cancel"));
      this.left2.textContent = "Take your hands off the page: the run is about to drive it again.";
      return;
    }
    if (state.paused || state.phase === "waiting-next") {
      const stepping = !state.paused;
      this.left1.append(el("span", stepping ? "Step through" : "❚❚ Paused", "pill"));
      this.caseLine(state, this.left1);
      if (stepping) {
        this.right1.append(button("Next step", "next", "go"), button("Play on", "play-on"), this.stopButton());
        this.right2.textContent = "The run waits before each step. Next step runs one.";
      } else {
        this.right1.append(button("▶ Resume", "resume", "go"), button("Next step", "next"), this.stopButton());
        const before = state.plan[state.caseIndex - 1];
        const verdict = before ? (state.results[before.id] ?? before.verdict) : null;
        this.right2.textContent =
          state.pausedBy === "between-cases" && before
            ? `Case ${state.caseIndex} ${verdictWord(verdict).toLowerCase()}. Look around, then Resume.`
            : pauseWords(state.pausedBy ?? null);
      }
      // What runs next is what a person stepping through reads every time.
      const next = this.stepWords(model, true);
      this.left2.classList.add("lead");
      if (state.stepWhy) this.left2.append(el("span", next.kind, "kd"), document.createTextNode(next.text));
      return;
    }
    // The run drives.
    this.left1.append(el("i", undefined, "dot"));
    this.caseLine(state, this.left1);
    const purpose = purposeLine(item, state.caseIndex < 0);
    if (purpose.label) this.left2.append(el("b", purpose.label));
    this.left2.append(document.createTextNode(purpose.text));
    const ahead = forecastWords(forecast(state, model.msPerStep), state.caseIndex);
    const fc = el("span", undefined, "fc");
    fc.append(el("b", ahead.you, ahead.soon ? "soon" : ""), document.createTextNode(` · ${ahead.left}`));
    this.right1.append(fc, button("❚❚ Pause", "pause", "", undefined, "Pause (Ctrl+Alt+Space)"));
    if (state.caseIndex >= 0) this.right1.append(button("⚑ Flag", "flag", this.local.flagOpen ? "hot" : ""));
    this.right1.append(button(this.local.casesOpen ? "Cases ▾" : "Cases ▴", "cases"));
    if (state.phase === "checking") {
      this.right2.append(el("span", "Checking", "kd"), document.createTextNode(item?.checks ?? "the case's check"));
    } else if (state.stepWhy) {
      const now = this.stepWords(model);
      this.right2.append(el("span", now.kind, "kd"), document.createTextNode(now.text));
    }
  }

  private stopButton(): HTMLButtonElement {
    const armed = Date.now() < this.local.armedStop;
    return button(armed ? "Stop? Press again" : "Stop the run", "stop", armed ? "fail" : "");
  }

  private paintEnded(model: BarModel): void {
    this.left1.replaceChildren();
    this.left2.replaceChildren();
    this.right1.replaceChildren();
    this.right2.replaceChildren();
    const state = model.state;
    const failed = state.plan.filter((item) => state.results[item.id] === "fail").length;
    const passed = state.plan.filter((item) => state.results[item.id] === "pass").length;
    const stopped = state.phase === "stopped";
    this.left1.append(
      el("span", stopped ? "Stopped" : failed ? `✗ ${failed} failed` : `✓ ${passed} passed`, `pill ${stopped ? "grey" : failed ? "fail" : "pass"}`),
      el("span", `${passed} of ${state.plan.length} passed`, "ct"),
    );
    this.right1.append(button("Close", "close"));
    this.left2.hidden = true;
    this.right2.hidden = true;
  }

  // What grows above the lines when the run needs the person, or Flag is open.
  private paintAsk(model: BarModel): void {
    const state = model.state;
    const pending = state.pending;
    const live = state.phase !== "done" && state.phase !== "stopped";
    const flag = live && !pending && this.local.flagOpen && state.caseIndex >= 0;
    const seen = this.local.seen;
    const key = [
      pending ? this.pendingKey(state) : flag ? `flag:${state.caseId}` : "",
      this.local.tucked,
      this.local.failNote,
      this.local.details,
      seen?.key === this.pendingKey(state) ? String(seen.value) : "",
      this.local.copied,
      this.local.why ?? "",
    ].join("|");
    if (key === this.askKey && this.ask.childElementCount) return;
    this.askKey = key;
    this.ask.replaceChildren();
    if (!live) return;
    if (flag) {
      this.ask.append(el("div", "Flag a problem in this case", "lbl"));
      const row = el("div", undefined, "acts");
      row.append(this.noteInput("What's wrong?", "flag-note"), button("Add note", "flag-note"), button("✗ Fail this case", "flag-fail", "fail"), button("Cancel", "flag"));
      this.ask.append(row);
      return;
    }
    if (!pending) return;
    const item = state.plan.find((entry) => entry.id === pending.caseId) ?? state.plan[state.caseIndex];
    if (pending.kind === "verdict") this.askVerdict(pending.text, pending.proposal ?? null);
    else if (pending.kind === "steps") this.askByHand(item);
    else if (pending.kind === "approval") this.askApproval(pending.js, pending.why, state);
    else if (pending.kind === "failure") this.askFailure(model, pending.error, pending.stepId);
    else if (pending.kind === "check-failed") this.askCheckFailed(item, pending.error);
  }

  private noteInput(placeholder: string, submit: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "note";
    input.placeholder = placeholder;
    input.dataset.submit = submit;
    input.setAttribute("aria-label", placeholder);
    return input;
  }

  private note(): string {
    return (this.root.querySelector("input.note") as HTMLInputElement | null)?.value.trim() ?? "";
  }

  // A skip with no reason the author can act on asks for one line first.
  private askWhy(label: string, placeholder: string, confirm: string, action: string): void {
    this.ask.append(el("div", label, "lbl"));
    const row = el("div", undefined, "acts");
    const field = this.noteInput(placeholder, action);
    const go = button(confirm, action, "go");
    go.disabled = true;
    field.addEventListener("input", () => {
      go.disabled = !field.value.trim();
    });
    row.append(field, go, button("Back", "why-back"));
    this.ask.append(row);
    queueMicrotask(() => field.focus());
  }

  private askVerdict(text: string, proposal: { verdict: string; reason?: string } | null): void {
    if (this.local.why === "cant-tell") {
      this.ask.append(el("div", text, "say"));
      this.askWhy("Why can't you tell?", "One line: what's missing or unclear", "Skip: can't tell", "why-cant-tell");
      return;
    }
    if (this.local.tucked) {
      const row = el("div", undefined, "acts");
      row.append(button("✓ Yes, pass", "verdict-pass", "pass"), button("✗ No, fail", "verdict-fail", "fail"), button("Can't tell", "cant-tell"), button("Show the check ▴", "untuck", "link"));
      this.ask.append(row);
      return;
    }
    this.ask.append(el("div", text, "say"), el("div", "Is that what you see?", "hint"));
    if (proposal) this.ask.append(el("div", `Your agent thinks: ${proposal.verdict === "pass" ? "pass" : "fail"}${proposal.reason ? `. ${proposal.reason}` : "."}`, "hint"));
    const row = el("div", undefined, "acts");
    row.append(
      button("✓ Yes, pass", "verdict-pass", "pass"),
      button("✗ No, fail", "verdict-fail", "fail"),
      button("Can't tell", "cant-tell"),
      this.noteInput("Add a note (what you saw)", ""),
      button("Hide to look ▾", "tuck", "link"),
    );
    this.ask.append(row);
  }

  private askByHand(item: PlanCase | undefined): void {
    if (this.local.why === "hand-skip") {
      this.ask.append(el("div", item?.intent ?? "Do what this case says.", "say"));
      this.askWhy("Why skip this case?", "One line: what stopped you", "Skip this case", "why-hand-skip");
      return;
    }
    this.ask.append(el("div", "Do this by hand", "lbl"), el("div", item?.intent ?? "Do what this case says.", "say"));
    const checked = Boolean(item?.hasCheck);
    this.ask.append(
      el("div", checked ? "Roam is yours. Press Done when you've done it, and the case's check decides." : "Roam is yours. The run won't touch anything until you answer.", "hint"),
    );
    const row = el("div", undefined, "acts");
    if (checked) row.append(button("Done", "done-by-hand", "go"));
    else row.append(button("✓ Done, it worked", "hand-pass", "pass"), button("✗ Done, it didn't", "hand-fail", "fail"));
    row.append(button("Skip this case", "hand-skip"));
    if (!checked) row.append(this.noteInput("Add a note (optional)", ""));
    if (!this.model?.agent) row.append(button("Ask your agent to do it", "ask-agent", "link"));
    this.ask.append(row);
  }

  private askApproval(js: string, why: string, state: MachineState): void {
    const step = state.plan[state.caseIndex]?.steps[state.stepIndex];
    const who = step?.source === "you" ? "You wrote" : "Your agent wrote";
    this.ask.append(el("div", `${who} this step: ${why}`, "say"), el("pre", js));
    this.ask.append(el("div", "It runs in this tab with your Roam access, so it can read and change this graph. Steps saved in the kit never ask.", "hint"));
    const row = el("div", undefined, "acts");
    const args = { stepId: (state.pending as { stepId: string }).stepId };
    row.append(button("Allow once", "approve", "am", args), button("Don't run it", "deny", "", args));
    row.append(el("span", "Don't run it skips this step; the case may fail without it.", "meta"));
    this.ask.append(row);
  }

  private askFailure(model: BarModel, error: string, stepId: string): void {
    const state = model.state;
    const found = trouble(error);
    const key = this.pendingKey(state);
    this.ask.append(el("div", `Step ${state.stepIndex + 1} of ${Math.max(1, state.stepCount)} · ${state.stepWhy ?? ""}`, "lbl"), el("div", found.plain, "say"));
    const seen = this.local.seen?.key === key ? this.local.seen.value : null;
    const row = el("div", undefined, "acts");
    row.append(
      button("↻ Try again", "retry", seen === null ? "go" : ""),
      button("Skip this case", "skip-failed", seen === true ? "go" : ""),
      button("✗ Fail this case…", "fail-open", seen === false ? "fail" : ""),
    );
    this.ask.append(row);
    if (this.local.failNote) {
      const note = el("div", undefined, "acts");
      note.append(this.noteInput("What do you see instead?", "fail-failed"), button("Fail this case", "fail-failed", "fail"));
      this.ask.append(note);
    }
    if (found.kind === "kit-code") {
      this.ask.append(el("div", "That's a problem with the kit, not the PR. Skip this case so the result lists it as couldn't run.", "guide"));
    } else if (found.kind === "database") {
      this.ask.append(el("div", "Check that this machine is still connected (the proof database runs on it), then try again.", "guide"));
    } else if (seen === null) {
      const ask = el("div", undefined, "acts");
      const what = found.looksFor ? `“${found.looksFor}”` : "what this step needs";
      ask.append(
        el("span", `Still stuck? Can you see ${what} on the screen?`, "hint"),
        button("Yes, it's there", "seen-yes"),
        button("No", "seen-no"),
      );
      this.ask.append(ask);
    } else {
      this.ask.append(el("div", seeAnswer(seen), "guide"));
    }
    const details = el("details") as HTMLDetailsElement;
    details.open = this.local.details;
    details.addEventListener("toggle", () => {
      this.local.details = details.open;
    });
    details.append(el("summary", "Details for the kit's author"));
    details.append(el("pre", error));
    const fix = el("div", undefined, "acts");
    if (model.stepUid) fix.append(button("Edit this step", "edit-step"), el("span", "Opens its block in the right sidebar; fix it, then Try again.", "meta"));
    fix.append(button("Skip just this step", "skip-step", "", { stepId }));
    if (!model.agent) fix.append(button("Ask your agent to fix it", "ask-agent", "link"));
    details.append(fix);
    this.ask.append(details);
  }

  private askCheckFailed(item: PlanCase | undefined, error: string): void {
    const box = el("div", undefined, "kv");
    box.append(el("span", "Expected"), el("span", item?.checks ?? item?.judge ?? "The case's check to hold."), el("span", "Found"), el("span", error));
    this.ask.append(box);
    this.ask.append(el("div", "The run holds here so you can look at the screen, or open devtools. Continue records the failure and goes on.", "hint"));
    const row = el("div", undefined, "acts");
    row.append(this.noteInput("Add a note for the author (optional)", "continue"));
    this.ask.append(row);
  }

  private paintCases(model: BarModel): void {
    const sheet = this.casesSheet;
    const state = model.state;
    const live = state.phase !== "done" && state.phase !== "stopped";
    sheet.hidden = !live || !this.local.casesOpen || this.dodging;
    if (sheet.hidden) {
      sheet.replaceChildren();
      return;
    }
    sheet.replaceChildren();
    const passed = state.plan.filter((item) => (state.results[item.id] ?? item.verdict) === "pass").length;
    const head = el("div", undefined, "sh-hd");
    head.append(el("span", `Cases · ${state.plan.length}`), el("span", `${passed} passed`, "meta"), el("span", undefined, "grow"));
    head.append(button(this.local.keepOpen ? "Kept open" : "Keep open", "keep-open", this.local.keepOpen ? "hot" : ""), button("✕", "cases", "", undefined, "Close the list"));
    sheet.append(head);
    const { bullets } = doneWhen(state.plan);
    state.plan.forEach((item, index) => {
      const verdict = state.results[item.id] ?? item.verdict;
      const current = index === state.caseIndex;
      const row = el("div", undefined, `crow${current ? " cur" : ""}`);
      const icon = verdict ? ICON[verdict] : current ? "▶" : "○";
      const tone = verdict ? ICON_CLASS[verdict] : current ? "v" : "gr";
      const covers = bullets.filter((bullet) => bullet.caseIds.includes(item.id)).map((bullet) => bullet.number);
      const need = needOf(item);
      const tag = verdict
        ? howWords(verdict, item.record ?? null)
        : [covers.length ? `Done When ${covers.join(", ")}` : "", need === "judge" ? "you'll judge" : need === "by-hand" ? "by hand" : ""].filter(Boolean).join(" · ");
      row.append(el("span", icon, tone), el("span", String(index + 1), "ix"), el("span", item.title, "tt"), el("span", tag, "tg"));
      row.title = item.title;
      sheet.append(row);
      if (current) {
        const steps = el("div", undefined, "steps");
        const purpose = purposeLine(item, false);
        const line = el("div");
        if (purpose.label) line.append(el("b", `${purpose.label} `));
        line.append(document.createTextNode(purpose.text));
        steps.append(line);
        const kinds = model.kinds[item.id] ?? [];
        item.steps.forEach((step, at) => {
          const done = at < state.stepIndex;
          const now = at === state.stepIndex;
          const kind = KIND_WORDS[kinds[at] ?? "doing"];
          steps.append(el("div", `${done ? "✓" : now ? "▶" : "○"} ${step.why}${kind === "Doing" ? "" : ` (${kind.toLowerCase()})`}`, done ? "d" : now ? "n" : ""));
        });
        sheet.append(steps);
      }
    });
  }

  private paintResult(model: BarModel): void {
    const sheet = this.resultSheet;
    const state = model.state;
    const ended = state.phase === "done" || state.phase === "stopped";
    sheet.hidden = !ended || !this.local.resultOpen;
    sheet.replaceChildren();
    if (sheet.hidden) return;
    const plan = state.plan;
    const results = state.results;
    const count = (verdict: string): number => plan.filter((item) => results[item.id] === verdict).length;
    const failed = count("fail");
    const stopped = state.phase === "stopped";
    const head = el("div", undefined, "res-hd");
    head.append(
      el("span", stopped ? "Stopped" : failed ? `✗ ${failed} failed` : count("skip") ? `${count("skip")} couldn't run` : "✓ All passed", `pill ${stopped ? "grey" : failed ? "fail" : count("skip") ? "" : "pass"}`),
      el("span", `${count("pass")} of ${plan.length} passed`, "big"),
      el("span", undefined, "grow"),
    );
    const facts = model.facts;
    const where = [facts.pr ? `PR #${facts.pr}` : null, facts.build ? `build ${facts.build}${facts.latest ? ", the PR's latest" : facts.latest === false ? ", behind the PR's head" : ""}` : null]
      .filter(Boolean)
      .join(" · ");
    if (where) head.append(el("span", where, "meta"));
    sheet.append(head);
    const { bullets, other } = doneWhen(plan);
    if (bullets.length) {
      const holding = bullets.filter((bullet) => bulletVerdict(bullet, results) === "pass").length;
      sheet.append(el("div", `Done When: ${holding} of ${bullets.length} bullet${bullets.length === 1 ? "" : "s"} pass${stopped ? " so far" : ""}.`, "meta"));
      const sec = el("div", undefined, "sec");
      sec.append(el("div", `Done When${facts.ticket ? ` · ${facts.ticket}` : ""}`, "lbl"));
      for (const bullet of bullets) {
        const verdict = bulletVerdict(bullet, results);
        const row = el("div", undefined, "dw");
        const size = `${bullet.caseIds.length} case${bullet.caseIds.length === 1 ? "" : "s"}`;
        row.append(
          el("span", verdict ? ICON[verdict] : "○", verdict ? ICON_CLASS[verdict] : "gr"),
          el("span", String(bullet.number), "meta"),
          el("span", bullet.text || "(the kit doesn't say)"),
          el("span", verdict === "fail" ? `${size}, failed` : verdict === "skip" ? `${size}, couldn't run` : verdict ? size : `${size}, didn't run`, `tg${verdict === "fail" ? " r" : ""}`),
        );
        sec.append(row);
      }
      sheet.append(sec);
    }
    const failures = plan.filter((item) => results[item.id] === "fail" || results[item.id] === "skip");
    if (failures.length) {
      const sec = el("div", undefined, "sec");
      sec.append(el("div", count("fail") ? "Failed" : "Couldn't run", "lbl"));
      for (const item of failures) {
        const index = plan.indexOf(item);
        const verdict = results[item.id];
        const box = el("div", undefined, `fbox${verdict === "skip" ? " skip" : ""}`);
        box.append(el("div", `${ICON[verdict]} Case ${index + 1} · ${item.title}`, "ft"));
        const kv = el("div", undefined, "kv");
        kv.append(
          el("span", "Expected"),
          el("span", item.checks ?? item.judge ?? "Every step runs."),
          el("span", verdict === "skip" ? "What happened" : "Found"),
          el("span", `${item.note ?? (verdict === "skip" ? "A step didn't work." : "The check gave no message.")}${item.record ? ` · ${howWords(verdict, item.record)}` : ""}`),
        );
        box.append(kv);
        if (verdict === "fail") box.append(button(this.local.copied === `bug:${item.id}` ? "Copied" : "Copy bug report", "copy-bug", "", { caseId: item.id }));
        sec.append(box);
      }
      sheet.append(sec);
    }
    const sec = el("div", undefined, "sec");
    if (bullets.length && other.length) {
      const others = plan.filter((item) => other.includes(item.id));
      const ok = others.filter((item) => results[item.id] === "pass").length;
      sec.append(this.foldList(`Other cases: ${ok} of ${others.length} passed`, others.map((item) => `${ICON[results[item.id]] ?? "○"} ${item.title} · ${howWords(results[item.id] ?? null, item.record ?? null)}`)));
    } else if (!bullets.length) {
      sec.append(this.foldList(`Every case: ${count("pass")} of ${plan.length} passed`, plan.map((item) => `${ICON[results[item.id]] ?? "○"} ${item.title} · ${howWords(results[item.id] ?? null, item.record ?? null)}`)));
    }
    if (model.notTested) sec.append(el("div", `Not tested, and why: ${model.notTested} on the proof page.`, "meta"));
    const took = (model.endedAt ?? Date.now()) - model.startedAt;
    const skippedSteps = plan.reduce((sum, item) => sum + (item.record?.skippedSteps.length ?? 0), 0);
    const retries = plan.reduce((sum, item) => sum + (item.record?.retries ?? 0), 0);
    const how = [
      model.choice === "watch" ? "watched" : model.choice === "step" ? "stepped through" : "just the result",
      model.scope === "failed" ? "re-ran the cases that didn't pass" : model.scope === "resume" ? "resumed" : "",
      duration(took).replace(/^about /, ""),
      skippedSteps ? `${skippedSteps} step${skippedSteps === 1 ? "" : "s"} skipped` : "no steps skipped",
      retries ? `${retries} tr${retries === 1 ? "y" : "ies"} again` : "",
      facts.when,
    ]
      .filter(Boolean)
      .join(" · ");
    sec.append(el("div", `How this run went: ${how}`, "meta"));
    sheet.append(sec);
    const acts = el("div", undefined, "acts sec");
    acts.append(
      button(this.local.copied === "result" ? "Copied" : "Copy result for the PR", "copy-result", "go"),
      button("Run again", "run"),
    );
    if (model.rerun) acts.append(button(`Run the ${model.rerun === 1 ? "one" : model.rerun} that didn't pass`, "rerun"));
    acts.append(button("Open the kit page", "open-kit"), button("Close", "close"));
    sheet.append(acts);
    if (model.rerun) sheet.append(el("div", "Cases can build on earlier ones. If one fails on its own but passed in a full run, run them all.", "meta"));
  }

  private foldList(summary: string, lines: string[]): HTMLElement {
    const details = el("details");
    details.append(el("summary", summary));
    const list = el("ul");
    for (const line of lines) list.append(el("li", line));
    details.append(list);
    return details;
  }

  private async copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.local.copied = what;
      this.paint();
      window.setTimeout(() => {
        if (this.local.copied === what) this.local.copied = "";
        this.paint();
      }, 2000);
    } catch {
      this.showError("The browser didn't allow copying. Select the text in the result instead.");
    }
  }

  private send(action: BarAction): void {
    void Promise.resolve(this.act(action)).then((error) => {
      if (error) this.showError(error);
    });
  }

  private command(cmd: string, args: Record<string, unknown> = {}): void {
    this.send({ kind: "command", cmd, args });
  }

  private async press(target: HTMLButtonElement): Promise<void> {
    const action = target.dataset.action ?? "";
    const args = target.dataset.args ? (JSON.parse(target.dataset.args) as Record<string, unknown>) : {};
    const model = this.model;
    const state = model?.state;
    const note = this.note();
    const withNote = (extra: Record<string, unknown> = {}): Record<string, unknown> => (note ? { ...extra, note } : extra);
    switch (action) {
      case "cases":
        this.local.casesOpen = !this.local.casesOpen;
        break;
      case "keep-open":
        this.local.keepOpen = !this.local.keepOpen;
        try {
          localStorage.setItem(KEEP_OPEN_KEY, this.local.keepOpen ? "1" : "0");
        } catch {
          // This tab only.
        }
        break;
      case "flag":
        this.local.flagOpen = !this.local.flagOpen;
        break;
      case "flag-note":
        if (!note) return this.showError("Type what's wrong first.");
        this.command("note", { text: note, caseId: state?.caseId });
        this.local.flagOpen = false;
        break;
      case "flag-fail":
        this.command("verdict", withNote({ verdict: "fail" }));
        this.local.flagOpen = false;
        break;
      case "tuck":
      case "untuck":
        this.local.tucked = action === "tuck";
        break;
      case "verdict-pass":
        this.command("verdict", withNote({ verdict: "pass" }));
        break;
      case "verdict-fail":
        this.command("verdict", withNote({ verdict: "fail" }));
        break;
      case "cant-tell":
        if (note) this.command("skip-case", { note: `Can't tell: ${note}` });
        else this.local.why = "cant-tell";
        break;
      case "why-cant-tell":
        if (!note) return this.showError("Say in one line why you can't tell.");
        this.command("skip-case", { note: `Can't tell: ${note}` });
        break;
      case "hand-skip":
        if (note) this.command("skip-case", { note });
        else this.local.why = "hand-skip";
        break;
      case "why-hand-skip":
        if (!note) return this.showError("Say in one line why you're skipping it.");
        this.command("skip-case", { note });
        break;
      case "why-back":
        this.local.why = null;
        break;
      case "hand-pass":
        this.command("verdict", withNote({ verdict: "pass" }));
        break;
      case "hand-fail":
        this.command("verdict", withNote({ verdict: "fail" }));
        break;
      case "done-by-hand":
        this.send({ kind: "done-by-hand" });
        break;
      case "skip-case":
        this.command("skip-case", withNote());
        break;
      case "skip-failed":
        this.command("skip-case", { note: note || (this.local.seen?.value ? "The step is out of date: what it needs is on the screen." : "A step didn't work.") });
        break;
      case "fail-open":
        this.local.failNote = true;
        break;
      case "fail-failed":
        this.command("verdict", withNote({ verdict: "fail" }));
        break;
      case "seen-yes":
      case "seen-no":
        if (state) this.local.seen = { key: this.pendingKey(state), value: action === "seen-yes" };
        if (action === "seen-no") this.local.failNote = true;
        break;
      case "continue":
        this.command("continue", withNote());
        break;
      case "resume": {
        if (this.local.countdown) break;
        const timer = window.setTimeout(() => {
          this.local.countdown = null;
          this.command("resume");
        }, 3000);
        this.local.countdown = { until: Date.now() + 3000, timer };
        break;
      }
      case "countdown-cancel":
        if (this.local.countdown) clearTimeout(this.local.countdown.timer);
        this.local.countdown = null;
        break;
      case "play-on":
        this.command("mode", { mode: "auto" });
        break;
      case "stop":
        if (Date.now() < this.local.armedStop) {
          this.local.armedStop = 0;
          this.command("stop");
        } else {
          this.local.armedStop = Date.now() + 3000;
          window.setTimeout(() => this.paint(), 3100);
        }
        break;
      case "close":
        this.local.resultOpen = false;
        this.paint();
        this.send({ kind: "closed" });
        return;
      case "copy-result":
        if (model) await this.copy(resultMarkdown(model.state, model.facts, model.notTested), "result");
        return;
      case "copy-bug": {
        const item = model?.state.plan.find((entry) => entry.id === args.caseId);
        if (model && item) await this.copy(bugReport(item, model.state.plan.indexOf(item), model.facts), `bug:${item.id}`);
        return;
      }
      case "ask-agent":
        this.send({ kind: "ask-agent" });
        break;
      case "edit-step":
        this.send({ kind: "edit-step" });
        break;
      case "run":
      case "rerun":
        this.local.resultOpen = false;
        this.send({ kind: action });
        break;
      case "open-kit":
        this.send({ kind: "open-kit" });
        break;
      default:
        this.command(action, args);
    }
    this.paint();
  }
}
