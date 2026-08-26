import { describe } from "vitest";
import * as core from "~/core";
import { eq } from "./fixtures";

describe("displayTitle", () => {
  // Chips and dropdown labels drop format/namespace prefixes; selection,
  // filtering, and writes keep the full title.
  eq(
    "displayTitle: [[FLO]] - format prefix stripped",
    core.displayTitle("[[FLO]] - Update status for projects"),
    "Update status for projects",
  );
  eq(
    "displayTitle: Project/ namespace stripped",
    core.displayTitle("Project/Node slot properties and sync"),
    "Node slot properties and sync",
  );
  eq("displayTitle: UserPilot/ namespace stripped", core.displayTitle("UserPilot/Trang"), "Trang");
  eq(
    "displayTitle: slash inside a real title survives (word-boundary rule)",
    core.displayTitle("Scope all the touch points for import/publish in Obsidian"),
    "Scope all the touch points for import/publish in Obsidian",
  );
  eq(
    "displayTitle: lowercase namespace (roam/js/…) untouched",
    core.displayTitle("roam/js/attribute-select"),
    "roam/js/attribute-select",
  );
  eq(
    "displayTitle: prefix-only title comes back verbatim",
    core.displayTitle("[[EVD]] - "),
    "[[EVD]] - ",
  );
  eq("displayTitle: plain vocab value untouched", core.displayTitle("💡 In Progress"), "💡 In Progress");
});

describe("urlDisplay", () => {
  // URL slot values render as link-chip rows whose text is a compact handle
  // for the destination.
  eq(
    "urlDisplay: Linear issue URL → uppercased issue key",
    core.urlDisplay("https://linear.app/discourse-graphs/issue/pro-207/node-properties-panel-roam"),
    "PRO-207",
  );
  eq(
    "urlDisplay: Linear project URL → de-slugged name, hash stripped",
    core.urlDisplay(
      "https://linear.app/discourse-graphs/project/node-slot-properties-and-sync-db9b9213a290",
    ),
    "node slot properties and sync",
  );
  eq(
    "urlDisplay: GitHub PR URL → repo#number",
    core.urlDisplay("https://github.com/DiscourseGraphs/dg-properties-panel/pull/12"),
    "dg-properties-panel#12",
  );
  eq(
    "urlDisplay: GitHub issue URL → repo#number",
    core.urlDisplay("https://github.com/RoamJS/workbench/issues/123"),
    "workbench#123",
  );
  eq(
    "urlDisplay: GitHub repo URL → owner/repo",
    core.urlDisplay("https://github.com/DiscourseGraphs/dg-properties-panel"),
    "DiscourseGraphs/dg-properties-panel",
  );
  eq(
    "urlDisplay: unknown host → hostname, www stripped",
    core.urlDisplay("https://www.example.org/some/deep/path?q=1"),
    "example.org",
  );
  eq("urlDisplay: unparseable input comes back verbatim", core.urlDisplay("not a url"), "not a url");
});

describe("matchNodeType", () => {
  const types = [
    { name: "Issue", format: "[[ISS]] - {content}" },
    { name: "Project", format: "Project/{content}" },
    { name: "Experiment", format: "@exp-{content}" },
  ];
  eq(
    "matchNodeType: ISS",
    core.matchNodeType("[[ISS]] - send evd + citation to your authoring platform", types)!.name,
    "Issue",
  );
  eq(
    "matchNodeType: Project",
    core.matchNodeType("Project/Reifying Relations", types)!.name,
    "Project",
  );
  eq("matchNodeType: none", core.matchNodeType("August 4th, 2026", types), null);
  eq(
    "matchNodeType: regex specials in format escaped",
    core.matchNodeType("@exp-branched actin", types)!.name,
    "Experiment",
  );
});

describe("actionSlots", () => {
  const BUILTINS = [
    { key: "context", label: "🧠 Discourse Context", enabled: true },
    { key: "publish", label: "↑ Publish", enabled: false },
    { key: "linear", label: "⇄ Sync Linear", enabled: false },
  ];
  eq(
    "actionSlots: no registrations → all stubs in order",
    core.actionSlots(BUILTINS, []).map((s) => s.key + ":" + s.registered),
    ["context:false", "publish:false", "linear:false"],
  );
  eq(
    "actionSlots: registered key replaces its stub IN PLACE",
    core.actionSlots(BUILTINS, ["linear"]).map((s) => s.key + ":" + s.registered),
    ["context:false", "publish:false", "linear:true"],
  );
  eq(
    "actionSlots: unknown registered key appends a new slot",
    core.actionSlots(BUILTINS, ["linear", "github-sync"]).map((s) => s.key + ":" + s.registered),
    ["context:false", "publish:false", "linear:true", "github-sync:true"],
  );
});
