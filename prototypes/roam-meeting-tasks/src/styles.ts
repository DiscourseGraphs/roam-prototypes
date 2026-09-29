/* Carried in the bundle rather than as a published extension.css: Roam only
 * injects that file on the URL-loading path, not when a roam/js block
 * `import()`s the bundle. Every class is prefixed `rmt-` so nothing here can
 * restyle the graph. The look matches the roam/render component it replaces. */
import { FALLBACK_CLASS, STYLE_ID } from "~/config";

export const CSS = `
  /* The shim's "waiting for the extension" note. Hidden whenever this
     stylesheet is present, which is exactly when the extension is loaded. */
  .${FALLBACK_CLASS} { display: none; }

  .rmt { font-size: 13px; line-height: 1.45; }
  .rmt-muted { font-size: 12px; opacity: 0.5; }
  .rmt-count { font-size: 12px; opacity: 0.7; margin-bottom: 2px; }
  .rmt-heading {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
    opacity: 0.6; margin: 8px 0 2px;
  }
  .rmt-toggle { cursor: pointer; user-select: none; }
  .rmt-row { display: flex; align-items: flex-start; gap: 6px; padding: 1px 0; }
  .rmt-row[data-done="true"] { opacity: 0.55; }
  .rmt .rmt-row[data-done="true"] .rmt-text { text-decoration: line-through; }
  .rmt-check { margin-top: 3px; cursor: pointer; flex: 0 0 auto; }
  .rmt-date {
    flex: 0 0 auto; font-size: 11px; opacity: 0.6; min-width: 42px; padding-top: 2px;
  }
  .rmt-date[data-inbox="true"] { opacity: 0.45; }
  /* Two classes deep so Roam's and Blueprint's own link colors lose. */
  .rmt .rmt-text { flex: 1 1 auto; color: inherit; text-decoration: none; }
  .rmt-footer { font-size: 11px; opacity: 0.5; margin-top: 6px; }
  .rmt-debug { font-size: 11px; opacity: 0.6; margin-top: 6px; }
`;

export const addStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
};

export const removeStyles = (): void => document.getElementById(STYLE_ID)?.remove();
