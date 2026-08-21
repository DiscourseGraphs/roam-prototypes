import { describe } from "vitest";
import * as core from "~/core";
import { driftProps, eq, issProps } from "./fixtures";

describe("parseValue", () => {
  eq("parseValue: empty", core.parseValue("  "), { kind: "empty", raw: "" });
  eq("parseValue: number", core.parseValue("12"), { kind: "number", raw: "12", num: 12 });
  eq("parseValue: simple page", core.parseValue("[[🌱 Exploration]]"), {
    kind: "page",
    raw: "[[🌱 Exploration]]",
    title: "🌱 Exploration",
  });
  eq(
    "parseValue: nested page (UC)",
    (core.parseValue("[[[[UC]] - Manuscript writing]]") as any).title,
    "[[UC]] - Manuscript writing",
  );
  eq("parseValue: two refs are not one page", core.parseValue("[[a]] and [[b]]").kind, "text");
  eq("parseValue: url", core.parseValue("https://linear.app/x").kind, "url");
  eq(
    "parseValue: bare url carries itself as .url",
    (core.parseValue("https://linear.app/x") as any).url,
    "https://linear.app/x",
  );
  // Whole-value markdown resolves — alias links are url slots with a label,
  // ((refs)) and [label](((refs))) are blockrefs (display resolves them).
  eq(
    "parseValue: markdown alias → url kind with label (issuesync's Linear::)",
    core.parseValue(
      "[FEE-859: Tag block in canvas as candidate node](https://linear.app/discourse-graphs/issue/FEE-859/tag-block)",
    ),
    {
      kind: "url",
      raw: "[FEE-859: Tag block in canvas as candidate node](https://linear.app/discourse-graphs/issue/FEE-859/tag-block)",
      url: "https://linear.app/discourse-graphs/issue/FEE-859/tag-block",
      label: "FEE-859: Tag block in canvas as candidate node",
    },
  );
  eq("parseValue: bare block ref", core.parseValue("((VGGDK1RQI))"), {
    kind: "blockref",
    raw: "((VGGDK1RQI))",
    uid: "VGGDK1RQI",
  });
  eq(
    "parseValue: alias link with text tail is NOT a url value",
    core.parseValue("[FEE-859](https://linear.app/x) plus notes").kind,
    "text",
  );
  eq("parseValue: info-link-only is empty (Flow template ℹ)", core.parseValue("[ℹ](((VGGDK1RQI)))"), {
    kind: "empty",
    raw: "[ℹ](((VGGDK1RQI)))",
    infoLink: true,
  });
  eq(
    "parseValue: two info links still empty",
    core.parseValue("[ℹ](((a1B2c3D4e))) [ℹ](((x9Y8z7W6v)))").kind,
    "empty",
  );
  eq("parseValue: non-ℹ block-ref link is a blockref value", core.parseValue("[details](((VGGDK1RQI)))"), {
    kind: "blockref",
    raw: "[details](((VGGDK1RQI)))",
    uid: "VGGDK1RQI",
    label: "details",
  });
  eq(
    "parseValue: info link plus real text stays a value",
    core.parseValue("[ℹ](((VGGDK1RQI))) 🚨 High").kind,
    "text",
  );
});

describe("parsePropertiesTree", () => {
  const parsed = core.parsePropertiesTree(issProps);
  eq("parse: 8 slots", parsed.slots.length, 8);
  eq("parse: no anomalies on clean block", parsed.anomalies.length, 0);
  eq("parse: keys in order", parsed.slots.map((s) => s.key), [
    "Linear",
    "Priority",
    "Issue Status",
    "Issue Type",
    "Project",
    "Function",
    "Flow",
    "Lead",
  ]);
  eq("parse: empty detected", parsed.slots[0].value.kind, "empty");
  eq("parse: number detected", (parsed.slots[1].value as any).num, 12);

  const drifted = core.parsePropertiesTree(driftProps);
  eq("parse: single-colon line is a read-only static row, not an anomaly", drifted.extras[0], {
    type: "static",
    uid: "d-linear",
    key: "Linear",
    valueRaw:
      "[TLDraw sync between graphs](https://linear.app/discourse-graphs/project/tldraw-sync)",
  });
  eq("parse: smartblock button extracted", drifted.extras[1], {
    type: "button",
    uid: "d-btn",
    label: "Project canvas",
    workflow: "Page Canvas",
  });
  eq("parse: duplicate key flagged", drifted.anomalies[0], {
    type: "duplicate-key",
    uid: "d-dup",
    key: "Issue Status",
  });
  eq("parse: truly unparseable line is an anomaly", drifted.anomalies[1].type, "unrecognized");
  eq("parse: clean block has no extras", parsed.extras.length, 0);
  eq(
    "inline: url is not a static-row false positive",
    core.parsePropertiesTree({
      uid: "x",
      string: "#.properties",
      children: [
        { uid: "x1", string: "see https://example.com/path for details", children: [] },
      ],
    }).anomalies.length,
    1,
  );
  eq(
    "parse: multi-value children",
    drifted.slots
      .find((s) => s.key === "Initiative")!
      .children.map((c) => (c.value as any).title),
    [
      "Initiative/Way smoother discourse relations",
      "Initiative/Streamline existing DG implementation in Roam",
    ],
  );
});

describe("parseInline", () => {
  eq("inline: alias link", core.parseInline("[TLDraw sync between graphs](https://linear.app/x)"), [
    { t: "link", text: "TLDraw sync between graphs", url: "https://linear.app/x" },
  ]);
  eq(
    "inline: mixed text, page ref, bare url",
    core.parseInline("see [[Project/Reifying Relations]] at https://roamresearch.com/x"),
    [
      { t: "text", s: "see " },
      { t: "page", title: "Project/Reifying Relations" },
      { t: "text", s: " at " },
      { t: "link", text: "https://roamresearch.com/x", url: "https://roamresearch.com/x" },
    ],
  );
  eq("inline: plain text passes through", core.parseInline("ENG-1240"), [
    { t: "text", s: "ENG-1240" },
  ]);
  eq("inline: bare block ref tokenized", core.parseInline("context: ((VGGDK1RQI)) done"), [
    { t: "text", s: "context: " },
    { t: "blockref", uid: "VGGDK1RQI" },
    { t: "text", s: " done" },
  ]);
  eq("inline: alias block ref keeps its label", core.parseInline("[details](((VGGDK1RQI)))"), [
    { t: "blockref", uid: "VGGDK1RQI", label: "details" },
  ]);
  eq("inline: page ref is not swallowed by the blockref pattern", core.parseInline("[[Project/X]]"), [
    { t: "page", title: "Project/X" },
  ]);
});

describe("refText", () => {
  eq(
    "refText: unwraps page refs and tags",
    core.refText("uses [[Project/X]] per #decision notes"),
    "uses Project/X per decision notes",
  );
  eq("refText: plain text untouched", core.refText("just words"), "just words");
});
