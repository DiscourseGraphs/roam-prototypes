/* Hover detection and the floating "Figure" chip.
 *
 * Pure event delegation — two document-level listeners and one singleton
 * chip element that is repositioned to whichever eligible reference is under
 * the pointer. No MutationObserver, no per-reference DOM, no layout shift:
 * the page at rest is byte-identical to Roam without the extension, which is
 * the presentation constraint this prototype exists to honor.
 */
import type { KeyFigure } from "~/keyFigure";

export const REF_SELECTOR = "span.rm-page-ref";
export const CHIP_CLASS = "hkf-chip";

const HIDE_GRACE_MS = 300;

/* The page title a reference points at. Tags carry it on the span itself
 * (`data-tag`); bracket refs carry it on an ancestor (`data-link-title`). */
export const getRefTitle = (el: Element): string =>
  el.getAttribute("data-tag") ||
  el.closest("[data-link-title]")?.getAttribute("data-link-title") ||
  "";

export type HoverOptions = {
  isEligibleTitle: (title: string) => boolean;
  hoverDelayMs: () => number;
  /* Kicked on hover so the figure is usually resolved before the click. */
  prefetch: (title: string) => Promise<KeyFigure | null>;
  /* The chip was clicked for this reference. */
  onOpen: (ctx: { title: string; anchor: DOMRect }) => void;
};

export type HoverController = { destroy: () => void; chip: HTMLButtonElement };

export const initHover = (opts: HoverOptions): HoverController => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = CHIP_CLASS;
  chip.textContent = "🖼 Figure";
  document.body.appendChild(chip);

  let currentTitle = "";
  let currentRef: Element | null = null;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  /* The pointer's live position. The chip appears just BELOW the cursor, not
   * at the reference's right edge: discourse-node titles are long, so the
   * right edge can be a whole line-width of mouse travel away (Matt's first
   * live-test feedback). mouseover alone is not enough — it fires only on
   * element boundaries, so inside a long reference its coordinates go stale. */
  let mouseX = 0;
  let mouseY = 0;
  const onMouseMove = (e: MouseEvent) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  };

  const clearTimers = () => {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    showTimer = hideTimer = undefined;
  };

  const hideChip = () => {
    clearTimers();
    chip.classList.remove(`${CHIP_CLASS}--visible`, `${CHIP_CLASS}--empty`);
    chip.removeAttribute("title");
    currentTitle = "";
    currentRef = null;
  };

  const showChipFor = (ref: Element, title: string) => {
    // Centered under the pointer, a few pixels down: the click is a short
    // downward flick instead of a trek to the end of the title. Clamped so
    // it never leaves the viewport near an edge.
    const x = Math.min(Math.max(mouseX, 40), window.innerWidth - 40);
    const y = Math.min(mouseY + 14, window.innerHeight - 30);
    chip.style.left = `${Math.round(x)}px`;
    chip.style.top = `${Math.round(y)}px`;
    chip.classList.add(`${CHIP_CLASS}--visible`);
    chip.classList.remove(`${CHIP_CLASS}--empty`);
    chip.removeAttribute("title");
    currentTitle = title;
    currentRef = ref;
    // Prefetch; if this page has no figure, say so on the chip itself —
    // the presenter learns instantly instead of after a dead click.
    opts
      .prefetch(title)
      .then((figure) => {
        if (currentTitle !== title) return;
        if (!figure) {
          chip.classList.add(`${CHIP_CLASS}--empty`);
          chip.setAttribute("title", "No figure found on this page");
        }
      })
      .catch(() => undefined);
  };

  const scheduleHide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideChip, HIDE_GRACE_MS);
  };

  const onMouseOver = (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (chip.contains(target)) {
      window.clearTimeout(hideTimer);
      return;
    }
    const ref = target.closest(REF_SELECTOR);
    if (ref) {
      const title = getRefTitle(ref);
      if (title && opts.isEligibleTitle(title)) {
        window.clearTimeout(hideTimer);
        if (ref === currentRef) return;
        window.clearTimeout(showTimer);
        showTimer = window.setTimeout(
          () => showChipFor(ref, title),
          opts.hoverDelayMs(),
        );
        return;
      }
    }
    // Pointer is on something else entirely.
    window.clearTimeout(showTimer);
    if (currentRef) scheduleHide();
  };

  const onChipClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentTitle) return;
    // The card anchors to the chip, i.e. to where the pointer already is —
    // not to the reference, which may be far away for long titles.
    opts.onOpen({ title: currentTitle, anchor: chip.getBoundingClientRect() });
  };

  /* Any scroll invalidates the chip's fixed-position anchor; hiding beats
   * chasing. Capture phase catches Roam's nested scroll containers. */
  const onScroll = () => {
    if (chip.classList.contains(`${CHIP_CLASS}--visible`)) hideChip();
  };

  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("mousemove", onMouseMove, { passive: true });
  chip.addEventListener("click", onChipClick);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });

  return {
    chip,
    destroy: () => {
      clearTimers();
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("scroll", onScroll, { capture: true });
      chip.remove();
    },
  };
};
