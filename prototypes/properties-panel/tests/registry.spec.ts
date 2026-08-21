import { describe } from "vitest";
import * as core from "~/core";
import { driftProps, eq, issProps, registryTree } from "./fixtures";

const registry = core.registryFromTree(registryTree);
const parsed = core.parsePropertiesTree(issProps);
const drifted = core.parsePropertiesTree(driftProps);

describe("registryFromTree", () => {
  eq("registry: Priority type", registry["Priority"].type, "number");
  eq("registry: Priority range", registry["Priority"].range, [0, 100]);
  eq("registry: Issue Status options are pages", core.vocabKind(registry["Issue Status"]), "page");
  eq("registry: ArtStatus options are text", core.vocabKind(registry["ArtStatus"]), "text");
  eq("registry: ArtStatus display template", registry["ArtStatus"].template, "No styling");
  eq("registry: Lead dynamic", registry["Lead"].dynamic, {
    kind: "ACTIVEUSERS",
    query: "this month",
    raw: "<%ACTIVEUSERS:this month%>",
  });
  eq("registry: Project dynamic query", registry["Project"].dynamic, {
    kind: "QUERYBUILDER",
    query: "activeProjects",
    raw: "<%QUERYBUILDER:activeProjects,<%TAG:{text}%>%>",
  });
  eq("registry: options block uid captured (Project)", registry["Project"].optionsUid, "r-pr-o");
  eq("registry: options block uid captured (Lead)", registry["Lead"].optionsUid, "r-l-o");
  eq("registry: empty range tolerated", registry["Issue Status"].range, null);
});

describe("conformance", () => {
  const statusSlot = parsed.slots.find((s) => s.key === "Issue Status")!;
  eq("conformance: valid page value", core.conformance(statusSlot, registry["Issue Status"]), {
    ok: true,
  });
  const driftSlot = drifted.slots.find((s) => s.key === "Issue Status")!;
  eq(
    "conformance: text-vs-page drift with suggestion",
    core.conformance(driftSlot, registry["Issue Status"]),
    { ok: false, reason: "text-vs-page", suggestion: "[[🚀 Active]]" },
  );
  eq(
    "conformance: out-of-vocab",
    core.conformance(
      { value: core.parseValue("[[🌋 Erupting]]") },
      registry["Issue Status"],
    ),
    { ok: false, reason: "not-in-vocab", suggestion: null },
  );
  eq(
    "conformance: number out of range",
    core.conformance({ value: core.parseValue("140") }, registry["Priority"]),
    { ok: false, reason: "out-of-range", suggestion: null },
  );
  eq(
    "conformance: undeclared slot always ok",
    core.conformance({ value: core.parseValue("anything") }, undefined),
    { ok: true },
  );
  eq(
    "conformance: empty is ok even with vocab",
    core.conformance({ value: core.parseValue("") }, registry["Issue Status"]),
    { ok: true },
  );
});

describe("display templates (attribute-select parity)", () => {
  eq(
    "template: Remove Double Brackets on a simple link",
    core.applyTemplate("[[🚀 Active]]", "Remove Double Brackets"),
    "🚀 Active",
  );
  // Pinned attribute-select quirk: the lazy regex leaves one bracket pair on
  // nested titles. Parity means reproducing it, not fixing it here.
  eq(
    "template: Remove Double Brackets nested-title quirk (parity)",
    core.applyTemplate("[[[[FLO]] - Foo]]", "Remove Double Brackets"),
    "[[FLO - Foo]]",
  );
  eq(
    "template: Convert to Uppercase",
    core.applyTemplate("alpha beta", "Convert to Uppercase"),
    "ALPHA BETA",
  );
  eq(
    "template: Capitalize Words",
    core.applyTemplate("waiting FOR review", "Capitalize Words"),
    "Waiting For Review",
  );
  eq(
    "template: Custom Format is a single non-global replace (parity)",
    core.applyTemplate("a-a-a", "Custom Format", "-", "+"),
    "a+a-a",
  );
  eq(
    "template: Custom Format invalid regex passes text through",
    core.applyTemplate("keep me", "Custom Format", "[", "x"),
    "keep me",
  );
  eq("template: unknown name passes text through", core.applyTemplate("x", "Nope"), "x");
});

describe("smartblock option mapping", () => {
  // triggerSmartblock result mapping: QUERYBUILDER + <%TAG:{text}%> yields
  // [[page link]] strings; ACTIVEUSERS with {text} yields bare names.
  eq(
    "smartblock options: TAG-wrapped pages parse to page kind, raw preserved",
    core.optionsFromSmartblockResults(
      [
        { text: "[[Project/A]]" },
        { text: "[[[[UC]] - Manuscript writing]]" },
        { text: "   " },
        null,
      ],
      registry["Project"],
    ),
    // Labels drop format/namespace prefixes; title/raw keep the full form
    // (selection compares titles, writes use raw).
    [
      { title: "Project/A", raw: "[[Project/A]]", kind: "page", label: "A" },
      {
        title: "[[UC]] - Manuscript writing",
        raw: "[[[[UC]] - Manuscript writing]]",
        kind: "page",
        label: "Manuscript writing",
      },
    ],
  );
  eq(
    "smartblock options: bare ACTIVEUSERS names are text kind (write bare)",
    core.optionsFromSmartblockResults([{ text: "Matt Akamatsu" }], registry["Lead"]),
    [{ title: "Matt Akamatsu", raw: "Matt Akamatsu", kind: "text", label: "Matt Akamatsu" }],
  );
  eq(
    "smartblock options: declared template shapes the label, never the raw",
    core.optionsFromSmartblockResults([{ text: "[[[[FLO]] - Foo]]" }], {
      template: "Remove Double Brackets",
      customPattern: null,
      customReplacement: null,
    }),
    [
      {
        title: "[[FLO]] - Foo",
        raw: "[[[[FLO]] - Foo]]",
        kind: "page",
        label: "[[FLO - Foo]]",
      },
    ],
  );
});
