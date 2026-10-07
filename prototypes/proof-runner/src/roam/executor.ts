import type { Action } from "../core/action";
import type { Executor, MachineState } from "../core/machine";
import { click, drag, fillText, hitTarget, moveTo, press, typeText, center } from "./input";
import { elementText, isVisible, query } from "./selector";

// The Executor for a run inside Roam: the same actions runAction does over
// CDP, done from the page. Waits follow Playwright's: wait_for waits for the
// first match to be visible; click and type also wait for it to be enabled,
// still, and the one a click at its center would reach.

export type PageExecutorOptions = {
  timeout: number;
  render: (state: MachineState) => void;
  // Runs a command palette entry by its label; false when no entry has it.
  palette: (label: string) => Promise<boolean>;
  // Fills {{run}}, {{kit}}, {{ns}} and {{env.X}} in every string of an action.
  fill: <T>(value: T) => T;
  // Something a person should know that isn't a failure, e.g. a skipped
  // screenshot.
  note: (text: string) => void;
  // The element a step is about to act on, and the verb, for the ring on the
  // page; null when the step acts on nothing a person could point at.
  target?: (element: Element | null, verb: string) => void;
  // How long the ring shows before the step acts, so a watcher sees the
  // cause before the effect.
  lead?: () => number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const POLL_MS = 100;
const SNAPSHOT_LIMIT = 4000;

const describeElement = (element: Element): string => {
  const classes = (element.getAttribute("class") ?? "").trim().split(/\s+/).slice(0, 3).join(".");
  return `<${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}>`;
};

// What a person would see, in plain text: the open page, then the dialogs,
// popovers and toasts on top of it.
export const snapshotPage = (): string => {
  const title = document.querySelector(".roam-article .rm-title-display");
  const layers = Array.from(document.querySelectorAll(".bp3-dialog, .bp3-popover, .bp3-toast, .rm-modal-dialog")).filter(isVisible);
  const lines = [
    `page: ${title ? (title.textContent ?? "").trim() : "(no page title)"}`,
    ...layers.map((layer) => `${describeElement(layer)} ${(layer.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600)}`),
  ];
  return lines.join("\n").slice(0, SNAPSHOT_LIMIT);
};

const CONTROLS = "button, [role=button], [role=tab], [role=menuitem], .bp3-menu-item, .bp3-tab, input, textarea, select, a[href]";
const CONTROLS_SHOWN = 80;

// The controls a step could act on, for an agent writing selectors: those
// in the topmost dialog or popover when one is open, else the page's.
export const controlsOnPage = (): string[] => {
  const layers = Array.from(document.querySelectorAll(".bp3-dialog, .bp3-popover, .rm-modal-dialog")).filter(isVisible);
  const scope = layers.at(-1) ?? document.querySelector(".roam-app") ?? document.body;
  return Array.from(scope.querySelectorAll(CONTROLS))
    .filter(isVisible)
    .slice(0, CONTROLS_SHOWN)
    .map((element) => {
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? (element as HTMLInputElement).placeholder ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      return `${describeElement(element)}${label ? ` "${label}"` : ""}`;
    });
};

// Indirect eval runs in global scope, the way page.evaluate runs a string,
// so kit js sees window.proof as proof. A promise is awaited.
export const evaluate = async (js: string): Promise<unknown> => {
  const indirect = eval;
  try {
    return await indirect(js);
  } catch (error) {
    // Keep the kind of error the kit's code hit (SyntaxError, TypeError…):
    // the run keeps only the message, and the bar tells kit code by it.
    if (error instanceof Error && error.name && error.name !== "Error" && !error.message.startsWith(`${error.name}:`)) {
      error.message = `${error.name}: ${error.message}`;
    }
    throw error;
  }
};

const waitUntil = async <T>(
  probe: () => T | null | undefined | false,
  timeout: number,
  what: () => string,
): Promise<T> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms exceeded waiting for ${what()}.`);
    await sleep(POLL_MS);
  }
};

const firstVisible = (selector: string, timeout: number): Promise<Element> =>
  waitUntil(
    () => {
      const element = query(selector);
      return element && isVisible(element) ? element : null;
    },
    timeout,
    () => {
      const element = query(selector);
      return element ? `${selector} to be visible (it is attached but hidden)` : `${selector}`;
    },
  );

const inViewport = (element: Element): boolean => {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
};

// Whether a scrolling parent cuts off the element's center: a row low in a
// long dialog is inside the window, but below the part of the dialog's
// scrolling box that shows, which ends above the runner's bar.
const cutOff = (element: Element): boolean => {
  const point = center(element);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const box = parent.getBoundingClientRect();
    if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) return true;
  }
  return false;
};

// Into view in the window and every scrolling parent before acting on it, as
// Playwright does.
const reveal = (element: Element): void => {
  if (!inViewport(element) || cutOff(element)) element.scrollIntoView({ block: "center", inline: "nearest" });
};

const isEnabled = (element: Element): boolean =>
  !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true";

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

// The element a click can land on: visible, enabled, not moving, and not
// covered by something else at its center.
const actionable = async (selector: string, timeout: number): Promise<Element> => {
  const deadline = Date.now() + timeout;
  let blocker = "";
  for (;;) {
    const left = Math.max(0, deadline - Date.now());
    const element = await firstVisible(selector, left);
    reveal(element);
    const before = element.getBoundingClientRect();
    await frame();
    const after = element.getBoundingClientRect();
    const still = before.x === after.x && before.y === after.y && before.width === after.width;
    if (still && isEnabled(element)) {
      const { covered } = hitTarget(element, center(element));
      if (!covered) return element;
      blocker = `${describeElement(covered)} intercepts pointer events`;
    } else {
      blocker = isEnabled(element) ? "the element is still moving" : "the element is disabled";
    }
    if (Date.now() > deadline) {
      throw new Error(`Timeout ${timeout}ms exceeded clicking ${selector}: ${blocker}.`);
    }
    await sleep(POLL_MS);
  }
};

// A Roam block shown as text turns into a textarea when clicked. If the
// click events didn't get it there, Roam's API does.
const ROAM_BLOCK_ID = /^block-input-(.+)-([\w-]{9})$/;

const enterRoamBlock = async (element: Element): Promise<void> => {
  if (!element.classList.contains("rm-block__input") || element instanceof HTMLTextAreaElement) return;
  const match = ROAM_BLOCK_ID.exec(element.id);
  if (!match) return;
  await sleep(150);
  if (document.activeElement instanceof HTMLTextAreaElement) return;
  const api = (window as unknown as { roamAlphaAPI?: RoamApi }).roamAlphaAPI;
  await api?.ui.setBlockFocusAndSelection({
    location: { "block-uid": match[2], "window-id": match[1] },
  });
  await waitUntil(() => document.activeElement instanceof HTMLTextAreaElement, 2000, () => "the block editor");
};

type RoamApi = {
  ui: {
    setBlockFocusAndSelection(args: {
      location: { "block-uid": string; "window-id": string };
    }): Promise<void> | void;
  };
};

const openPalette = async (label: string, timeout: number, delayMs: number): Promise<void> => {
  press(navigator.platform.startsWith("Mac") ? "Meta+p" : "Control+p", document.body);
  try {
    await pickFromPalette(label, timeout, delayMs);
  } catch (error) {
    // Leave no palette open: its backdrop would cover everything after.
    if (document.querySelector(".rm-command-palette__menu, .rm-modal-backdrop--command-palette")) press("Escape");
    throw error;
  }
};

const pickFromPalette = async (label: string, timeout: number, delayMs: number): Promise<void> => {
  const input = await firstVisible(".rm-command-palette input, .rm-command-palette__input input", timeout);
  (input as HTMLElement).focus();
  await typeText(label, delayMs);
  const wanted = label.replace(/\s+/g, " ").trim().toLowerCase();
  const row = await waitUntil(
    () =>
      Array.from(document.querySelectorAll(".rm-command-palette__menu .bp3-menu-item")).find(
        (item) => isVisible(item) && elementText(item).includes(wanted),
      ) ?? null,
    timeout,
    () =>
      `a command palette entry matching "${label}". If the command is feature-flagged, turn its flag on before the extension loads`,
  );
  click(row);
};

export const makePageExecutor = (options: PageExecutorOptions): Executor => {
  const { timeout } = options;

  // Puts the ring on what the step acts on, then gives the eye a moment.
  const show = async (element: Element | null, verb: string): Promise<void> => {
    options.target?.(element, verb);
    const ms = element ? (options.lead?.() ?? 0) : 0;
    if (ms > 0) await sleep(ms);
  };

  const run = async (raw: Action): Promise<void> => {
    const action = options.fill(raw);
    if (!("click" in action || "type" in action || "fill" in action || "hover" in action || "drag" in action || "when" in action)) {
      if (!("press" in action && typeof action.press !== "string" && action.press.selector)) options.target?.(null, "");
    }
    if ("click" in action) {
      const spec = typeof action.click === "string" ? { selector: action.click } : action.click;
      const element = await actionable(spec.selector, timeout);
      await show(element, spec.button === "right" ? "Right-click" : (spec.count ?? 1) > 1 ? "Double-click" : "Click");
      click(element, { button: spec.button, count: spec.count, position: spec.position });
      await enterRoamBlock(element);
    } else if ("type" in action) {
      const element = await actionable(action.type.into, timeout);
      await show(element, "Type");
      click(element);
      await enterRoamBlock(element);
      await typeText(action.type.text, action.type.delay_ms ?? 50);
    } else if ("fill" in action) {
      const element = await actionable(action.fill.into, timeout);
      await show(element, "Type");
      fillText(element, action.fill.text);
    } else if ("press" in action) {
      if (typeof action.press === "string") press(action.press);
      else if (action.press.selector) {
        const element = await actionable(action.press.selector, timeout);
        await show(element, `Press ${action.press.key}`);
        (element as HTMLElement).focus();
        press(action.press.key, element);
      } else press(action.press.key);
    } else if ("hover" in action) {
      const element = await firstVisible(action.hover, timeout);
      reveal(element);
      await show(element, "Hover");
      moveTo(element);
    } else if ("scroll" in action) {
      if (typeof action.scroll === "number") window.scrollBy(0, action.scroll);
      else if (action.scroll.to) {
        const element = await firstVisible(action.scroll.to, timeout);
        element.scrollIntoView({ block: "center", inline: "nearest" });
      } else window.scrollBy(0, action.scroll.y ?? 0);
    } else if ("pause" in action) {
      await sleep(action.pause * 1000);
    } else if ("wait_for" in action) {
      await firstVisible(action.wait_for, timeout);
    } else if ("open" in action) {
      const target = new URL(action.open, location.href);
      if (target.origin !== location.origin || target.pathname !== location.pathname || target.search !== location.search) {
        throw new Error(
          `open would reload the page (${target.href}); inside Roam a run can only follow hash routes like #/app/<graph>/page/<uid>.`,
        );
      }
      location.hash = target.hash;
      await sleep(500);
    } else if ("js" in action) {
      await evaluate(action.js);
    } else if ("screenshot" in action) {
      options.note(`Skipped screenshot ${action.screenshot}: screenshots are only taken in a recorded take.`);
    } else if ("drag" in action) {
      if (action.drag.hover) moveTo(await firstVisible(action.drag.hover, timeout));
      const from = await firstVisible(action.drag.from, timeout);
      await show(from, "Drag");
      const to = await firstVisible(action.drag.to, timeout);
      await drag(from, to, action.drag.toPosition);
    } else if ("command_palette" in action) {
      const value = action.command_palette;
      const label = typeof value === "string" ? value : value.label;
      const delay = typeof value === "string" ? 60 : (value.type_delay_ms ?? 60);
      if (!(await options.palette(label))) await openPalette(label, timeout, delay);
    } else if ("when" in action) {
      if (await evaluate(action.when.js)) {
        for (const inner of action.when.do) await run(inner);
      }
    } else {
      throw new Error(`Unknown action ${JSON.stringify(action)}.`);
    }
  };

  return {
    run,
    check: async (js) => {
      await evaluate(options.fill(js));
    },
    // What a person would see, for a failure report.
    snapshot: async () => snapshotPage(),
    render: async (state) => options.render(state),
  };
};
