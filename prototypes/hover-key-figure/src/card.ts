/* The figure card and the lightbox. Singletons: one card, one lightbox.
 *
 * The card is click-opened and PINNED — it never follows or flees the
 * pointer. Presenters need a popup that stays exactly where it opened while
 * they talk over it. Dismissal is explicit: Esc, click outside, or the chip.
 *
 * Esc unwinds one layer at a time: lightbox → card → nothing.
 */
import type { KeyFigure } from "~/keyFigure";
import { CHIP_CLASS } from "~/hover";

let card: HTMLDivElement | null = null;
let lightbox: HTMLDivElement | null = null;
let openTitle = "";

export const getOpenCardTitle = (): string => (card ? openTitle : "");

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  if (lightbox) {
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
    return;
  }
  if (card) {
    e.preventDefault();
    e.stopPropagation();
    closeCard();
  }
};

const onOutsideMouseDown = (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (lightbox) return; // the lightbox owns its own click-to-close
  if (card && !card.contains(target) && !target.closest(`.${CHIP_CLASS}`)) {
    closeCard();
  }
};

const listen = () => {
  // Capture, so Esc wins over Roam's own handlers while the card is open.
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onOutsideMouseDown, true);
};

const unlisten = () => {
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("mousedown", onOutsideMouseDown, true);
};

export const closeLightbox = (): void => {
  lightbox?.remove();
  lightbox = null;
};

export const closeCard = (): void => {
  closeLightbox();
  card?.remove();
  card = null;
  openTitle = "";
  unlisten();
};

export const closeAll = closeCard;

export const openLightbox = (url: string): void => {
  closeLightbox();
  lightbox = document.createElement("div");
  lightbox.className = "hkf-lightbox";
  const img = document.createElement("img");
  img.className = "hkf-lightbox__img";
  img.src = url;
  img.alt = openTitle;
  lightbox.appendChild(img);
  lightbox.addEventListener("mousedown", (e) => e.stopPropagation());
  lightbox.addEventListener("click", closeLightbox);
  document.body.appendChild(lightbox);
};

const positionCard = (el: HTMLDivElement, anchor: DOMRect) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  el.style.left = `${Math.round(
    Math.min(Math.max(anchor.left, margin), Math.max(margin, vw - 496)),
  )}px`;
  // Below the anchor when there is room, above it otherwise. The card's own
  // max-height (52vh) is the size budget for the decision.
  if (anchor.bottom + vh * 0.52 + margin < vh || anchor.top < vh * 0.5) {
    el.style.top = `${Math.round(anchor.bottom + margin)}px`;
    el.style.bottom = "";
  } else {
    el.style.bottom = `${Math.round(vh - anchor.top + margin)}px`;
    el.style.top = "";
  }
};

export type OpenCardOptions = {
  title: string;
  anchor: DOMRect;
  load: () => Promise<KeyFigure | null>;
};

export const openCard = (opts: OpenCardOptions): void => {
  // Clicking the chip while this reference's card is open toggles it closed.
  if (card && openTitle === opts.title) {
    closeCard();
    return;
  }
  closeCard();

  card = document.createElement("div");
  card.className = "hkf-card";
  const body = document.createElement("div");
  body.className = "hkf-card__body";
  const spinner = document.createElement("div");
  spinner.className = "hkf-card__spinner";
  body.appendChild(spinner);
  const caption = document.createElement("div");
  caption.className = "hkf-card__caption";
  caption.textContent = opts.title;
  caption.title = opts.title;
  card.appendChild(body);
  card.appendChild(caption);
  positionCard(card, opts.anchor);
  document.body.appendChild(card);
  openTitle = opts.title;
  listen();

  const showMessage = (text: string) => {
    body.textContent = "";
    const msg = document.createElement("div");
    msg.className = "hkf-card__message";
    msg.textContent = text;
    body.appendChild(msg);
  };

  const requested = opts.title;
  opts
    .load()
    .then((figure) => {
      if (!card || openTitle !== requested) return;
      if (!figure) {
        showMessage("No figure found on this page.");
        return;
      }
      body.textContent = "";
      const img = document.createElement("img");
      img.className = "hkf-card__img";
      img.src = figure.url;
      img.alt = requested;
      img.title = "Click to expand";
      img.addEventListener("click", () => openLightbox(figure.url));
      img.addEventListener("error", () =>
        showMessage("The figure image failed to load."),
      );
      body.appendChild(img);
    })
    .catch((error) => {
      console.error("hover-key-figure: failed to resolve figure:", error);
      if (card && openTitle === requested)
        showMessage("Could not read this page's figure.");
    });
};
