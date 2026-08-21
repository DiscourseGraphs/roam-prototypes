/* The panel's stylesheet, carried in the bundle rather than shipped beside
 * it: Roam injects a published `extension.css` on the URL-loading path, but
 * nothing injects it when the module is imported from a `roam/js` block —
 * which is how PR previews get tested. Injected via addStyle so unload can
 * remove it. All rules are scoped under the panel's own ids/classes.
 *
 * Dark theme, full coverage. Two signals, same palette: native Roam marks an
 * ancestor .rm-dark; Roam Studio stamps rs-dark on <html>. Studio's own
 * ~2600 component vars are too granular to build on, so these are fixed
 * Blueprint-dark-adjacent values.
 */
export const PANEL_CSS = `
#dg-props-panel-host { margin: 4px 0 8px; }
.dgpp { background:#F8F9FB; border:1px solid #E1E5EA; border-radius:6px; padding:10px 14px 12px; font-size:13.5px; color:#202B33; }
.dgpp-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.dgpp-label { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:#8A9BA8; }
.dgpp-spacer { flex:1; }
.dgpp-meta { font-size:12px; color:#8A9BA8; }
.dgpp-meta.link { color:#106BA3; cursor:pointer; }
.dgpp-rows { display:grid; grid-template-columns:auto 1fr auto 1fr; gap:6px 10px; align-items:center; }
@media (max-width:700px){ .dgpp-rows { grid-template-columns:auto 1fr; } }
.dgpp-k { color:#8A9BA8; font-size:12.5px; text-align:right; white-space:nowrap; }
.dgpp-chip { display:inline-flex; align-items:center; gap:5px; max-width:100%; background:#fff; border:1px solid #D8DEE4; border-radius:4px; padding:1px 8px; font-size:13px; cursor:pointer; }
.dgpp-chip .val { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgpp-chip .val a { color:#106BA3; }
.dgpp-chip .val.ref { color:#106BA3; }
.dgpp-chip .val.link { cursor:alias; }
.dgpp-chip .val.link:hover { text-decoration:underline; }
.dgpp-chip .caret { color:#A9B4BF; font-size:10px; }
.dgpp-chip.ghost { border-style:dashed; color:#A9B4BF; background:transparent; }
.dgpp-chip.drift { border-color:#EAC9A4; background:#FCF3E8; }
.dgpp-chip .warn { color:#BF7326; font-size:11.5px; }
.dgpp-tok { background:#EDF0F2; border-radius:3px; padding:0 6px; font-size:12.5px; color:#106BA3; }
.dgpp-rangebar { display:inline-block; width:56px; height:3px; background:#E1E5EA; border-radius:2px; margin-left:8px; vertical-align:middle; }
.dgpp-rangefill { display:block; height:100%; background:#8A9BA8; border-radius:2px; }
.dgpp-pop { position:absolute; z-index:99; background:#fff; border-radius:4px; min-width:220px; max-width:340px; text-align:left;
  box-shadow:0 0 0 1px rgba(16,22,26,.1),0 2px 4px rgba(16,22,26,.2),0 8px 24px rgba(16,22,26,.2); padding:4px; }
.dgpp-pop input { width:100%; border:none; outline:none; border-bottom:1px solid #EDF0F2; padding:5px 8px; font-size:13px; margin-bottom:3px; background:transparent; color:inherit; }
.dgpp-opts { max-height:240px; overflow-y:auto; }
.dgpp-opt { padding:4px 8px; border-radius:3px; display:flex; align-items:flex-start; justify-content:flex-start; gap:7px; cursor:pointer; font-size:13px; line-height:1.4; text-align:left; }
.dgpp-opt:hover { background:#F1F5F8; }
.dgpp-opt.sel { background:#E7F0F7; }
.dgpp-optlabel { flex:1 1 auto; min-width:0; text-align:left; }
.dgpp-optlabel.off { color:#BF7326; }
.dgpp-tick { width:14px; flex:none; color:#106BA3; font-size:12px; margin-top:1px; }
.dgpp-pfoot { border-top:1px solid #EDF0F2; margin-top:3px; padding:5px 8px 3px; font-size:11.5px; color:#8A9BA8; }
.dgpp-pfoot .esc { color:#106BA3; cursor:pointer; }
.dgpp-anom { margin-top:8px; font-size:11.5px; color:#BF7326; }
.dgpp-static { font-size:13px; color:#202B33; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgpp-static a { color:#106BA3; cursor:pointer; text-decoration:none; }
.dgpp-btnrow { display:flex; gap:8px; margin-top:10px; }
.dgpp-numin { border:1px solid #D8DEE4; border-radius:3px; background:transparent; color:inherit; }
.dgpp-raw-note { font-size:11.5px; color:#8A9BA8; margin:2px 0 6px; }
#dg-props-actions { display:flex; gap:8px; margin:6px 0 2px; }
.dgpp-slot { display:inline-flex; align-items:center; }
.dgpp-slot .bp3-button { min-height:24px; padding:2px 10px; }
.dgpp-abtn { display:inline-flex; align-items:center; gap:6px; border:1px solid #D8DEE4; background:#fff; border-radius:4px; padding:2px 10px; font-size:12.5px; color:#394B59; cursor:pointer; }
.dgpp-abtn.stub { color:#9AA5B1; cursor:default; }
.dgpp-abtn .xbadge { font-size:9.5px; letter-spacing:.05em; text-transform:uppercase; color:#BF7326; border:1px solid #EAC9A4; border-radius:3px; padding:0 3px; }
.rm-dark .dgpp, html.rs-dark .dgpp { background:#252A31; border-color:#383E47; color:#DCE0E5; }
.rm-dark .dgpp-k, html.rs-dark .dgpp-k,
.rm-dark .dgpp-label, html.rs-dark .dgpp-label,
.rm-dark .dgpp-meta, html.rs-dark .dgpp-meta,
.rm-dark .dgpp-raw-note, html.rs-dark .dgpp-raw-note { color:#93A1AE; }
.rm-dark .dgpp-meta.link, html.rs-dark .dgpp-meta.link,
.rm-dark .dgpp-pfoot .esc, html.rs-dark .dgpp-pfoot .esc,
.rm-dark .dgpp-tick, html.rs-dark .dgpp-tick { color:#48AFF0; }
.rm-dark .dgpp-chip, html.rs-dark .dgpp-chip { background:#2F343C; border-color:#4C5560; color:#DCE0E5; }
.rm-dark .dgpp-chip .val a, html.rs-dark .dgpp-chip .val a,
.rm-dark .dgpp-chip .val.ref, html.rs-dark .dgpp-chip .val.ref { color:#48AFF0; }
.rm-dark .dgpp-chip.ghost, html.rs-dark .dgpp-chip.ghost { background:transparent; color:#7A8894; }
.rm-dark .dgpp-chip.drift, html.rs-dark .dgpp-chip.drift { background:#38301F; border-color:#7A5B2B; }
.rm-dark .dgpp-chip .warn, html.rs-dark .dgpp-chip .warn,
.rm-dark .dgpp-optlabel.off, html.rs-dark .dgpp-optlabel.off,
.rm-dark .dgpp-anom, html.rs-dark .dgpp-anom { color:#E0A458; }
.rm-dark .dgpp-tok, html.rs-dark .dgpp-tok { background:#383E47; color:#48AFF0; }
.rm-dark .dgpp-rangebar, html.rs-dark .dgpp-rangebar { background:#383E47; }
.rm-dark .dgpp-pop, html.rs-dark .dgpp-pop { background:#2F343C; color:#DCE0E5; }
.rm-dark .dgpp-pop input, html.rs-dark .dgpp-pop input { border-bottom-color:#383E47; }
.rm-dark .dgpp-numin, html.rs-dark .dgpp-numin { border-color:#4C5560; }
.rm-dark .dgpp-opt:hover, html.rs-dark .dgpp-opt:hover { background:#383E47; }
.rm-dark .dgpp-opt.sel, html.rs-dark .dgpp-opt.sel { background:#2B4A63; }
.rm-dark .dgpp-pfoot, html.rs-dark .dgpp-pfoot { border-top-color:#383E47; color:#93A1AE; }
.rm-dark .dgpp-static, html.rs-dark .dgpp-static { color:#DCE0E5; }
.rm-dark .dgpp-static a, html.rs-dark .dgpp-static a { color:#48AFF0; }
.rm-dark .dgpp-abtn, html.rs-dark .dgpp-abtn { background:#2F343C; border-color:#4C5560; color:#C5CBD3; }
.rm-dark .dgpp-abtn.stub, html.rs-dark .dgpp-abtn.stub { color:#7A8894; }
`;
