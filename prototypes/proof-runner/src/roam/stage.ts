// What the runner puts on the window around Roam during a run, beside the
// caption bar: a frame that says who has the screen, a ring on the element a
// step is about to act on, the person's input held while the run drives, the
// run's state in the tab title, and a chime when the run needs a person who
// isn't looking. None of it takes a pointer: the run's synthetic input and
// the person's clicks pass straight through.

// Who has the screen: the run, you, or you with a failure waiting on you.
export type Driver = "run" | "you" | "held" | "none";

// How a step's target is shown: a ring around it, or a drawn cursor that
// moves there and clicks.
export type Pointer = "ring" | "cursor";

const TOP = "2147483646";
const RUN_COLOR = "#6c58f0";
const YOU_COLOR = "#f0a020";
const HELD_COLOR = "#e5534b";

// The person's input the run holds while it drives. Pointer and key events
// both: a mousedown on its own would let the click after it through.
const HELD = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "keydown", "keypress", "keyup", "touchstart"];
// The mouse moving or resting over the page is held too, without pausing:
// an idle mouse would otherwise open Roam's link preview over the next target.
const HOVER = ["pointerover", "pointerout", "pointerenter", "pointerleave", "pointermove", "mouseover", "mouseout", "mouseenter", "mouseleave", "mousemove"];
// The run's cursor: violet, so it can't pass for the person's own pointer.
const CURSOR_ID = "proof-runner-cursor-style";
const CURSOR_CSS = `
.proof-runner-cursor { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: ${TOP}; pointer-events: none; transition-property: transform, opacity; transition-timing-function: cubic-bezier(.3, .7, .4, 1); }
.proof-runner-cursor svg { position: absolute; left: -2px; top: -1px; width: 22px; height: 22px; filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, .35)); }
.proof-runner-cursor .tag { position: absolute; left: 18px; top: 18px; background: ${RUN_COLOR}; color: #fff; font: 700 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 1px 7px; border-radius: 4px; white-space: nowrap; }
.proof-runner-cursor .pulse { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid ${RUN_COLOR}; opacity: 0; }
.proof-runner-cursor.click .pulse { animation: proof-runner-pulse .45s ease-out; }
@keyframes proof-runner-pulse { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .proof-runner-cursor { transition: none !important; } .proof-runner-cursor.click .pulse { animation: none; } }
`;
const ARROW = `<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M3 2 L3 18 L7.2 14 L10.2 20.5 L13 19.2 L10 12.8 L15.8 12.8 Z" fill="${RUN_COLOR}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

const SAY: Record<Exclude<Driver, "none">, string> = {
  run: "The run has the screen.",
  you: "The screen is yours.",
  held: "Something failed. The screen is yours until you answer.",
};
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);
const TITLE_MARK = /^(?:[▶●✓✗❚]{1,2} [^·]{0,40}· )+/;

export type StageHandlers = {
  // A person's click or key reached the page while the run drove: pause.
  held: () => void;
  // Ctrl+Alt+Space and Ctrl+Alt+. while a run is live.
  toggle: () => void;
  next: () => void;
  // Whether an event happened on the runner's own UI, which stays usable.
  ours: (event: Event) => boolean;
};

export class Stage {
  private frame: HTMLElement | null = null;
  private ringBox: HTMLElement | null = null;
  private ringTag: HTMLElement | null = null;
  private ringOn: Element | null = null;
  private ringFrame = 0;
  private holding = false;
  private live = false;
  private base: string | null = null;
  private audio: AudioContext | null = null;
  private driver: Driver = "none";
  private voice: HTMLElement | null = null;
  private pointer: Pointer = "ring";
  private cursor: HTMLElement | null = null;
  private cursorTag: HTMLElement | null = null;
  private cursorAt: { x: number; y: number } | null = null;
  private clickTimer = 0;
  // The person's clicks and keys on the page while it was theirs, since the
  // last reset: whether they used the page before pressing Try again.
  private touches = 0;

  constructor(private readonly handlers: StageHandlers) {}

  // The frame: violet while the run drives, amber when the screen is yours,
  // red while a failed check holds it.
  setDriver(driver: Driver): void {
    const changed = driver !== this.driver;
    this.driver = driver;
    if (driver === "none") {
      this.frame?.remove();
      this.frame = null;
      this.hideCursor();
      return;
    }
    if (changed) this.say(SAY[driver]);
    // The run's cursor fades while the screen isn't the run's.
    if (this.cursor) this.cursor.style.opacity = driver === "run" ? "1" : ".35";
    if (!this.frame) {
      const frame = document.createElement("div");
      frame.className = "proof-runner-frame";
      frame.setAttribute("data-proof-runner-ui", "");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = `position: fixed; inset: 0; z-index: ${TOP}; pointer-events: none; box-sizing: border-box; border: 3px solid ${RUN_COLOR};`;
      document.body.append(frame);
      this.frame = frame;
    }
    this.frame.style.borderColor = driver === "run" ? RUN_COLOR : driver === "held" ? HELD_COLOR : YOU_COLOR;
    this.frame.dataset.driver = driver;
  }

  setPointer(pointer: Pointer): void {
    if (pointer === this.pointer) return;
    this.pointer = pointer;
    if (pointer === "ring") this.hideCursor();
    else if (this.ringBox) this.ringBox.hidden = true;
  }

  // A ring on the element a step acts on, following it while it moves; or,
  // with the cursor, the run's cursor moving there within leadMs, then a
  // click's pulse.
  ring(element: Element | null, verb = "", leadMs = 0): void {
    this.ringOn = element;
    cancelAnimationFrame(this.ringFrame);
    if (this.pointer === "cursor") {
      if (this.ringBox) this.ringBox.hidden = true;
      this.moveCursor(element, verb, leadMs);
      return;
    }
    if (!element) {
      if (this.ringBox) this.ringBox.hidden = true;
      return;
    }
    if (!this.ringBox) {
      const box = document.createElement("div");
      box.className = "proof-runner-ring";
      box.setAttribute("data-proof-runner-ui", "");
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = `position: fixed; z-index: ${TOP}; pointer-events: none; box-sizing: border-box; border: 2px solid ${RUN_COLOR}; border-radius: 7px; box-shadow: 0 0 0 4px rgba(108, 88, 240, .2); transition: left .12s, top .12s, width .12s, height .12s;`;
      const tag = document.createElement("div");
      tag.style.cssText = `position: absolute; right: -2px; top: -22px; background: ${RUN_COLOR}; color: #fff; font: 700 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 1px 7px; border-radius: 4px; white-space: nowrap;`;
      box.append(tag);
      document.body.append(box);
      this.ringBox = box;
      this.ringTag = tag;
    }
    if (this.ringTag) {
      this.ringTag.textContent = verb;
      this.ringTag.hidden = !verb;
    }
    this.ringBox.hidden = false;
    const follow = (): void => {
      if (!this.ringBox || this.ringOn !== element) return;
      if (!element.isConnected) {
        this.ringBox.hidden = true;
        return;
      }
      const rect = element.getBoundingClientRect();
      const pad = 5;
      Object.assign(this.ringBox.style, {
        left: `${rect.left - pad}px`,
        top: `${rect.top - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      });
      // The tag goes under the ring when there's no room above it.
      if (this.ringTag) this.ringTag.style.top = rect.top < 30 ? `${rect.height + pad * 2 + 2}px` : "-22px";
      this.ringFrame = requestAnimationFrame(follow);
    };
    follow();
  }

  get ringed(): Element | null {
    return this.ringOn;
  }

  private moveCursor(element: Element | null, verb: string, leadMs: number): void {
    if (!element) {
      if (this.cursorTag) this.cursorTag.hidden = true;
      return;
    }
    if (!document.getElementById(CURSOR_ID)) {
      const style = document.createElement("style");
      style.id = CURSOR_ID;
      style.textContent = CURSOR_CSS;
      document.head.append(style);
    }
    if (!this.cursor) {
      const cursor = document.createElement("div");
      cursor.className = "proof-runner-cursor";
      cursor.setAttribute("data-proof-runner-ui", "");
      cursor.setAttribute("aria-hidden", "true");
      cursor.innerHTML = `<span class="pulse"></span>${ARROW}`;
      const tag = document.createElement("span");
      tag.className = "tag";
      cursor.append(tag);
      document.body.append(cursor);
      this.cursor = cursor;
      this.cursorTag = tag;
    }
    const cursor = this.cursor;
    const box = element.getBoundingClientRect();
    const to = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // The first time, it starts beside the target rather than flying in from a corner.
    const from = this.cursorAt ?? { x: to.x - 40, y: to.y + 30 };
    const glide = Math.max(0, Math.round(leadMs * 0.75));
    cursor.hidden = false;
    cursor.classList.remove("click");
    cursor.style.transitionDuration = "0ms";
    cursor.style.transform = `translate(${from.x}px, ${from.y}px)`;
    void cursor.getBoundingClientRect();
    cursor.style.transitionDuration = `${glide}ms`;
    cursor.style.transform = `translate(${to.x}px, ${to.y}px)`;
    this.cursorAt = to;
    if (this.cursorTag) {
      this.cursorTag.textContent = verb;
      this.cursorTag.hidden = !verb;
    }
    clearTimeout(this.clickTimer);
    if (/click|^Press/i.test(verb)) {
      this.clickTimer = window.setTimeout(() => {
        cursor.classList.add("click");
      }, glide);
    }
  }

  private hideCursor(): void {
    clearTimeout(this.clickTimer);
    this.cursor?.remove();
    this.cursor = null;
    this.cursorTag = null;
    this.cursorAt = null;
  }

  // Tells a screen reader whose turn it is now. New asks speak for
  // themselves in the bar.
  private say(text: string): void {
    if (!this.voice) {
      const voice = document.createElement("div");
      voice.className = "proof-runner-voice";
      voice.setAttribute("data-proof-runner-ui", "");
      voice.setAttribute("role", "status");
      voice.setAttribute("aria-live", "polite");
      voice.style.cssText = "position: fixed; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;";
      document.body.append(voice);
      this.voice = voice;
    }
    this.voice.textContent = text;
  }

  get touched(): boolean {
    return this.touches > 0;
  }

  resetTouched(): void {
    this.touches = 0;
  }

  // While the run drives, the person's clicks and keys don't reach Roam: the
  // first one pauses the run instead. The runner's own input is synthetic
  // (not trusted), so it passes.
  setHolding(on: boolean): void {
    this.holding = on;
  }

  // Listens while a run is live: the shortcuts, and the held input.
  setLive(on: boolean): void {
    if (on === this.live) return;
    this.live = on;
    for (const type of HELD) {
      if (on) document.addEventListener(type, this.onInput, true);
      else document.removeEventListener(type, this.onInput, true);
    }
    for (const type of HOVER) {
      if (on) document.addEventListener(type, this.onHover, true);
      else document.removeEventListener(type, this.onHover, true);
    }
    if (!on) this.holding = false;
  }

  private readonly onInput = (event: Event): void => {
    if (!event.isTrusted) return;
    if (event instanceof KeyboardEvent && event.ctrlKey && event.altKey && (event.code === "Space" || event.code === "Period")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "keydown" || event.repeat) return;
      if (event.code === "Space") this.handlers.toggle();
      else this.handlers.next();
      return;
    }
    if (this.handlers.ours(event)) return;
    if (event instanceof KeyboardEvent && MODIFIERS.has(event.key)) return;
    if (!this.holding) {
      if (event.type === "mousedown" || event.type === "keydown" || event.type === "touchstart") this.touches += 1;
      return;
    }
    event.stopImmediatePropagation();
    // A cancelled pointerdown would stop the browser sending mousedown, and
    // it's mousedown's default that moves focus: cancel that one instead.
    if (event.type !== "pointerdown" && event.type !== "pointerup") event.preventDefault();
    if (event.type === "mousedown" || event.type === "keydown" || event.type === "touchstart") this.handlers.held();
  };

  private readonly onHover = (event: Event): void => {
    if (!event.isTrusted || !this.holding || this.handlers.ours(event)) return;
    event.stopImmediatePropagation();
  };

  // The run's state ahead of the page's own title, so a tab in the
  // background still says whether the run needs you.
  setTitle(prefix: string | null): void {
    const current = document.title.replace(TITLE_MARK, "");
    if (prefix === null) {
      if (this.base !== null) document.title = current;
      this.base = null;
      return;
    }
    this.base = current;
    const next = `${prefix} · ${current}`;
    if (document.title !== next) document.title = next;
  }

  // Called from a click (Run), so the browser lets the chime play later.
  prime(): void {
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!this.audio && Context) this.audio = new Context();
      void this.audio?.resume();
    } catch {
      // No sound here; the title still says it.
    }
  }

  // Two soft notes, only when the tab or window isn't the one in front.
  chime(): void {
    if (!document.hidden && document.hasFocus()) return;
    const audio = this.audio;
    if (!audio) return;
    try {
      const start = audio.currentTime + 0.02;
      [660, 880].forEach((pitch, index) => {
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.type = "sine";
        tone.frequency.value = pitch;
        const at = start + index * 0.18;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        tone.connect(gain).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.32);
      });
    } catch {
      // A chime is a nicety.
    }
  }

  dispose(): void {
    this.setLive(false);
    this.setDriver("none");
    this.voice?.remove();
    this.voice = null;
    this.hideCursor();
    document.getElementById(CURSOR_ID)?.remove();
    this.ring(null);
    this.ringBox?.remove();
    this.ringBox = null;
    this.ringTag = null;
    this.setTitle(null);
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }
}
