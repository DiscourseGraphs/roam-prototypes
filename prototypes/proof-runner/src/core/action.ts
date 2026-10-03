// The actions a step can do, the same shapes recorder/recordDemo.ts runs
// over CDP. Kept here so the browser runner can use them without the
// Playwright recorder; tsc flags it where the two drift apart.

export type ClickAction = {
  click:
    | string
    | {
        selector: string;
        button?: "left" | "right" | "middle";
        count?: number;
        position?: { x: number; y: number };
      };
};
export type TypeAction = {
  type: { into: string; text: string; delay_ms?: number };
};
export type FillAction = { fill: { into: string; text: string } };
export type PressAction = {
  press: string | { selector?: string; key: string };
};
export type ScrollAction = { scroll: number | { y?: number; to?: string } };
/**
 * Glide the mouse onto an element without clicking. Pair with a follow-up
 * `press` for menus that swallow synthetic clicks (e.g. popovers rendered
 * inside the tldraw canvas eat pointer-up, so onClick never fires): the
 * burned cursor lands on the item, the hotkey does the actual selection.
 */
export type HoverAction = { hover: string };
export type PauseAction = { pause: number };
export type WaitForAction = { wait_for: string };
export type OpenAction = { open: string };
export type JsAction = { js: string };
export type ScreenshotAction = { screenshot: string };
export type CommandPaletteAction = {
  command_palette: string | { label: string; type_delay_ms?: number };
};
/**
 * Runs its actions only when the js expression is truthy in the page, so a
 * toggle-style setting can be turned on without flipping it back off on the
 * next run: { when: { js: "!overlayIsOn()", do: [{ command_palette: ... }] } }.
 */
export type WhenAction = { when: { js: string; do: Action[] } };
export type DragAction = {
  drag: {
    hover?: string;
    hoverAt?: "center" | "end";
    from: string;
    to: string;
    toPosition?: { x: number; y: number };
  };
};

export type Action =
  | ClickAction
  | TypeAction
  | FillAction
  | PressAction
  | HoverAction
  | ScrollAction
  | PauseAction
  | WaitForAction
  | OpenAction
  | JsAction
  | ScreenshotAction
  | CommandPaletteAction
  | DragAction
  | WhenAction;
