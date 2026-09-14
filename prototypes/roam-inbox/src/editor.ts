/* Talking to Roam's block editor: the open textarea, not the store.
 *
 * Two editor traps, both verified live, shape everything here:
 *
 * 1. While a block is being edited, the datascript store lags the textarea
 *    indefinitely. After a slash command strips the typed text, the textarea
 *    reads "" while `:block/string` still reads "/message", until the editor
 *    closes. So never wait for the store to agree with the textarea.
 *
 * 2. `updateBlock` under an open editor gets clobbered when that editor later
 *    flushes its own stale value. So writes go through the textarea whenever
 *    one is mounted: the native value setter plus a bubbling `input` event is
 *    exactly what typing does, so Roam persists it normally.
 */

/* Roam block textareas have ids ending in the 9-character block uid. */
export const findTextarea = (uid: string): HTMLTextAreaElement | null =>
  Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea.rm-block-input")).find(
    (ta) => ta.id?.endsWith(uid),
  ) || null;

// The prototype's setter, not `ta.value =`: a plain assignment goes through
// React's per-instance value tracker, so the `input` event that follows is
// seen as a non-change and Roam persists nothing.
const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;

export const typeInto = (ta: HTMLTextAreaElement, text: string, cursor: number): void => {
  setValue.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
};

const MIRRORED_STYLES = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom",
  "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
  "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle",
  "letterSpacing", "lineHeight", "textTransform", "wordSpacing",
  "textIndent", "whiteSpace", "wordWrap", "overflowWrap", "tabSize",
] as const;

/* Viewport coordinates just below the caret (the standard mirror-div
 * technique). Falls back to the textarea's bottom-left corner. */
export const caretCoords = (textarea: HTMLTextAreaElement): { top: number; left: number } => {
  const rect = textarea.getBoundingClientRect();
  try {
    const mirror = document.createElement("div");
    const style = window.getComputedStyle(textarea);
    for (const p of MIRRORED_STYLES) mirror.style[p] = style[p];
    Object.assign(mirror.style, {
      position: "absolute",
      visibility: "hidden",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      top: "0",
      left: "-9999px",
    });
    mirror.textContent = textarea.value.substring(0, textarea.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 20;
    const top = rect.top + marker.offsetTop - textarea.scrollTop + lineHeight;
    const left = rect.left + marker.offsetLeft - textarea.scrollLeft;
    mirror.remove();
    return { top: Math.min(top, rect.bottom + 4), left };
  } catch {
    return { top: rect.bottom + 4, left: rect.left };
  }
};
