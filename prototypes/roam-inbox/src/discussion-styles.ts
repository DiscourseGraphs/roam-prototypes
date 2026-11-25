export const DISCUSSION_CSS = `
.rmi-discussion-layout { position:relative; }
#rmi-discussion-host { position:absolute; inset:8px 8px 8px auto; width:min(390px,calc(100% - 16px)); max-height:100%; min-height:0; z-index:20; box-shadow:0 3px 12px #1820261c,0 1px 3px #18202614; border-radius:5px; }
.rmi-discussion-rail,.rmi-discussion-inline,.rmi-discussion-badge {
  --base-bg:#fff; --base-soft:#f5f8fa; --base-text:#202b33; --base-muted:#526675;
  --base-line:#d8e1e8; --base-link:#106ba3; --base-selected:#e6f1f8;
  --base-hover:#ebf1f5; --base-green:#216746; --base-danger:#a82a30;
  --d-bg:var(--roamjs-surface,var(--cdt-popover-surface,var(--base-bg)));
  --d-soft:var(--roamjs-footer,var(--cdt-elevated-surface,var(--base-soft)));
  --d-text:var(--roamjs-text,var(--cdt-primary-text,var(--base-text)));
  --d-muted:var(--roamjs-muted,var(--cdt-secondary-text,var(--base-muted)));
  --d-line:var(--roamjs-border,var(--cdt-border,var(--base-line)));
  --d-accent:var(--roamjs-focus,var(--cdt-accent,var(--base-link)));
  --d-tint:var(--roamjs-selected,var(--cdt-selected-surface,var(--base-selected)));
  --d-hover:var(--roamjs-hover,var(--cdt-hover-surface,var(--base-hover)));
  --d-green:var(--base-green); --d-danger:var(--roamjs-danger,var(--base-danger));
  color:var(--d-text); font-family:inherit; font-size:14px; line-height:1.5; color-scheme:light;
}
:is(.bp3-dark,.rm-dark-theme,.roamjs-custom-dark-theme) :is(.rmi-discussion-rail,.rmi-discussion-inline,.rmi-discussion-badge) {
  --base-bg:#293742; --base-soft:#30404d; --base-text:#f5f8fa; --base-muted:#bfccd6;
  --base-line:#495d6c; --base-link:#8ecbff; --base-selected:#364f61;
  --base-hover:#394c5a; --base-green:#a1d8bd; --base-danger:#ffb5b8; color-scheme:dark;
}
.rmi-discussion-rail { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--d-bg); border:1px solid var(--d-line); border-radius:inherit; overflow:hidden; }
:is(.rmi-discussion-rail,.rmi-discussion-inline) .bp3-button { font-size:12px; line-height:1.4; }
:is(.rmi-discussion-rail,.rmi-discussion-inline,.rmi-discussion-badge) :is(button,select,article):focus-visible { outline:2px solid var(--d-accent) !important; outline-offset:2px; }
.rmi-discussion-header,.rmi-discussion-toolbar,.rmi-inline-header,.rmi-inline-loading,.rmi-discussion-composer-bottom { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.rmi-discussion-header { align-items:flex-start; padding:16px 15px 9px; }
.rmi-discussion-header h2 { display:flex; align-items:center; gap:7px; margin:0; font-size:16px; line-height:1.4; font-weight:600; color:var(--d-text); }
.rmi-discussion-page { font-size:12px; color:var(--d-muted); margin-top:3px; overflow-wrap:anywhere; }
.rmi-discussion-header-actions,.rmi-discussion-filters,.rmi-inline-header > div { display:flex; flex:none; align-items:center; }
.rmi-discussion-toolbar { padding:0 12px; border-bottom:1px solid var(--d-line); flex-wrap:wrap; }
.rmi-discussion-filters { gap:2px; }
.rmi-discussion-filters .bp3-button { border-radius:0; min-height:34px; border-bottom:2px solid transparent; padding:4px 6px; color:var(--d-muted); }
.rmi-discussion-rail .rmi-discussion-filters .bp3-button.bp3-minimal.bp3-active { color:var(--d-accent); border-bottom-color:currentColor; background:transparent; box-shadow:none; font-weight:600; }
.rmi-filter-count { font-size:11px; font-weight:500; margin-left:2px; font-variant-numeric:tabular-nums; }
.rmi-discussion-rail .rmi-discussion-toolbar > .bp3-button.bp3-minimal { color:var(--d-accent); font-weight:550; }
.rmi-discussion-scroll { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:0 16px 16px; scrollbar-gutter:stable; }
.rmi-discussion-group { margin:16px 0 20px; }
.rmi-discussion-group h3 { margin:0 0 6px; }
.rmi-discussion-rail .rmi-discussion-source.bp3-button.bp3-minimal { width:100%; padding:5px 6px; gap:7px; border-radius:3px; justify-content:flex-start; color:var(--d-accent); text-align:left; }
.rmi-discussion-source .bp3-button-text { flex:1; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; font-size:13px; line-height:1.45; font-weight:500; margin:0; }
.rmi-discussion-source .bp3-icon > svg { width:12px; height:12px; }
.rmi-discussion-thread { position:relative; padding:10px 10px 8px 13px; min-width:0; border-inline-start:2px solid transparent; }
.rmi-discussion-thread + .rmi-discussion-thread { border-top:1px solid var(--d-line); }
.rmi-discussion-selected[data-expanded="true"] { border-inline-start-color:var(--d-accent); }
.rmi-discussion-message { min-width:0; }
.rmi-discussion-message-body { flex:1; min-width:0; }
.rmi-discussion-author { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; margin-bottom:2px; }
.rmi-discussion-author strong { font-size:12px; font-weight:600; }
.rmi-discussion-author time,.rmi-discussion-composer-bottom > span { font-size:11px; color:var(--d-muted); }
.rmi-discussion-content { overflow-wrap:anywhere; white-space:pre-wrap; }
.rmi-discussion-content img { max-width:100%; height:auto; }
.rmi-discussion-nested { padding-left:10px; margin:5px 0; border-left:1px solid var(--d-line); }
.rmi-discussion-actions { display:flex; align-items:center; align-self:center; gap:2px; margin-inline-start:auto; }
.rmi-discussion-actions .bp3-button { position:relative; color:var(--d-muted); min-width:26px; min-height:26px; padding:3px; }
.rmi-discussion-actions [data-tooltip]:is(:hover,:focus-visible)::after { content:attr(data-tooltip); position:absolute; z-index:1; inset-block-start:calc(100% + 3px); inset-inline-end:0; padding:4px 7px; border:1px solid var(--d-line); border-radius:4px; color:var(--d-text); background:var(--d-bg); white-space:nowrap; pointer-events:none; }
.rmi-discussion-reply-count { color:var(--d-muted); font-size:11px; margin-top:5px; }
@media (hover:hover) and (pointer:fine) {
  .rmi-discussion-thread:not(:hover):not(:focus-within) .rmi-discussion-resolve:not([data-busy="true"]) { opacity:0; pointer-events:none; }
}
@media (any-pointer:coarse), (hover:none) {
  .rmi-discussion-thread:not(:hover):not(:focus-within) .rmi-discussion-resolve:not([data-busy="true"]) { opacity:1; pointer-events:auto; }
  .rmi-discussion-actions .bp3-button { min-width:32px; min-height:32px; }
}
.rmi-discussion-replies { margin:8px 0 2px 2px; padding:2px 0 2px 12px; border-inline-start:1px solid var(--d-line); display:grid; gap:10px; }
.rmi-discussion-composer { border:1px solid var(--d-line); background:var(--roamjs-input,var(--d-bg)); border-radius:3px; padding:7px 8px; }
.rmi-discussion-composer:focus-within { border-color:var(--d-accent); box-shadow:0 0 0 1px var(--d-accent); }
.rmi-discussion-composer textarea.bp3-input { display:block; width:100%; min-height:38px; padding:0; border:0; box-shadow:none; background:transparent; color:var(--d-text); font:inherit; resize:vertical; }
.rmi-discussion-composer-bottom { margin-top:4px; }
.rmi-discussion-composer[data-resting="true"]:not(:focus-within) { position:relative; border-color:transparent; padding:1px 0; background:transparent; }
.rmi-discussion-composer[data-resting="true"]:not(:focus-within) textarea.bp3-input { height:28px; min-height:28px; padding:3px 48px 3px 0; resize:none; }
.rmi-discussion-composer textarea::placeholder { color:var(--d-muted); opacity:1; }
.rmi-discussion-composer[data-resting="true"]:not(:focus-within) .rmi-discussion-composer-bottom { position:absolute; inset-inline-end:0; top:4px; margin:0; pointer-events:none; }
.rmi-discussion-composer[data-resting="true"]:not(:focus-within) .rmi-discussion-composer-bottom button { display:none; }
:is(.rmi-discussion-rail,.rmi-discussion-inline) .rmi-discussion-composer-bottom .bp3-button.bp3-intent-primary { background:var(--d-accent); color:var(--d-bg); box-shadow:none; }
:is(.rmi-discussion-rail,.rmi-discussion-inline) .rmi-discussion-composer-bottom .bp3-button.bp3-intent-primary:disabled { color:var(--d-muted); background:var(--d-hover); box-shadow:none; }
.rmi-discussion-empty { min-height:170px; display:grid; gap:8px; align-content:center; justify-items:center; text-align:center; padding:20px; color:var(--d-muted); }
.rmi-discussion-empty:not([role="status"]) { min-height:0; justify-items:start; text-align:start; padding:20px 0; }
.rmi-discussion-empty strong { color:var(--d-muted); font-size:13px; font-weight:500; }
.rmi-discussion-new { padding:16px 0; border-bottom:1px solid var(--d-line); }
.rmi-discussion-new label { display:block; margin-bottom:6px; font-weight:600; }
.rmi-discussion-new .bp3-html-select,.rmi-discussion-new select { max-width:100%; min-width:0; }
.rmi-discussion-new .rmi-discussion-composer { margin-top:10px; }
.rmi-discussion-resolved { font-size:11px; color:var(--d-green); font-weight:600; margin-bottom:6px; }
.rmi-discussion-note { color:var(--d-muted); font-size:12px; }
.rmi-discussion-error { color:var(--d-danger); padding:8px; font-size:12px; overflow-wrap:anywhere; }
.rmi-discussion-inline { margin:6px 0 12px 26px; padding:0 0 3px 10px; min-width:0; border-inline-start:2px solid var(--d-line); background:var(--d-bg); }
.rmi-inline-header { flex-wrap:wrap; min-height:34px; padding:0 4px; border-bottom:1px solid var(--d-line); color:var(--d-muted); }
.rmi-inline-header strong { font-size:12px; }
.rmi-discussion-inline .rmi-inline-header .bp3-button.bp3-minimal { color:var(--d-accent); }
.rmi-discussion-badge { display:inline-flex; order:1; flex:none; align-self:flex-start; margin-inline-start:auto; padding-inline-start:3px; }
/* Leave the embedded block's native hover controls clickable. */
.rm-block-main:has(> [id^="block-input-embed-"]) > .rmi-discussion-badge { margin-inline-end:64px; }
@media(min-width:651px) {
  .rmi-discussion-layout .rmi-discussion-badge { position:sticky; right:var(--rmi-badge-inset,0px); border-radius:3px; background:var(--d-bg); }
}
.rmi-discussion-badge .bp3-button { min-height:24px; min-width:36px; padding:2px 5px; column-gap:6px; justify-content:flex-end; color:var(--d-muted); background:transparent; border-radius:3px; font-size:12px; font-variant-numeric:tabular-nums; }
.rmi-discussion-badge .bp3-icon svg { width:13px; height:13px; }
.rmi-discussion-badge .bp3-button.bp3-minimal:is([aria-expanded=true],[aria-current=true]) { color:var(--d-accent); background:var(--d-tint); box-shadow:inset 0 -2px var(--d-accent); }
:is(.rmi-discussion-rail,.rmi-discussion-inline,.rmi-discussion-badge) .bp3-button.bp3-minimal:hover { background:var(--d-hover); }
:is(.rmi-discussion-rail,.rmi-discussion-inline,.rmi-discussion-badge) .bp3-icon { color:inherit; }
.rmi-discussion-header h2 .bp3-icon,.rmi-discussion-header-actions .bp3-button { color:var(--d-muted); }
.rmi-discussion-source .bp3-icon:last-child { color:var(--d-muted); }
.rmi-discussion-source::before { content:""; width:5px; height:5px; border-radius:50%; background:var(--d-muted); flex:none; }
.rmi-discussion-rail .rmi-discussion-thread:focus-visible { outline-offset:-2px; }
.rmi-discussion-badge .bp3-button-text { margin:0; }
@media(max-width:650px) {
  #rmi-discussion-host { position:fixed; inset:0; width:100%; max-width:none; border-radius:0; z-index:1000; }
  .rmi-discussion-rail { padding-bottom:env(safe-area-inset-bottom); border:0; }
  .rmi-discussion-rail button.bp3-button { min-height:36px; }
  .rmi-discussion-scroll { padding-inline:10px; }
  .rmi-discussion-header,.rmi-discussion-toolbar { padding-inline:12px; }
  .rmi-discussion-inline { margin-left:12px; padding-inline:7px; }
  .rmi-discussion-composer textarea.bp3-input { font-size:16px; }
}
`;
