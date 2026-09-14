/* A hand-rolled tooltip. The native `title` attribute waits about a second
 * and cannot be styled; Blueprint's tooltip is a React component with no
 * imperative entry point. Roam's own topbar tooltips appear immediately, so
 * this matches that: a small card with a caret, after a short delay, themed
 * for light and dark. */
import { TIP_DELAY_MS } from "~/config";

let tipEl: HTMLDivElement | null = null;
let tipTimer: number | null = null;

export const hideTip = (): void => {
  if (tipTimer !== null) {
    clearTimeout(tipTimer);
    tipTimer = null;
  }
  tipEl?.remove();
  tipEl = null;
};

const showTip = (anchor: HTMLElement, text: string): void => {
  hideTip();
  if (!text || !document.body.contains(anchor)) return;
  tipEl = document.createElement("div");
  tipEl.className = "rmi-tip";
  const caret = document.createElement("div");
  caret.className = "rmi-tip-caret";
  const body = document.createElement("div");
  body.className = "rmi-tip-body";
  body.textContent = text;
  tipEl.append(caret, body);
  document.body.appendChild(tipEl);

  const a = anchor.getBoundingClientRect();
  // Measure the CARD, not the wrapper: the absolutely-positioned caret
  // inflates the wrapper's bounding box and skews the centring by ~7px.
  const w = body.getBoundingClientRect().width;
  const anchorCenter = a.left + a.width / 2;
  const left = Math.max(6, Math.min(anchorCenter - w / 2, window.innerWidth - w - 6));
  tipEl.style.top = `${a.bottom + 9}px`;
  tipEl.style.left = `${left}px`;
  // Point the caret at the anchor even when the card was clamped on-screen,
  // but keep it inside the card's rounded corners.
  caret.style.left = `${Math.max(7, Math.min(anchorCenter - left - 4.5, w - 16))}px`;
};

export const attachTooltip = (el: HTMLElement, getText: () => string): void => {
  el.addEventListener("mouseenter", () => {
    if (tipTimer !== null) clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => showTip(el, getText()), TIP_DELAY_MS);
  });
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("mousedown", hideTip);
};
