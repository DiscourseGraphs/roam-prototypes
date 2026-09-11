/* Carried in the bundle rather than as a published extension.css: Roam only
 * injects that file on the URL-loading path, not when a roam/js block
 * `import()`s the bundle for testing. Every class is prefixed `rmi-` so
 * nothing here can restyle the graph. */
import { STYLE_ID } from "~/config";

export const CSS = `
  /* ---- picker (shared shape with roam-task-assign) ---- */
  .rmi-menu {
    position: fixed; z-index: 10000;
    min-width: 220px; max-width: 320px; max-height: 280px; overflow-y: auto;
    background: #fff; border-radius: 4px; padding: 4px 0; font-size: 14px;
    box-shadow: 0 0 0 1px rgba(16,22,26,.1), 0 2px 4px rgba(16,22,26,.2),
                0 8px 24px rgba(16,22,26,.2);
  }
  .rmi-item {
    padding: 5px 12px; cursor: pointer; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; color: #182026;
  }
  .rmi-item.rmi-active { background: #137cbd; color: #fff; }
  .rmi-empty { padding: 8px 12px; color: #5c7080; font-style: italic; }
  .rmi-hint {
    padding: 4px 12px; color: #5c7080; font-size: 11px;
    border-top: 1px solid rgba(16,22,26,.1); margin-top: 4px;
  }

  /* ---- topbar badge ---- */
  .rmi-btn { margin-left: 2px; }
  /* The badge is anchored to the 16px GLYPH, not to the button box. The
     button's width is not stable (24px empty, 37px with a bubble, and a
     graph's own roam/css can pad it further), so anchoring to the button
     floats the badge out toward the next icon. .rmi-glyph is a fixed 16px
     square we control, so the corner is the corner at any button size. */
  .rmi-glyph {
    position: relative; display: inline-flex;
    width: 16px; height: 16px; line-height: 16px;
  }
  .rmi-count {
    position: absolute; top: -5px; right: -6px;
    min-width: 15px; height: 15px; padding: 0 3px;
    border-radius: 8px; background: #137cbd; color: #fff;
    font-size: 10px; font-weight: 700; line-height: 15px;
    text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: none;
  }
  /* Nothing new, but the inbox is not empty: say "there is something here"
     without a permanent number, which would stop reading as a signal. */
  .rmi-count.rmi-dot {
    min-width: 0; width: 7px; height: 7px; padding: 0;
    top: -2px; right: -3px; background: #a7b6c2;
  }

  /* ---- tooltip ---- */
  .rmi-tip { position: fixed; z-index: 10002; pointer-events: none; }
  .rmi-tip-body {
    background: #fff; color: #182026;
    font-size: 12px; line-height: 1.4; font-weight: 400;
    padding: 6px 10px; border-radius: 4px; white-space: nowrap;
    box-shadow: 0 0 0 1px rgba(16,22,26,.1), 0 2px 4px rgba(16,22,26,.2),
                0 8px 24px rgba(16,22,26,.2);
  }
  .rmi-tip-caret {
    position: absolute; top: -4px; width: 9px; height: 9px;
    background: #fff; transform: rotate(45deg);
    box-shadow: -1px -1px 0 0 rgba(16,22,26,.1);
  }

  /* ---- panel ---- */
  .rmi-panel {
    position: fixed; z-index: 10000;
    width: 500px; max-width: calc(100vw - 24px); max-height: 72vh;
    display: flex; flex-direction: column;
    background: #fff; border-radius: 6px; overflow: hidden;
    font-size: 13px; color: #182026;
    box-shadow: 0 0 0 1px rgba(16,22,26,.1), 0 2px 4px rgba(16,22,26,.2),
                0 8px 24px rgba(16,22,26,.2);
  }
  .rmi-tabs {
    display: flex; gap: 4px; padding: 8px 10px 0; flex: 0 0 auto;
    border-bottom: 1px solid rgba(16,22,26,.1);
  }
  .rmi-tab {
    padding: 6px 11px 7px; cursor: pointer; border-radius: 3px 3px 0 0;
    color: #5c7080; font-weight: 600; white-space: nowrap;
  }
  .rmi-tab:hover { background: rgba(167,182,194,.2); }
  .rmi-tab.rmi-tab-on { color: #137cbd; box-shadow: inset 0 -2px 0 #137cbd; }
  .rmi-list { overflow-y: auto; flex: 1 1 auto; padding: 2px 0 6px; }
  .rmi-row {
    padding: 12px 14px 13px 15px; border-left: 3px solid transparent;
  }
  .rmi-row + .rmi-row { border-top: 1px solid rgba(16,22,26,.08); }
  .rmi-row:hover { background: rgba(167,182,194,.15); }
  .rmi-row.rmi-new { border-left-color: #137cbd; background: rgba(19,124,189,.05); }
  .rmi-meta { font-size: 11px; color: #5c7080; margin-bottom: 4px; }
  .rmi-who { font-weight: 700; color: #394b59; }
  .rmi-text { cursor: pointer; line-height: 1.45; }
  .rmi-text:hover { text-decoration: underline; }
  .rmi-ctx {
    font-size: 11px; color: #8a9ba8; margin-top: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rmi-acts { margin-top: 9px; display: flex; gap: 6px; }
  .rmi-act {
    font-size: 11px; padding: 3px 9px; border-radius: 3px; cursor: pointer;
    color: #5c7080; background: rgba(167,182,194,.25); font-weight: 600;
  }
  .rmi-act:hover { background: rgba(167,182,194,.5); color: #182026; }
  .rmi-foot {
    padding: 7px 14px; font-size: 11px; color: #5c7080; flex: 0 0 auto;
    border-top: 1px solid rgba(16,22,26,.1);
  }

  /* ---- toast ---- */
  .rmi-toasts {
    position: fixed; z-index: 10001; top: 52px; right: 14px;
    display: flex; flex-direction: column; gap: 8px; pointer-events: none;
  }
  .rmi-toast {
    pointer-events: auto; cursor: pointer;
    width: 320px; padding: 9px 12px; border-radius: 5px;
    background: #202b33; color: #f5f8fa; font-size: 12.5px; line-height: 1.35;
    box-shadow: 0 2px 4px rgba(16,22,26,.2), 0 8px 24px rgba(16,22,26,.2);
  }
  .rmi-toast-who { font-weight: 700; color: #48aff0; margin-bottom: 2px; }
  .rmi-toast-body {
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ---- dark theme ---- */
  .bp3-dark .rmi-menu, .rm-dark-theme .rmi-menu,
  .bp3-dark .rmi-panel, .rm-dark-theme .rmi-panel {
    background: #30404d; color: #f5f8fa;
    box-shadow: 0 0 0 1px rgba(16,22,26,.2), 0 2px 4px rgba(16,22,26,.4),
                0 8px 24px rgba(16,22,26,.4);
  }
  .bp3-dark .rmi-item, .rm-dark-theme .rmi-item { color: #f5f8fa; }
  .bp3-dark .rmi-item.rmi-active, .rm-dark-theme .rmi-item.rmi-active {
    background: #137cbd; color: #fff;
  }
  .bp3-dark .rmi-who, .rm-dark-theme .rmi-who { color: #ced9e0; }
  .bp3-dark .rmi-meta, .rm-dark-theme .rmi-meta,
  .bp3-dark .rmi-tab, .rm-dark-theme .rmi-tab,
  .bp3-dark .rmi-foot, .rm-dark-theme .rmi-foot,
  .bp3-dark .rmi-act, .rm-dark-theme .rmi-act { color: #a7b6c2; }
  .bp3-dark .rmi-tab.rmi-tab-on, .rm-dark-theme .rmi-tab.rmi-tab-on {
    color: #48aff0; box-shadow: inset 0 -2px 0 #48aff0;
  }
  .bp3-dark .rmi-act:hover, .rm-dark-theme .rmi-act:hover { color: #f5f8fa; }
  .bp3-dark .rmi-count, .rm-dark-theme .rmi-count { box-shadow: 0 0 0 2px #202b33; }
  .bp3-dark .rmi-row + .rmi-row, .rm-dark-theme .rmi-row + .rmi-row {
    border-top-color: rgba(255,255,255,.09);
  }
  .bp3-dark .rmi-tip-body, .rm-dark-theme .rmi-tip-body {
    background: #394b59; color: #f5f8fa;
    box-shadow: 0 0 0 1px rgba(16,22,26,.2), 0 2px 4px rgba(16,22,26,.4),
                0 8px 24px rgba(16,22,26,.4);
  }
  .bp3-dark .rmi-tip-caret, .rm-dark-theme .rmi-tip-caret {
    background: #394b59; box-shadow: -1px -1px 0 0 rgba(16,22,26,.2);
  }
`;

/* Not roamjs-components' addStyle. Its subpath form is a default export,
 * which this repository's ESM build breaks (see tests/interop.spec.ts), and
 * its barrel form, `import { addStyle } from "roamjs-components/dom"`,
 * works but drags the whole dom barrel into the bundle: parseRoamBlocksToHtml
 * pulls in marked, prismjs, and refractor, measured at 900 KB against the
 * 58 KB this extension ships. Four lines is cheaper. */
export const injectStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
};

export const removeStyle = (): void => {
  document.getElementById(STYLE_ID)?.remove();
};
