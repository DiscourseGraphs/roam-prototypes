import { describe } from "vitest";
import * as core from "~/core";
import { eq } from "./fixtures";

// The declared-buttons spec (2026-08-25) acceptance #6, retargeted from the
// retired test-panel.js to vitest: ":Icon=exchange",
// ":RemoveButton=false,Icon=add", an empty tail, and unknown keys.
describe("parseButtonOptions", () => {
  eq("options: single Icon", core.parseButtonOptions(":Icon=exchange"), {
    Icon: "exchange",
  });
  eq("options: pair list", core.parseButtonOptions(":RemoveButton=false,Icon=add"), {
    RemoveButton: "false",
    Icon: "add",
  });
  eq("options: empty tail", core.parseButtonOptions(""), {});
  eq("options: unknown keys pass through", core.parseButtonOptions(":Foo=bar,Baz=qux"), {
    Foo: "bar",
    Baz: "qux",
  });
  eq("options: segment without = is skipped", core.parseButtonOptions(":42,Icon=add"), {
    Icon: "add",
  });
});

describe("buttonIcon", () => {
  eq("icon: extracted", core.buttonIcon({ Icon: "exchange" }), "exchange");
  eq("icon: key case-insensitive, value lowercased", core.buttonIcon({ icon: "Add" }), "add");
  eq("icon: absent → null (never invent)", core.buttonIcon({ RemoveButton: "false" }), null);
  eq(
    "icon: unsafe value dropped (it lands in a class attribute)",
    core.buttonIcon({ Icon: "x y" }),
    null,
  );
  eq("icon: empty value dropped", core.buttonIcon({ Icon: "" }), null);
});

describe("parsePropertiesTree: buttons", () => {
  const tree = (strings: string[]) => ({
    uid: "p",
    string: "#.properties",
    children: strings.map((s, i) => ({ uid: `b${i}`, string: s, children: [] })),
  });
  eq(
    "button: convert-issue form (non-ASCII label, declared icon)",
    core.parsePropertiesTree(
      tree(["{{Convert this Issue…:SmartBlock:convertIssueButton:Icon=exchange}}"]),
    ).extras,
    [
      {
        type: "button",
        uid: "b0",
        label: "Convert this Issue…",
        workflow: "convertIssueButton",
        icon: "exchange",
      },
    ],
  );
  eq(
    "button: no options → icon null (pre-2026-08-25 pages)",
    core.parsePropertiesTree(tree(["{{Claim This Issue:SmartBlock:convertIssueButton}}"]))
      .extras,
    [
      {
        type: "button",
        uid: "b0",
        label: "Claim This Issue",
        workflow: "convertIssueButton",
        icon: null,
      },
    ],
  );
  eq(
    "button: two buttons kept in block order",
    core
      .parsePropertiesTree(
        tree([
          "{{Convert this Issue…:SmartBlock:convertIssueButton:Icon=exchange}}",
          "{{Project canvas:SmartBlock:Page Canvas}}",
        ]),
      )
      .extras.map((e) => (e as { label: string }).label),
    ["Convert this Issue…", "Project canvas"],
  );
});
