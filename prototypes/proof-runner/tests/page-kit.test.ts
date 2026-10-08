import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateKit, type Kit } from "../src/core/kit";
import { attribute, codeBlock, isProofRoot, kitBlocks, pageKit, rootConfig, unquote, type BlockNode } from "../src/roam/page-kit";

const KITS = path.join(__dirname, "fixtures/kits");

// As a page reads back: no last-run note, and the rejected cases at the end,
// where the page keeps them under "Not tested, and why".
const withoutLast = (kit: Kit): Kit => {
  const cases = kit.cases.map(({ last: _last, ...rest }) => rest);
  const rejected = cases.filter((testCase) => testCase.decision?.status === "rejected");
  return { ...kit, cases: [...cases.filter((testCase) => !rejected.includes(testCase)), ...rejected] };
};

// Blocks as Roam stores them: strings only.
const stored = (node: BlockNode): BlockNode => JSON.parse(JSON.stringify(node)) as BlockNode;

describe("a kit written as blocks", () => {
  for (const file of readdirSync(KITS).filter((name) => name.endsWith(".json")).sort()) {
    it(`${file} comes back unchanged`, () => {
      const kit = validateKit(JSON.parse(readFileSync(path.join(KITS, file), "utf8")));
      const parsed = pageKit(stored(kitBlocks(kit, { build: "eng-test-branch" })));
      expect(parsed.kit).toEqual(withoutLast(kit));
      expect(parsed.build).toBe("eng-test-branch");
      expect(parsed.pr).toBe(kit.target?.pr ?? null);
    });
  }

  it("reads a hand-written page: aliases, notes, a case done by hand", () => {
    const root: BlockNode = {
      uid: "root00001",
      string: "{{[[proof]]}} Node search",
      children: [
        { string: "kit:: node-search" },
        { string: "pr:: #1485" },
        { string: "Notes for whoever reads this page are fine here." },
        {
          uid: "case00001",
          string: "case:: Search finds the claim",
          children: [
            { uid: "step00001", string: "open node search", children: [{ string: "palette:: DG: Open Node Search" }] },
            { uid: "step00002", string: "search for it", children: [{ string: 'type:: `{"into": ".bp3-dialog input", "text": "claim"}`' }] },
            { string: "expect:: the claim shows in the results" },
          ],
        },
        {
          string: "case:: Drag it onto a canvas",
          children: [{ string: "intent:: drag the claim onto the canvas" }, { string: "expect:: a node shape appears" }],
        },
        { string: "runs", children: [{ string: "✓ 2/2 passed" }] },
      ],
    };
    const parsed = pageKit(root);
    const [search, drag] = parsed.kit.cases;
    expect(parsed.pr).toBe(1485);
    expect(search.steps[0].do).toEqual({ command_palette: "DG: Open Node Search" });
    expect(search.steps[1].do).toEqual({ type: { into: ".bp3-dialog input", text: "claim" } });
    expect(drag.steps).toHaveLength(0);
    expect(drag.intent).toBe("drag the claim onto the canvas");
    expect(parsed.blocks.steps[`${search.id}/${search.steps[1].id}`]).toBe("step00002");
  });

  it("refuses a typo in a case field instead of passing the case unchecked", () => {
    const root: BlockNode = {
      string: "{{proof}}",
      children: [{ string: "kit:: typo" }, { string: "case:: Has a typo", children: [{ string: "expects:: something" }] }],
    };
    expect(() => pageKit(root)).toThrow(/"expects::" isn't a case field/);
  });

  it("reads build and pr before the kit validates", () => {
    const root: BlockNode = {
      string: "{{proof}}",
      children: [{ string: "build:: eng-1-x" }, { string: "pr:: 12" }, { string: "case:: unfinished" }],
    };
    expect(rootConfig(root)).toEqual({ build: "eng-1-x", pr: 12, kit: null });
    expect(() => pageKit(root)).toThrow();
  });

  it("parses attributes, inline code and code blocks", () => {
    expect(attribute("expect js:: `proof.x()`")).toEqual({ key: "expect js", value: "`proof.x()`" });
    expect(attribute("Open DG: Discover shared nodes")).toBeNull();
    expect(unquote("`a [[b]] __c__`")).toBe("a [[b]] __c__");
    expect(codeBlock('```json\n{"a": 1}\n```')).toEqual({ lang: "json", code: '{"a": 1}' });
    expect(isProofRoot("{{proof}} anything")).toBe(true);
    expect(isProofRoot("see {{proof}}")).toBe(false);
  });
});
