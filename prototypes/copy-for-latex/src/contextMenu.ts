/* The right-click decision: is this a discourse node, and if so which one. */
import { findNodeTypeForTitle } from "~/graph";
import { MARK_ATTR, TITLE_SELECTOR, titleForTarget } from "~/dom";
import { closeMenu, openMenu, shouldCloseOnPointer } from "~/menu";

export const handleContextMenu = (e: MouseEvent): void => {
  closeMenu();
  const target = e.target as Element | null;
  const el = target?.closest?.(`[${MARK_ATTR}], ${TITLE_SELECTOR}`);
  if (!el) return;
  const isTitle = !!el.matches?.(TITLE_SELECTOR);
  const title = titleForTarget(el);
  /* Ask again rather than trusting the mark. A heading's parked answer can be
   * a page behind, and Roam reuses the element across navigations, so whether
   * this is a discourse node has to be settled for the title actually in
   * hand. When it is not one, fall through to the native menu instead of
   * swallowing the click. */
  if (!title || !findNodeTypeForTitle(title)) return;
  e.preventDefault();
  e.stopPropagation();
  openMenu(title, e.clientX, e.clientY, {
    /* On a page's own heading in the main window, "Jump to page" would
     * navigate to where the user already is. In the right sidebar it still
     * goes somewhere, so only the main window drops it. */
    omitJumpToPage: isTitle && !!el.closest?.(".roam-article"),
  });
};

export const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key === "Escape") closeMenu();
};

/* Capture phase, and mousedown as well as click.
 *
 * Reported from real use: with the menu open, clicking into another block
 * left it hanging over the outline. Capture fires before any handler further
 * down can stop propagation, and mousedown fires before click, so this closes
 * in a strict superset of the cases a bubble-phase click listener would. */
export const handlePointer = (e: MouseEvent): void => {
  if (shouldCloseOnPointer(e.target as Node | null)) closeMenu();
};
