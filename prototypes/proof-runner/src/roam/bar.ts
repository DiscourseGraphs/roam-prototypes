import type { MachineState, PlanCase } from "../core/machine";
import {
  PACES,
  PAUSES,
  bugReport,
  bulletVerdict,
  clock,
  doneWhen,
  duration,
  forecast,
  forecastWords,
  historyLine,
  holdLine,
  howWords,
  kitFixes,
  kitReport,
  needOf,
  paceLabel,
  plainText,
  passedWithHelp,
  pauseLabel,
  pauseWords,
  purposeLine,
  resultMarkdown,
  runWords,
  trouble,
  verdictWord,
  type CaseHistory,
  type PauseSetting,
  type RunFacts,
  type StepKind,
} from "./words";

// The caption bar: one bar on the window's bottom edge for the whole run. It
// says which case runs, what it must show, the step now and when the person
// is next needed; it grows upward, in place, when the run needs them; and at
// the end it opens into the result. The case's title and its Passes if line
// are never cut off: they wrap, and the bar grows to fit. Its buttons and text
// sit in a shadow root, so kit selectors never match them.

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
  // When the run pauses for the person; the pace is the machine's speed.
  pause: PauseSetting;
  scope: "all" | "resume" | "failed";
  // How many cases didn't pass, for "Run the ones that didn't pass".
  rerun: number;
  agent: boolean;
  startedAt: number;
  endedAt: number | null;
  // Whether each case has passed in a recorded run, by case id.
  history: Record<string, CaseHistory>;
};

export type BarAction =
  | { kind: "command"; cmd: string; args?: Record<string, unknown> }
  | { kind: "done-by-hand" }
  | { kind: "ask-agent" }
  | { kind: "edit-step" }
  | { kind: "run" }
  | { kind: "rerun" }
  | { kind: "open-kit" }
  // A run setting changed during the run.
  | { kind: "setting"; key: "pause"; value: PauseSetting }
  | { kind: "setting"; key: "pace"; value: number }
  // The person took a failed step on themselves, or handed it back: who has
  // the screen changed without the machine knowing.
  | { kind: "turn" }
  // The result was closed: the page's title and room for the bar go back.
  | { kind: "closed" };

const LIVE = new Set(["starting", "running", "dwell", "checking"]);
const KEEP_OPEN_KEY = "proof-runner:cases-open";

const CSS = `
  :host { all: initial; }
  :host([hidden]) { display: none !important; }
  * { box-sizing: border-box; }
  .wrap { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #efedf7; }
  .bar { position: relative; background: #17151f; box-shadow: 0 -1px 0 #2d2a3b, 0 -10px 30px -18px rgba(0, 0, 0, .55); }
  .bar.strip .main, .bar.strip .ask, .bar.strip .menu { display: none; }
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
  .main { display: grid; gap: 3px; padding: 8px 16px 9px; }
  .head { display: flex; align-items: baseline; gap: 4px 8px; flex-wrap: wrap; min-height: 22px; }
  .head .dot, .head .pill { align-self: center; }
  .head .ct { flex: 1 1 18rem; min-width: 0; font-weight: 650; font-size: 14px; overflow-wrap: anywhere; }
  .head .wait { margin-left: auto; }
  .purpose { color: #c7c3d8; overflow-wrap: anywhere; }
  .purpose:empty { display: none; }
  .purpose b { color: #efedf7; font-weight: 650; margin-right: 4px; }
  .purpose.lead { color: inherit; font-size: 14px; }
  .foot { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; min-height: 26px; }
  .foot:empty { display: none; }
  .now { flex: 1 1 14rem; min-width: 0; color: #c7c3d8; overflow-wrap: anywhere; }
  .ctrl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
  .cn { color: #a9a5bd; flex: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #8f7fff; box-shadow: 0 0 0 3px rgba(143, 127, 255, .25); flex: none; }
  @media (prefers-reduced-motion: no-preference) { .dot { animation: pulse 1.8s ease-in-out infinite; } }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(143, 127, 255, .08); } }
  .kd { color: #a9a5bd; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700; margin-right: 7px; }
  .fc { color: #a9a5bd; }
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
  button:disabled { opacity: .55; cursor: not-allowed; }
  button.go { background: #8f7fff; border-color: transparent; color: #110c26; }
  button.go:hover { background: #a194ff; }
  button.pass { background: #45c47e; border-color: transparent; color: #06210f; }
  button.fail { background: #ff655b; border-color: transparent; color: #2a0603; }
  button.am { background: #ffb547; border-color: transparent; color: #2a1a00; }
  button.hot { box-shadow: 0 0 0 2px #ffb547; }
  button.link { background: none; border: 0; padding: 2px 0; color: #c4bbff; text-decoration: underline; text-underline-offset: 3px; font-weight: 500; }
  button.chip.hot { box-shadow: 0 0 0 2px #8f7fff; }
  .menu { position: absolute; right: 16px; bottom: calc(100% + 6px); width: 330px; max-width: calc(100vw - 32px); background: #1d1a28; color: #efedf7;
    border: 1px solid #34304a; border-radius: 10px; box-shadow: 0 -14px 34px -12px rgba(0, 0, 0, .5); padding: 10px 12px 12px; display: grid; gap: 4px; }
  .menu[hidden] { display: none; }
  .menu button.opt { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 1px 6px; text-align: left; white-space: normal; background: none;
    border: 0; border-radius: 6px; padding: 5px 6px; font-weight: 500; color: #efedf7; }
  .menu button.opt:hover { background: #26233a; }
  .menu button.opt.on { background: rgba(143, 127, 255, .16); }
  .menu button.opt .rd { color: #a597ff; }
  .menu button.opt small { grid-column: 2; color: #a9a5bd; font-size: 11.5px; line-height: 1.35; }
  .menu .paces { display: flex; gap: 6px; padding: 2px 4px; }
  .menu button.pick.on { background: #8f7fff; border-color: transparent; color: #110c26; }
  .menu .lbl { margin: 4px 4px 2px; }
  .menu .meta { margin: 4px 4px 0; }
  .ask { padding: 0 18px 14px; display: grid; gap: 8px; }
  .ask:empty { display: none; }
  .lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #a9a5bd; font-weight: 800; }
  .say { font-size: 15.5px; line-height: 1.45; max-width: 75ch; overflow-wrap: anywhere; }
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
  .crow .tt { overflow-wrap: anywhere; }
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
  .kbox { margin-top: 8px; border: 1px solid #5a4317; background: rgba(255, 181, 71, .08); border-radius: 9px; padding: 8px 13px 10px; }
  .krow { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 2px 8px; padding: 5px 0; border-bottom: 1px solid rgba(255, 181, 71, .16); }
  .krow .ix { color: #ffcf85; font-weight: 700; }
  .krow .tt { font-weight: 650; }
  .krow .wh { grid-column: 2; color: #d9d5ea; }
  .kv { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 3px 10px; margin: 6px 0 8px; color: #d9d5ea; }
  .kv span { overflow-wrap: anywhere; }
  .kv span:nth-child(odd) { color: #a9a5bd; }
  details { margin-top: 10px; border-top: 1px solid #2a2739; padding-top: 8px; }
  summary { cursor: pointer; color: #efedf7; }
  details ul { margin: 6px 0 0; padding-left: 18px; color: #c7c3d8; }
  /* The bar takes the frame's colour: dark while the run drives, amber when
     it's your turn, red while a failure waits for your answer. A block of
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
  .bar.you .purpose, .bar.you .now, .bar.you .hint, .bar.you .cn, .bar.you .kd, .bar.you .lbl, .bar.you .meta, .bar.you .fc,
  .bar.held .purpose, .bar.held .now, .bar.held .hint, .bar.held .cn, .bar.held .kd, .bar.held .lbl, .bar.held .meta, .bar.held .fc { color: rgba(35, 20, 0, .75); }
  .bar.you .purpose b, .bar.you .wait, .bar.held .purpose b, .bar.held .wait, .bar.you .purpose.lead, .bar.held .purpose.lead { color: inherit; }
  .bar.you .pill, .bar.held .pill { background: rgba(35, 20, 0, .14); color: inherit; }
  .bar.you .main button, .bar.you .ask button, .bar.held .main button, .bar.held .ask button { background: rgba(255, 255, 255, .55); border-color: rgba(35, 20, 0, .28); color: #231700; }
  .bar.you .main button:hover, .bar.you .ask button:hover, .bar.held .main button:hover, .bar.held .ask button:hover { background: rgba(255, 255, 255, .8); }
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

// What the plain words of a failed check are, when its message is one the
// run knows: a wait that timed out.
const checkWords = (error: string): string => {
  const found = trouble(error);
  return found.kind === "not-found" ? found.plain.replace(/^The run looked for/, "The check looked for") : error.split("\n")[0].trim();
};

// A prompt for one line before an answer goes: required, or optional.
type Why = { label: string; placeholder: string; confirm: string; className: string; action: string; required: boolean };

type Local = {
  casesOpen: boolean;
  keepOpen: boolean;
  resultOpen: boolean;
  flagOpen: boolean;
  menuOpen: boolean;
  tucked: boolean;
  details: boolean;
  // A failed step the person is doing themselves: the pending key it's for.
  doingIt: string;
  countdown: { until: number; timer: number; cmd: string } | null;
  armedStop: number;
  copied: string;
  // An answer waiting for its one line.
  why: Why | null;
};

export class CaptionBar {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly box: HTMLElement;
  private readonly casesSheet: HTMLElement;
  private readonly resultSheet: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly prog: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly head: HTMLElement;
  private readonly purpose: HTMLElement;
  private readonly foot: HTMLElement;
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
  private readonly sizer: ResizeObserver | null;
  private readonly local: Local = {
    casesOpen: false,
    keepOpen: false,
    resultOpen: false,
    flagOpen: false,
    menuOpen: false,
    tucked: false,
    details: false,
    doingIt: "",
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
    this.menu = el("div", undefined, "menu");
    this.menu.setAttribute("role", "dialog");
    this.menu.setAttribute("aria-label", "Run settings");
    this.menu.hidden = true;
    const main = el("div", undefined, "main");
    this.head = el("div", undefined, "head");
    this.purpose = el("div", undefined, "purpose");
    this.foot = el("div", undefined, "foot");
    main.append(this.head, this.purpose, this.foot);
    this.ask = el("div", undefined, "ask");
    this.ask.setAttribute("aria-live", "polite");
    this.err = el("div", "", "err");
    this.err.setAttribute("role", "status");
    this.bar.append(this.menu, this.prog, main, this.ask, this.err);
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
        if (target && !target.disabled) void this.press(target);
      }
      if (event.key === "Escape" && this.local.menuOpen) {
        this.local.menuOpen = false;
        this.paint();
      }
    });
    document.body.append(this.host);
    // Roam makes room for the bar: its height goes to --proof-runner-h.
    this.sizer = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.publishHeight()) : null;
    this.sizer?.observe(this.box);
  }

  // The space the runner takes at the bottom of the window. Not while the bar
  // has stepped aside for one step: Roam would move under the step.
  private publishHeight(): void {
    if (this.dodging) return;
    const height = this.host.hidden ? 0 : Math.ceil(this.box.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--proof-runner-h", `${height}px`);
  }

  get height(): number {
    return this.host.hidden ? 0 : this.bar.getBoundingClientRect().height;
  }

  // Whether the person took a failed step on themselves: the screen is theirs.
  get doingIt(): boolean {
    const state = this.model?.state;
    return Boolean(state && this.local.doingIt && this.local.doingIt === this.pendingKey(state));
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
      this.local.menuOpen = false;
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
    this.sizer?.disconnect();
    document.documentElement.style.removeProperty("--proof-runner-h");
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
      this.publishHeight();
      return;
    }
    const key = this.pendingKey(state);
    if (key !== this.lastPending) {
      this.lastPending = key;
      this.waitingSince = Date.now();
      this.local.tucked = false;
      this.local.details = false;
      this.local.why = null;
      if (key) this.local.flagOpen = false;
      if (this.local.doingIt && this.local.doingIt !== key) this.local.doingIt = "";
    }
    const ticking = live && (Boolean(state.pending) || state.paused || Boolean(this.local.countdown));
    if (ticking && !this.ticker) this.ticker = window.setInterval(() => this.paint(), 1000);
    if (!ticking && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = 0;
    }
    const failure = state.pending?.kind === "failure" || state.pending?.kind === "check-failed";
    const held = live && failure && !this.doingIt;
    const yours = live && (Boolean(state.pending) || state.paused || state.phase === "waiting-next" || Boolean(this.local.countdown));
    this.bar.classList.toggle("held", held);
    this.bar.classList.toggle("you", yours && !held);
    this.paintProgress(model);
    if (live) this.paintLines(model);
    else this.paintEnded(model);
    this.paintMenu(model, live);
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
      seg.title = `${index + 1}. ${plainText(item.title)}${verdict ? ` · ${verdictWord(verdict)}` : ""}`;
      this.prog.append(seg);
    });
  }

  // The case's number and its whole title.
  private caseLine(state: MachineState, into: HTMLElement): void {
    const setup = state.caseIndex < 0;
    const item = state.plan[state.caseIndex];
    into.append(el("span", setup ? "Setup" : `Case ${state.caseIndex + 1} of ${state.caseCount}`, "cn"));
    into.append(el("span", setup ? `Getting the graph ready · step ${state.stepIndex + 1} of ${Math.max(1, state.stepCount)}` : plainText(item?.title ?? state.caseTitle ?? ""), "ct"));
  }

  // What the case must show, in full.
  private purposeOf(state: MachineState, into: HTMLElement): void {
    const purpose = purposeLine(state.plan[state.caseIndex], state.caseIndex < 0);
    if (purpose.label) into.append(el("b", purpose.label));
    into.append(document.createTextNode(purpose.text));
  }

  // The step's own words, with where it is in the case. A hold says what to
  // look at: the judge line beside a code check, or the case's Passes if
  // when the kit's line only names a place.
  private stepWords(model: BarModel, ahead = false): { kind: string; text: string } {
    const state = model.state;
    const setup = state.caseIndex < 0;
    const kinds = model.kinds[setup ? "setup" : (state.caseId ?? "")] ?? [];
    const kind: StepKind = kinds[state.stepIndex] ?? "doing";
    const item = state.plan[state.caseIndex];
    let text = plainText(state.stepWhy ?? "");
    if (kind === "look" && !setup) text = holdLine(state.stepWhy ?? "", item);
    const count = state.stepCount ? `Step ${state.stepIndex + 1} of ${state.stepCount}` : "Step";
    return { kind: ahead ? "Next" : count, text };
  }

  // The setting chip: when the run pauses, and its pace. It opens the menu.
  private chip(model: BarModel): HTMLButtonElement {
    const label = `${pauseLabel(model.pause)} · ${paceLabel(model.state.speed)} ${this.local.menuOpen ? "▾" : "▴"}`;
    const chip = button(label, "settings", `chip${this.local.menuOpen ? " hot" : ""}`, undefined, "When the run pauses, and how fast it goes");
    chip.setAttribute("aria-expanded", String(this.local.menuOpen));
    return chip;
  }

  private paintLines(model: BarModel): void {
    const state = model.state;
    const pending = state.pending;
    this.head.replaceChildren();
    this.purpose.replaceChildren();
    this.foot.replaceChildren();
    this.purpose.classList.remove("lead");
    const waited = clock(Date.now() - this.waitingSince);
    const ctrl = el("div", undefined, "ctrl");
    const cases = button(this.local.casesOpen ? "Cases ▾" : "Cases ▴", "cases");
    if (pending) {
      const pills: Record<string, [string, string]> = {
        verdict: ["● Your call", ""],
        steps: ["● Your turn", ""],
        approval: ["● Allow code?", ""],
        failure: [this.doingIt ? "● Your turn" : "✗ A step didn't work", ""],
        "check-failed": ["✗ The check failed", ""],
      };
      const [label, tone] = pills[pending.kind] ?? ["● Your turn", ""];
      this.head.append(el("span", label, `pill ${tone}`));
      this.caseLine(state, this.head);
      this.head.append(el("span", `Waiting for you · ${waited}`, "wait"));
      // A step that didn't work shows what "works" means for the case. A
      // failed check shows it as Expected; a call by eye and a case by hand
      // carry their line in the ask.
      if (pending.kind === "failure") this.purposeOf(state, this.purpose);
      ctrl.append(this.chip(model), cases);
      this.head.append(ctrl);
      return;
    }
    if (this.local.countdown) {
      this.head.append(el("span", "❚❚ Paused", "pill"));
      this.caseLine(state, this.head);
      const seconds = Math.max(1, Math.ceil((this.local.countdown.until - Date.now()) / 1000));
      this.purpose.textContent = "Take your hands off the page: the run is about to drive it again.";
      this.foot.append(el("span", `Starting again in ${seconds}`, "now wait"));
      ctrl.append(button("Wait", "countdown-cancel"));
      this.foot.append(ctrl);
      return;
    }
    if (state.paused || state.phase === "waiting-next") {
      const stepping = !state.paused;
      this.head.append(el("span", stepping ? "Every step" : "❚❚ Paused", "pill"));
      this.caseLine(state, this.head);
      // What runs next is what a person stepping through reads every time.
      const next = this.stepWords(model, true);
      if (state.stepWhy) {
        this.purpose.classList.add("lead");
        this.purpose.append(el("span", next.kind, "kd"), document.createTextNode(next.text));
      }
      const before = state.plan[state.caseIndex - 1];
      const verdict = before ? (state.results[before.id] ?? before.verdict) : null;
      const why = stepping
        ? "The run waits before each step. Next step runs one."
        : state.pausedBy === "between-cases" && before
          ? `Case ${state.caseIndex} ${verdictWord(verdict).toLowerCase()}. Look around, then Resume.`
          : pauseWords(state.pausedBy ?? null);
      this.foot.append(el("span", why, "now"));
      if (stepping) ctrl.append(button("Next step", "next", "go"));
      else ctrl.append(button("▶ Resume", "resume", "go"), button("Next step", "next"));
      ctrl.append(this.chip(model), this.stopButton(), cases);
      this.foot.append(ctrl);
      return;
    }
    // The run drives.
    this.head.append(el("i", undefined, "dot"));
    this.caseLine(state, this.head);
    this.purposeOf(state, this.purpose);
    const now = el("span", undefined, "now");
    const item = state.plan[state.caseIndex];
    if (state.phase === "checking") {
      now.append(el("span", "Checking", "kd"), document.createTextNode(item?.checks ?? "the case's check"));
    } else if (state.stepWhy) {
      const words = this.stepWords(model);
      now.append(el("span", words.kind, "kd"), document.createTextNode(words.text));
    }
    this.foot.append(now);
    const ahead = forecastWords(forecast(state, model.msPerStep), state.caseIndex);
    const fc = el("span", undefined, "fc");
    fc.append(el("b", ahead.you, ahead.soon ? "soon" : ""), document.createTextNode(` · ${ahead.left}`));
    ctrl.append(fc, this.chip(model), button("❚❚ Pause", "pause", "", undefined, "Pause (Ctrl+Alt+Space)"));
    if (state.caseIndex >= 0) ctrl.append(button("⚑ Flag", "flag", this.local.flagOpen ? "hot" : ""));
    ctrl.append(cases);
    this.foot.append(ctrl);
  }

  private stopButton(): HTMLButtonElement {
    const armed = Date.now() < this.local.armedStop;
    return button(armed ? "Stop? Press again" : "Stop the run", "stop", armed ? "fail" : "");
  }

  private paintEnded(model: BarModel): void {
    this.head.replaceChildren();
    this.purpose.replaceChildren();
    this.foot.replaceChildren();
    const state = model.state;
    const failed = state.plan.filter((item) => state.results[item.id] === "fail").length;
    const passed = state.plan.filter((item) => state.results[item.id] === "pass").length;
    const stopped = state.phase === "stopped";
    this.head.append(
      el("span", stopped ? "Stopped" : failed ? `✗ ${failed} failed` : "✓ No failures", `pill ${stopped ? "grey" : failed ? "fail" : "pass"}`),
      el("span", `${passed} of ${state.plan.length} passed`, "ct"),
    );
    const ctrl = el("div", undefined, "ctrl");
    ctrl.append(button("Close", "close"));
    this.head.append(ctrl);
  }

  // The settings menu above the chip: when the run pauses, and its pace.
  private paintMenu(model: BarModel, live: boolean): void {
    const open = live && this.local.menuOpen;
    this.menu.hidden = !open;
    this.menu.replaceChildren();
    if (!open) return;
    this.menu.append(el("div", "When should the run pause?", "lbl"));
    for (const option of PAUSES) {
      const on = option.value === model.pause;
      const node = button("", "set-pause", `opt${on ? " on" : ""}`, { value: option.value });
      node.setAttribute("aria-pressed", String(on));
      node.append(el("span", on ? "◉" : "○", "rd"), el("span", option.label), el("small", option.hint));
      this.menu.append(node);
    }
    this.menu.append(el("div", "Pace", "lbl"));
    const paces = el("div", undefined, "paces");
    for (const pace of PACES) {
      const on = pace === model.state.speed;
      const pick = button(paceLabel(pace), "set-pace", `pick${on ? " on" : ""}`, { value: pace });
      pick.setAttribute("aria-pressed", String(on));
      paces.append(pick);
    }
    this.menu.append(paces, el("div", "Applies from the next step, and stays for later runs in this browser.", "meta"));
  }

  // What grows above the lines when the run needs the person, or Flag is open.
  private paintAsk(model: BarModel): void {
    const state = model.state;
    const pending = state.pending;
    const live = state.phase !== "done" && state.phase !== "stopped";
    const flag = live && !pending && this.local.flagOpen && state.caseIndex >= 0;
    const history = pending?.caseId ? model.history[pending.caseId]?.passed : null;
    const key = [
      pending ? this.pendingKey(state) : flag ? `flag:${state.caseId}` : "",
      history ? `${history.when}@${history.commit ?? ""}` : "",
      this.local.tucked,
      this.local.details,
      this.local.doingIt,
      this.local.countdown ? Math.ceil((this.local.countdown.until - Date.now()) / 1000) : "",
      this.local.copied,
      this.local.why?.action ?? "",
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
    if (this.local.why) {
      this.askWhy(this.local.why);
      return;
    }
    if (pending.kind === "verdict") this.askVerdict(pending.text, pending.proposal ?? null);
    else if (pending.kind === "steps") this.askByHand(item);
    else if (pending.kind === "approval") this.askApproval(pending.js, pending.why, state);
    else if (pending.kind === "failure") this.askFailure(model, item, pending.error);
    else if (pending.kind === "check-failed") this.askCheckFailed(model, item, pending.error);
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

  // One line before an answer goes; Back returns to the answers.
  private askWhy(why: Why): void {
    this.ask.append(el("div", why.label, "lbl"));
    const row = el("div", undefined, "acts");
    const field = this.noteInput(why.placeholder, why.action);
    const go = button(why.confirm, why.action, why.className);
    if (why.required) {
      go.disabled = true;
      field.addEventListener("input", () => {
        go.disabled = !field.value.trim();
      });
    }
    row.append(field, go, button("Back", "why-back"));
    this.ask.append(row);
    queueMicrotask(() => field.focus());
  }

  private askVerdict(text: string, proposal: { verdict: string; reason?: string } | null): void {
    if (this.local.tucked) {
      const row = el("div", undefined, "acts");
      row.append(button("✓ Yes, pass", "verdict-pass", "pass"), button("✗ No, fail", "verdict-fail", "fail"), button("Can't tell", "cant-tell"), button("Show the check ▴", "untuck", "link"));
      this.ask.append(row);
      return;
    }
    this.ask.append(el("div", plainText(text), "say"), el("div", "Is that what you see?", "hint"));
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
    this.ask.append(el("div", "Do this by hand", "lbl"), el("div", plainText(item?.intent ?? "Do what this case says."), "say"));
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

  // The three answers that end a case after a failure, the same for a step and a check.
  private endAnswers(): HTMLElement {
    const row = el("div", undefined, "acts");
    row.append(button("✓ It works", "it-works", "pass"), button("✗ It doesn't work", "it-fails", "fail"), button("Can't tell", "fail-cant-tell"));
    return row;
  }

  private askFailure(model: BarModel, item: PlanCase | undefined, error: string): void {
    const state = model.state;
    const why = plainText(state.stepWhy ?? "");
    if (this.doingIt) {
      this.ask.append(el("div", "Your turn: do this step yourself", "lbl"), el("div", why, "say"));
      const row = el("div", undefined, "acts");
      if (this.local.countdown) {
        const seconds = Math.max(1, Math.ceil((this.local.countdown.until - Date.now()) / 1000));
        this.ask.append(el("div", "Take your hands off the page: the run is about to drive it again.", "hint"));
        row.append(el("span", `Starting again in ${seconds}`, "wait"), button("Wait", "countdown-cancel"));
      } else {
        this.ask.append(el("div", "The screen is yours. Press Done when it's done. The run then goes on, and the case's check still decides.", "hint"));
        row.append(button("Done", "did-it", "go"), button("Back", "undo-it"));
      }
      this.ask.append(row);
      return;
    }
    const found = trouble(error);
    this.ask.append(el("div", `Step ${state.stepIndex + 1} of ${Math.max(1, state.stepCount)} · ${why}`, "lbl"), el("div", found.plain, "say"));
    const guide =
      found.kind === "kit-code"
        ? "That's a problem in the kit's own code, not the PR."
        : found.kind === "database"
          ? "Check that this machine is still connected (the proof database runs on it), then try again."
          : historyLine(item ? model.history[item.id] : null, "step");
    this.ask.append(el("div", guide, "guide"));
    const row = el("div", undefined, "acts");
    row.append(button("I'll do it", "do-it", "go"), button("↻ Try again", "retry"));
    row.append(el("span", "Do the step yourself and press Done. The case's check still decides.", "meta"));
    this.ask.append(row, el("div", "Or end the case now", "lbl"), this.endAnswers());
    this.ask.append(this.authorDetails(model, error, true));
  }

  private askCheckFailed(model: BarModel, item: PlanCase | undefined, error: string): void {
    const box = el("div", undefined, "kv");
    box.append(el("span", "Expected"), el("span", plainText(item?.checks ?? item?.judge ?? "The case's check to hold.")), el("span", "Found"), el("span", checkWords(error)));
    this.ask.append(box);
    this.ask.append(el("div", `${historyLine(item ? model.history[item.id] : null, "check")} The screen is yours: look, or use it, before you answer.`, "guide"));
    const row = this.endAnswers();
    row.append(button("↻ Try again", "retry"));
    this.ask.append(row);
    this.ask.append(this.authorDetails(model, error, false));
  }

  // The error, and the step's block to fix, for whoever fixes the kit.
  private authorDetails(model: BarModel, error: string, step: boolean): HTMLElement {
    const details = el("details") as HTMLDetailsElement;
    details.open = this.local.details;
    details.addEventListener("toggle", () => {
      this.local.details = details.open;
    });
    details.append(el("summary", "Details for the kit's author"));
    details.append(el("pre", error));
    const fix = el("div", undefined, "acts");
    if (step && model.stepUid) fix.append(button("Edit this step", "edit-step"), el("span", "Opens its block in the right sidebar; fix it, then Try again.", "meta"));
    if (step && !model.agent) fix.append(button("Ask your agent to fix it", "ask-agent", "link"));
    if (fix.childElementCount) details.append(fix);
    return details;
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
      row.append(el("span", icon, tone), el("span", String(index + 1), "ix"), el("span", plainText(item.title), "tt"), el("span", tag, "tg"));
      sheet.append(row);
      if (current) {
        const steps = el("div", undefined, "steps");
        const purpose = purposeLine(item, false);
        const line = el("div");
        if (purpose.label) line.append(el("b", `${purpose.label} `));
        line.append(document.createTextNode(purpose.text));
        steps.append(line);
        item.steps.forEach((step, at) => {
          const done = at < state.stepIndex;
          const now = at === state.stepIndex;
          steps.append(el("div", `${done ? "✓" : now ? "▶" : "○"} ${plainText(step.why)}`, done ? "d" : now ? "n" : ""));
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
    const skipped = count("skip");
    const stopped = state.phase === "stopped";
    const fixes = kitFixes(plan, results);
    const helped = plan.filter((item) => results[item.id] === "pass" && passedWithHelp(item.record)).length;
    const head = el("div", undefined, "res-hd");
    head.append(
      el("span", stopped ? "Stopped" : failed ? `✗ ${failed} failed` : "✓ No failures", `pill ${stopped ? "grey" : failed ? "fail" : "pass"}`),
      el("span", `${count("pass")} of ${plan.length} passed`, "big"),
      el("span", undefined, "grow"),
    );
    const facts = model.facts;
    const where = [facts.pr ? `PR #${facts.pr}` : null, facts.build ? `build ${facts.build}${facts.latest ? ", the PR's latest" : facts.latest === false ? ", behind the PR's head" : ""}` : null]
      .filter(Boolean)
      .join(" · ");
    if (where) head.append(el("span", where, "meta"));
    sheet.append(head);
    const sum = [
      skipped ? `${skipped} couldn't be tested.` : "",
      fixes.length ? `The kit needs ${fixes.length} fix${fixes.length === 1 ? "" : "es"}${helped ? `, and ${helped} case${helped === 1 ? "" : "s"} passed with your help` : ""}.` : helped ? `${helped} case${helped === 1 ? "" : "s"} passed with your help.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const { bullets, other } = doneWhen(plan);
    if (bullets.length) {
      const holding = bullets.filter((bullet) => bulletVerdict(bullet, results) === "pass").length;
      sheet.append(el("div", `Done When: ${holding} of ${bullets.length} bullet${bullets.length === 1 ? "" : "s"} pass${stopped ? " so far" : ""}.${sum ? ` ${sum}` : ""}`, "meta"));
      const sec = el("div", undefined, "sec");
      sec.append(el("div", `Done When${facts.ticket ? ` · ${facts.ticket}` : ""}`, "lbl"));
      for (const bullet of bullets) {
        const verdict = bulletVerdict(bullet, results);
        const row = el("div", undefined, "dw");
        const size = `${bullet.caseIds.length} case${bullet.caseIds.length === 1 ? "" : "s"}`;
        const yours = plan.filter((item) => bullet.caseIds.includes(item.id) && results[item.id] === "pass" && passedWithHelp(item.record)).length;
        row.append(
          el("span", verdict ? ICON[verdict] : "○", verdict ? ICON_CLASS[verdict] : "gr"),
          el("span", String(bullet.number), "meta"),
          el("span", plainText(bullet.text) || "(the kit doesn't say)"),
          el(
            "span",
            verdict === "fail" ? `${size}, failed` : verdict === "skip" ? `${size}, couldn't be tested` : verdict ? `${size}${yours ? ` · ${yours} passed by you` : ""}` : `${size}, didn't run`,
            `tg${verdict === "fail" ? " r" : ""}`,
          ),
        );
        sec.append(row);
      }
      sheet.append(sec);
    } else if (sum) {
      sheet.append(el("div", sum, "meta"));
    }
    const failures = plan.filter((item) => results[item.id] === "fail");
    if (failures.length) {
      const sec = el("div", undefined, "sec");
      sec.append(el("div", "Failed", "lbl"));
      for (const item of failures) {
        const index = plan.indexOf(item);
        const box = el("div", undefined, "fbox");
        box.append(el("div", `${ICON.fail} Case ${index + 1} · ${plainText(item.title)}`, "ft"));
        const kv = el("div", undefined, "kv");
        kv.append(
          el("span", "Expected"),
          el("span", plainText(item.checks ?? item.judge ?? "Every step runs.")),
          el("span", "Found"),
          el("span", `${item.note ?? "The check gave no message."}${item.record ? ` · ${howWords("fail", item.record)}` : ""}`),
        );
        box.append(kv, button(this.local.copied === `bug:${item.id}` ? "Copied" : "Copy bug report", "copy-bug", "", { caseId: item.id }));
        sec.append(box);
      }
      sheet.append(sec);
    }
    if (fixes.length) {
      const sec = el("div", undefined, "sec");
      sec.append(el("div", `The kit needs fixing · ${fixes.length}`, "lbl"));
      const box = el("div", undefined, "kbox");
      for (const fix of fixes) {
        const row = el("div", undefined, "krow");
        row.append(el("span", String(fix.index + 1), "ix"), el("span", plainText(fix.title), "tt"));
        for (const line of fix.lines) row.append(el("span", plainText(line), "wh"));
        box.append(row);
      }
      const acts = el("div", undefined, "acts");
      acts.style.marginTop = "8px";
      acts.append(
        button(this.local.copied === "kit" ? "Copied" : "Copy for the kit's author", "copy-kit", "am"),
        el("span", "Each case's step or check, what went wrong, and what you said, for whoever fixes the kit.", "meta"),
      );
      box.append(acts);
      sec.append(box);
      sheet.append(sec);
    }
    const sec = el("div", undefined, "sec");
    if (bullets.length && other.length) {
      const others = plan.filter((item) => other.includes(item.id));
      const ok = others.filter((item) => results[item.id] === "pass").length;
      sec.append(this.foldList(`Other cases: ${ok} of ${others.length} passed`, others.map((item) => `${ICON[results[item.id]] ?? "○"} ${plainText(item.title)} · ${howWords(results[item.id] ?? null, item.record ?? null)}`)));
    } else if (!bullets.length) {
      sec.append(this.foldList(`Every case: ${count("pass")} of ${plan.length} passed`, plan.map((item) => `${ICON[results[item.id]] ?? "○"} ${plainText(item.title)} · ${howWords(results[item.id] ?? null, item.record ?? null)}`)));
    }
    if (model.notTested) sec.append(el("div", `Not tested, and why: ${model.notTested} on the proof page.`, "meta"));
    const took = (model.endedAt ?? Date.now()) - model.startedAt;
    const retries = plan.reduce((sum, item) => sum + (item.record?.retries ?? 0), 0);
    const how = [
      runWords(model.pause, state.speed),
      model.scope === "failed" ? "re-ran the cases that didn't pass" : model.scope === "resume" ? "resumed" : "",
      duration(took).replace(/^about /, ""),
      retries ? `${retries} tr${retries === 1 ? "y" : "ies"} again` : "",
      facts.when,
    ]
      .filter(Boolean)
      .join(" · ");
    sec.append(el("div", `How this run went: ${how}`, "meta"));
    sheet.append(sec);
    const acts = el("div", undefined, "acts sec");
    acts.append(button(this.local.copied === "result" ? "Copied" : "Copy result for the PR", "copy-result", "go"), button("Run again", "run"));
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

  // A 3-second count before the run drives again, so it doesn't start
  // moving while a hand is still on the mouse.
  private countdown(cmd: string): void {
    if (this.local.countdown) return;
    const timer = window.setTimeout(() => {
      this.local.countdown = null;
      this.command(cmd);
    }, 3000);
    this.local.countdown = { until: Date.now() + 3000, timer, cmd };
  }

  private async press(target: HTMLButtonElement): Promise<void> {
    const action = target.dataset.action ?? "";
    const args = target.dataset.args ? (JSON.parse(target.dataset.args) as Record<string, unknown>) : {};
    const model = this.model;
    const state = model?.state;
    const note = this.note();
    const withNote = (extra: Record<string, unknown> = {}): Record<string, unknown> => (note ? { ...extra, note } : extra);
    const checkFailed = state?.pending?.kind === "check-failed";
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
      case "settings":
        this.local.menuOpen = !this.local.menuOpen;
        break;
      case "set-pause":
        this.local.menuOpen = false;
        this.send({ kind: "setting", key: "pause", value: args.value as PauseSetting });
        break;
      case "set-pace":
        this.local.menuOpen = false;
        this.send({ kind: "setting", key: "pace", value: Number(args.value) });
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
        else this.local.why = { label: "Why can't you tell?", placeholder: "One line: what's missing or unclear", confirm: "Skip: can't tell", className: "go", action: "why-cant-tell", required: true };
        break;
      case "why-cant-tell":
        if (!note) return this.showError("Say in one line why you can't tell.");
        this.command("skip-case", { note: `Can't tell: ${note}` });
        break;
      case "hand-skip":
        if (note) this.command("skip-case", { note });
        else this.local.why = { label: "Why skip this case?", placeholder: "One line: what stopped you", confirm: "Skip this case", className: "go", action: "why-hand-skip", required: true };
        break;
      case "why-hand-skip":
        if (!note) return this.showError("Say in one line why you're skipping it.");
        this.command("skip-case", { note });
        break;
      case "why-back":
        this.local.why = null;
        break;
      // The answers to a failure: does it work?
      case "it-works":
        this.local.why = { label: "What did you see work?", placeholder: "One line, for whoever fixes the kit", confirm: "✓ It works", className: "pass", action: "why-it-works", required: true };
        break;
      case "why-it-works":
        if (!note) return this.showError("Say in one line what you saw work.");
        this.command("verdict", { verdict: "pass", note });
        break;
      case "it-fails":
        this.local.why = { label: "What do you see instead? (optional)", placeholder: "One line for the bug report", confirm: "✗ It doesn't work", className: "fail", action: "why-it-fails", required: false };
        break;
      case "why-it-fails":
        if (checkFailed) this.command("continue", withNote());
        else this.command("verdict", withNote({ verdict: "fail" }));
        break;
      case "fail-cant-tell":
        this.local.why = { label: "Why can't you tell?", placeholder: "One line, for whoever fixes the kit", confirm: "Can't tell", className: "go", action: "why-fail-cant-tell", required: true };
        break;
      case "why-fail-cant-tell":
        if (!note) return this.showError("Say in one line why you can't tell.");
        this.command("skip-case", { note: `Can't tell: ${note}` });
        break;
      case "do-it":
        if (state) this.local.doingIt = this.pendingKey(state);
        this.send({ kind: "turn" });
        break;
      case "undo-it":
        this.local.doingIt = "";
        this.send({ kind: "turn" });
        break;
      case "did-it":
        this.countdown("done-step");
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
      case "resume":
        this.countdown("resume");
        break;
      case "countdown-cancel":
        if (this.local.countdown) clearTimeout(this.local.countdown.timer);
        this.local.countdown = null;
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
      case "copy-kit":
        if (model) await this.copy(kitReport(model.state, model.facts), "kit");
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
