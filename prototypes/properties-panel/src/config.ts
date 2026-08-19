import type { ConfigAction } from "~/types";

export const VERSION = "0.5.0";

export const CONFIG = {
  propertiesTag: ".properties", // page whose #tag marks the block
  registryPage: "roam/js/attribute-select",
  nodeTypePrefix: "discourse-graph/nodes/",
  defaultOn: true, // Matt 8/4: panel is the default view everywhere
  actionsAtTitle: true, // Matt 8/4: actions row at title level (placement B)
  fillMeter: true, // Matt 8/4: keep
  searchThreshold: 10, // DIS-152: filter input past this many options
  // Slots edited as multi-select even when currently single/empty. Slots
  // that already have child-block values are always treated as multi.
  multiValueSlots: ["Initiative", "Contributors", "Related projects"],
  // Integration links — `Linear::`, `GitHub::` — render as normal key/value
  // rows, NOT standalone portal buttons (PRO-207 feedback). URL values show
  // a compact label that opens the link; the caret still opens the editor.
  // Dynamic options (<%QUERYBUILDER%>, <%ACTIVEUSERS%>) run the registry's
  // options block as a SmartBlock — the exact call attribute-select makes —
  // so the dropdown shows the real query results. Results are cached per
  // options block for this long; queries can take a second.
  dynamicCacheMs: 60000,
  // FALLBACK ONLY (SmartBlocks or the DG plugin unavailable): QUERYBUILDER
  // options degrade to page-title prefix autocomplete.
  queryPrefixes: {
    initiatives: "Initiative/",
    activeProjects: "Project/",
    epics: "Epic/",
    milestones: "Milestone/",
    allFlows: "[[FLO]] - ",
    allUseCases: "[[UC]] - ",
    pilots: "UserPilot/",
    tutorials: null, // null → contains-match over all page titles
    iosp: null,
  } as Record<string, string | null>,
  actions: [
    // Jumps to the existing Discourse Context widget for now; a persistent
    // discourse-context window (as being built for the canvas) supersedes
    // this in later work.
    { key: "context", label: "🧠 Discourse Context", enabled: true },
    { key: "publish", label: "↑ Publish", enabled: false },
    { key: "linear", label: "⇄ Sync Linear", enabled: false },
  ] as ConfigAction[],
  pollMs: 2500, // re-mount check; Roam re-renders can blow the host away
  writeSettleMs: 350, // editor store lags API writes; wait before re-read
};

// Display pages that aren't people (roam-inbox convention).
export const EXCLUDE_USER_PATTERNS = [/^(Local )?API Token:/i, /^Anonymous(_\d+)?$/];
