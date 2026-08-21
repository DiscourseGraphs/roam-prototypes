import { describe } from "vitest";
import * as core from "~/core";
import { driftProps, eq, issProps, templateProps } from "./fixtures";

const parsed = core.parsePropertiesTree(issProps);
const drifted = core.parsePropertiesTree(driftProps);
const statusSlot = parsed.slots.find((s) => s.key === "Issue Status")!;
const order = core.slotOrderFromTemplate(templateProps);

describe("template order", () => {
  eq("template: slot order", order.length, 8);
  eq(
    "insertionOrder: Flow goes before Lead, after existing six",
    core.insertionOrder(
      order,
      ["Linear", "Priority", "Issue Status", "Issue Type", "Project", "Function", "Lead"],
      "Flow",
    ),
    6,
  );
  eq("insertionOrder: unknown key appends", core.insertionOrder(order, ["Linear"], "Zzz"), 1);
});

describe("planWrite", () => {
  eq(
    "planWrite: update existing",
    core.planWrite(statusSlot, "[[🚀 Active]]", { blockUid: "MiMLS_5gT" }),
    [{ op: "update", uid: "u-status", string: "Issue Status:: [[🚀 Active]]" }],
  );
  eq("planWrite: clear value", core.planWrite(statusSlot, "", { blockUid: "MiMLS_5gT" }), [
    { op: "update", uid: "u-status", string: "Issue Status::" },
  ]);
  eq(
    "planWrite: ghost create in template order",
    core.planWrite(
      { key: "Flow", uid: null },
      "[[[[FLO]] - Add/edit DG relation on canvas (Roam)]]",
      {
        blockUid: "MiMLS_5gT",
        templateOrder: order,
        existingKeys: [
          "Linear",
          "Priority",
          "Issue Status",
          "Issue Type",
          "Project",
          "Function",
          "Lead",
        ],
      },
    ),
    [
      {
        op: "create",
        parentUid: "MiMLS_5gT",
        order: 6,
        string: "Flow:: [[[[FLO]] - Add/edit DG relation on canvas (Roam)]]",
      },
    ],
  );
  eq("canonicalRaw: page vocab", core.canonicalRaw("🚀 Active", "page"), "[[🚀 Active]]");
  eq("canonicalRaw: text vocab", core.canonicalRaw("🧪 Alpha", "text"), "🧪 Alpha");
});

describe("planMultiWrite", () => {
  const initSlot = drifted.slots.find((s) => s.key === "Initiative")!;
  eq(
    "planMultiWrite: remove one, add one",
    core.planMultiWrite(
      initSlot,
      [
        "[[Initiative/Way smoother discourse relations]]",
        "[[Initiative/Inter-graph functionality]]",
      ],
      { blockUid: "p2" },
    ),
    [
      { op: "delete", uid: "d-i2" },
      {
        op: "create",
        parentUid: "d-init",
        order: 2,
        string: "[[Initiative/Inter-graph functionality]]",
      },
    ],
  );
  eq(
    "planMultiWrite: ghost multi creates parent + children",
    core.planMultiWrite(
      { key: "Contributors", uid: null, valueRaw: "", children: [] },
      ["[[Matt Akamatsu]]"],
      { blockUid: "p2", templateOrder: [], existingKeys: [] },
    ),
    [
      {
        op: "create",
        parentUid: "p2",
        order: 0,
        string: "Contributors::",
        thenChildren: ["[[Matt Akamatsu]]"],
      },
    ],
  );
  eq(
    "planMultiWrite: inline value gets normalized to children",
    core.planMultiWrite(
      {
        key: "Initiative",
        uid: "x1",
        valueRaw: "[[Initiative/A]]",
        children: [],
      },
      ["[[Initiative/A]]", "[[Initiative/B]]"],
      { blockUid: "p2" },
    ),
    [
      { op: "update", uid: "x1", string: "Initiative::" },
      { op: "create", parentUid: "x1", order: 0, string: "[[Initiative/A]]" },
      { op: "create", parentUid: "x1", order: 1, string: "[[Initiative/B]]" },
    ],
  );
});

describe("multi-value drift", () => {
  const ffEntry = {
    name: "FlowFrequency",
    type: null,
    range: null,
    dynamic: null,
    displayHint: null,
    options: ["Daily", "Weekly", "Monthly", "Ad-hoc"].map((s) => ({
      ...core.parseValue(s),
      raw: s,
    })),
  } as any;
  const ffSlot = {
    key: "FlowFrequency",
    uid: "ff",
    valueRaw: "",
    value: core.parseValue(""),
    children: [
      {
        uid: "ff1",
        text: "1-2x week (including in prep for meeting)",
        value: core.parseValue("1-2x week (including in prep for meeting)"),
      },
      { uid: "ff2", text: "Weekly", value: core.parseValue("Weekly") },
    ],
  };
  eq(
    "multiDrift: off-vocab child flagged, in-vocab child not",
    core.multiDrift(ffSlot, ffEntry),
    ["1-2x week (including in prep for meeting)"],
  );
  eq("multiDrift: no registry entry → no flags", core.multiDrift(ffSlot, undefined), []);
  eq(
    "multiDrift: dynamic-only vocab → no flags",
    core.multiDrift(ffSlot, { options: null } as any),
    [],
  );

  const pmSlot = {
    key: "Initiative",
    uid: "pm",
    valueRaw: "",
    value: core.parseValue(""),
    children: [
      { uid: "pm1", text: "[[Initiative/A]]", value: core.parseValue("[[Initiative/A]]") },
      { uid: "pm2", text: "1-2x week", value: core.parseValue("1-2x week") },
    ],
  };
  eq(
    "preserveMultiRaws: existing children keep original text, new picks canonicalize",
    core.preserveMultiRaws(pmSlot, ["Initiative/A", "1-2x week", "Initiative/New"], "page"),
    ["[[Initiative/A]]", "1-2x week", "[[Initiative/New]]"],
  );
  eq(
    "preserveMultiRaws: rawFor supplies the dynamic option's exact write form",
    core.preserveMultiRaws(pmSlot, ["Initiative/A", "New Person"], "page", (t) =>
      t === "New Person" ? "New Person" : null,
    ),
    ["[[Initiative/A]]", "New Person"],
  );
  eq(
    "preserveMultiRaws: rawFor returning null falls back to canonical form",
    core.preserveMultiRaws(pmSlot, ["Initiative/New"], "page", () => null),
    ["[[Initiative/New]]"],
  );
});
