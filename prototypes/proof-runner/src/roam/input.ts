// Mouse and keyboard input made from inside the page. Real input (what
// Playwright sends over CDP) is trusted and has default actions; these events
// aren't, so each helper does by hand what the browser would have done next:
// focus on mousedown, the value change on a key, the hover chain on a move.
//
// Blueprint v3 reads event.which (0 on a constructed KeyboardEvent), which is
// why kits found that Blueprint "ignores synthetic key events"; keyEvent sets
// keyCode and which so Escape closes a dialog here too.

export type Point = { x: number; y: number };

const FOCUSABLE =
  'input, textarea, select, button, a[href], [tabindex], [contenteditable=""], [contenteditable="true"]';

export const center = (element: Element): Point => {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

const pointAt = (element: Element, position?: Point): Point => {
  if (!position) return center(element);
  const box = element.getBoundingClientRect();
  return { x: box.left + position.x, y: box.top + position.y };
};

const BUTTONS = { left: 0, middle: 1, right: 2 } as const;
const BUTTON_MASK = { left: 1, middle: 4, right: 2 } as const;

type MouseButton = keyof typeof BUTTONS;

const mouseInit = (
  point: Point,
  button: MouseButton,
  extra: MouseEventInit = {},
): MouseEventInit => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  view: window,
  clientX: point.x,
  clientY: point.y,
  screenX: point.x,
  screenY: point.y,
  button: BUTTONS[button],
  ...extra,
});

const fire = (target: EventTarget, event: Event): boolean => target.dispatchEvent(event);

export const hitAt = (x: number, y: number): Element | null =>
  document.elementsFromPoint(x, y).find((element) => !element.closest("[data-proof-runner-ui]")) ?? null;

const pointer = (
  type: string,
  target: Element,
  point: Point,
  button: MouseButton,
  extra: MouseEventInit = {},
): void => {
  const init = { ...mouseInit(point, button, extra), pointerId: 1, pointerType: "mouse", isPrimary: true };
  const bubbles = !type.endsWith("enter") && !type.endsWith("leave");
  if (typeof PointerEvent === "function") {
    fire(target, new PointerEvent(type, { ...init, bubbles }));
  }
};

const mouse = (
  type: string,
  target: Element,
  point: Point,
  button: MouseButton,
  extra: MouseEventInit = {},
): boolean => {
  const bubbles = !type.endsWith("enter") && !type.endsWith("leave");
  return fire(target, new MouseEvent(type, { ...mouseInit(point, button, extra), bubbles }));
};

// The element a real click at this point would land on, if the target or
// something inside it; otherwise what covers it.
export const hitTarget = (element: Element, point: Point): { target: Element; covered: Element | null } => {
  const hit = hitAt(point.x, point.y);
  if (!hit || hit === element || element.contains(hit)) return { target: hit ?? element, covered: null };
  // A label or a portal-hosted part of the element still counts.
  if (hit.contains(element)) return { target: element, covered: null };
  return { target: element, covered: hit };
};

let hovered: Element | null = null;

export const moveTo = (element: Element, point: Point = center(element)): void => {
  const target = hitAt(point.x, point.y) ?? element;
  const into = element.contains(target) ? target : element;
  if (hovered && hovered !== into && hovered.isConnected) {
    pointer("pointerout", hovered, point, "left");
    pointer("pointerleave", hovered, point, "left");
    mouse("mouseout", hovered, point, "left", { relatedTarget: into });
    mouse("mouseleave", hovered, point, "left", { relatedTarget: into });
  }
  if (hovered !== into) {
    pointer("pointerover", into, point, "left");
    pointer("pointerenter", into, point, "left");
    mouse("mouseover", into, point, "left", { relatedTarget: hovered });
    mouse("mouseenter", into, point, "left", { relatedTarget: hovered });
  }
  pointer("pointermove", into, point, "left");
  mouse("mousemove", into, point, "left");
  hovered = into;
};

const focusFrom = (element: Element): void => {
  const focusable = element.closest(FOCUSABLE) as HTMLElement | null;
  if (focusable && document.activeElement !== focusable) focusable.focus({ preventScroll: true });
};

export const click = (
  element: Element,
  {
    button = "left",
    count = 1,
    position,
  }: { button?: MouseButton; count?: number; position?: Point } = {},
): void => {
  const point = pointAt(element, position);
  moveTo(element, point);
  const { target } = hitTarget(element, point);
  for (let detail = 1; detail <= count; detail += 1) {
    pointer("pointerdown", target, point, button, { buttons: BUTTON_MASK[button], detail });
    const proceed = mouse("mousedown", target, point, button, { buttons: BUTTON_MASK[button], detail });
    if (proceed) focusFrom(target);
    pointer("pointerup", target, point, button, { detail });
    mouse("mouseup", target, point, button, { detail });
    if (button === "right") {
      mouse("contextmenu", target, point, button, { detail });
    } else {
      // A click event runs the activation behavior even when synthetic, so
      // checkboxes toggle and labels forward to their input.
      mouse(button === "left" ? "click" : "auxclick", target, point, button, { detail });
      if (detail === 2 && button === "left") mouse("dblclick", target, point, button, { detail });
    }
  }
};

type KeySpec = { key: string; code: string; keyCode: number };

const NAMED_KEYS: Record<string, KeySpec> = {
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

const MODIFIERS: Record<string, keyof KeyboardEventInit> = {
  Control: "ctrlKey",
  Ctrl: "ctrlKey",
  Shift: "shiftKey",
  Alt: "altKey",
  Meta: "metaKey",
  Cmd: "metaKey",
  ControlOrMeta: navigator.platform.startsWith("Mac") ? "metaKey" : "ctrlKey",
};

const charSpec = (char: string): KeySpec => {
  if (/^[a-z]$/i.test(char)) {
    return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0) };
  }
  if (/^\d$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0) };
  if (char === " ") return NAMED_KEYS.Space;
  return { key: char, code: "", keyCode: 0 };
};

export const keyEvent = (
  type: "keydown" | "keypress" | "keyup",
  target: EventTarget,
  spec: KeySpec,
  modifiers: KeyboardEventInit = {},
): boolean => {
  const event = new KeyboardEvent(type, {
    key: spec.key,
    code: spec.code,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    ...modifiers,
  });
  const keyCode = type === "keypress" ? spec.key.charCodeAt(0) : spec.keyCode;
  Object.defineProperty(event, "keyCode", { get: () => keyCode });
  Object.defineProperty(event, "which", { get: () => keyCode });
  Object.defineProperty(event, "charCode", { get: () => (type === "keypress" ? keyCode : 0) });
  return fire(target, event);
};

const keyTarget = (): Element => document.activeElement ?? document.body;

const isTextField = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "file"].includes(element.type));

// Inserts text where the caret is, the way typing would: execCommand makes
// real beforeinput/input events and keeps undo; the setter is the fallback.
export const insertText = (element: Element, text: string): void => {
  if (document.execCommand("insertText", false, text)) return;
  if (isTextField(element)) {
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = element.value.slice(0, start) + text + element.value.slice(end);
    setter ? setter.call(element, next) : (element.value = next);
    element.setSelectionRange(start + text.length, start + text.length);
    fire(element, new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } else if ((element as HTMLElement).isContentEditable) {
    (element as HTMLElement).append(document.createTextNode(text));
    fire(element, new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
};

// "Control+p", "Escape", "Shift+Enter"
export const press = (combo: string, target: Element = keyTarget()): void => {
  const parts = combo.split("+");
  const name = parts.pop() || "+";
  const modifiers: KeyboardEventInit = {};
  for (const part of parts) {
    const flag = MODIFIERS[part];
    if (!flag) throw new Error(`press: unknown modifier "${part}" in "${combo}".`);
    (modifiers as Record<string, boolean>)[flag] = true;
  }
  const spec = NAMED_KEYS[name] ?? (name.length === 1 ? charSpec(name) : null);
  if (!spec) throw new Error(`press: unknown key "${name}".`);
  const proceed = keyEvent("keydown", target, spec, modifiers);
  const printable = spec.key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey;
  if (proceed && (printable || spec.key === "Enter")) {
    keyEvent("keypress", target, spec, modifiers);
    if (printable && isTextField(document.activeElement)) insertText(document.activeElement as Element, spec.key);
  }
  keyEvent("keyup", target, spec, modifiers);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Types into the focused field one character at a time, with key events
// around each insert, so handlers watching keys (a trigger like @) see them.
export const typeText = async (text: string, delayMs: number): Promise<void> => {
  for (const char of Array.from(text)) {
    const target = keyTarget();
    const spec = char === "\n" ? NAMED_KEYS.Enter : charSpec(char);
    const proceed = keyEvent("keydown", target, spec);
    if (proceed) {
      keyEvent("keypress", target, spec);
      if (char !== "\n") insertText(target, char);
    }
    keyEvent("keyup", target, spec);
    if (delayMs > 0) await sleep(delayMs);
  }
};

// Replaces a field's whole value, like Playwright's fill.
export const fillText = (element: Element, text: string): void => {
  (element as HTMLElement).focus({ preventScroll: true });
  if (isTextField(element)) {
    element.select();
  } else if ((element as HTMLElement).isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  if (text === "") {
    if (!document.execCommand("delete", false)) insertText(element, "");
    return;
  }
  insertText(element, text);
};

// A best-effort drag: pointer and mouse events along a short path, and the
// HTML drag-and-drop events with one DataTransfer carried through.
export const drag = async (from: Element, to: Element, toPosition?: Point): Promise<void> => {
  const start = center(from);
  const end = pointAt(to, toPosition);
  moveTo(from, start);
  pointer("pointerdown", from, start, "left", { buttons: 1 });
  mouse("mousedown", from, start, "left", { buttons: 1 });
  const data = typeof DataTransfer === "function" ? new DataTransfer() : null;
  const dragInit = (point: Point): DragEventInit => ({ ...mouseInit(point, "left", { buttons: 1 }), dataTransfer: data });
  fire(from, new DragEvent("dragstart", dragInit(start)));
  for (let index = 1; index <= 6; index += 1) {
    const point = {
      x: start.x + ((end.x - start.x) * index) / 6,
      y: start.y + ((end.y - start.y) * index) / 6,
    };
    const over = hitAt(point.x, point.y) ?? to;
    pointer("pointermove", over, point, "left", { buttons: 1 });
    mouse("mousemove", over, point, "left", { buttons: 1 });
    fire(over, new DragEvent(index === 1 ? "dragenter" : "dragover", dragInit(point)));
    await sleep(30);
  }
  const target = hitAt(end.x, end.y) ?? to;
  fire(target, new DragEvent("dragover", dragInit(end)));
  fire(target, new DragEvent("drop", dragInit(end)));
  pointer("pointerup", target, end, "left");
  mouse("mouseup", target, end, "left");
  fire(from, new DragEvent("dragend", dragInit(end)));
};
