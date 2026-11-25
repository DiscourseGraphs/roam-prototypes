/* Carried in the bundle rather than as a published extension.css: Roam only
 * injects that file on the URL-loading path, not when a roam/js block
 * `import()`s the bundle. Every class is prefixed `rmt-` so nothing here can
 * restyle the graph. The look matches the roam/render component it replaces. */
import { FALLBACK_CLASS, STYLE_ID } from "~/config";

const CSS = `
  .rmt-native-macro { display: none !important; }
  .rmt-macro-host { flex: 1; min-width: 0; }
  /* The shim's "waiting for the extension" note. Hidden whenever this
     stylesheet is present, which is exactly when the extension is loaded. */
  .${FALLBACK_CLASS} { display: none; }

  .rmt { display: flow-root; line-height: 1.45; padding: 6px 10px;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 3px;
    background: color-mix(in srgb, currentColor 3%, transparent); }
  .rmt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .rmt-refresh[data-feedback] .bp3-icon-refresh { animation: rmt-spin 0.8s linear infinite; }
  @keyframes rmt-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .rmt-refresh[data-feedback] .bp3-icon-refresh { animation: none; } }
  .rmt .rmt-refresh {
    float: right; display: grid; place-items: center; width: 24px; height: 24px;
    margin-left: 4px; padding: 0; border: 0; border-radius: 3px;
    background: transparent; color: inherit; cursor: pointer;
  }
  .rmt-refresh .bp3-icon::before { font-size: 12px; }
  @media (hover: hover) and (pointer: fine) {
    .rmt:not(:hover):not(:focus-within) .rmt-refresh:not([data-feedback]) { opacity: 0; }
  }
  @media (any-pointer: coarse) {
    .rmt:not(:hover):not(:focus-within) .rmt-refresh { opacity: 1; }
    .rmt .rmt-refresh { width: 44px; height: 44px; }
  }
  .rmt-muted { font-size: 12px; opacity: 0.5; }
  .rmt-count { font-size: 12px; opacity: 0.7; margin-bottom: 2px; }
  .rmt-heading {
    padding: 1px 0 5px; margin-bottom: 4px; border-bottom: 1px solid color-mix(in srgb, currentColor 13%, transparent);
  }
  .rmt-heading .bp3-icon::before, .rmt-info .bp3-icon::before { font-size: 12px; }
  .rmt-disclosure { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
  .rmt-toggle, .rmt-info button { background: transparent; color: inherit; font: inherit; border: 0; padding: 2px; cursor: pointer; }
  .rmt-info { position: relative; }
  .rmt-tip { position: absolute; bottom: 100%; right: 0; z-index: 5; width: max-content; max-width: min(180px,60vw);
    background: #30404d; color: white; border-radius: 3px; padding: 4px 7px; font-size: 12px; }
  .rmt > .rmt-info .rmt-tip { left: 0; right: auto; }
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
  .rmt .rmt-meeting { text-decoration: underline; text-underline-offset: 2px; }
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
