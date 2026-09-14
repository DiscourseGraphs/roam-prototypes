/* Graph reads. Every query is stubbed; nothing here talks to Roam.
 *
 * graph.ts holds module-level node-type state, so each test sets it up
 * explicitly rather than relying on order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedTypeForTitle,
  findNodeTypeForTitle,
  graphName,
  loadNodeTypes,
  pick,
  resolveBlockRefs,
  roamUrlForTitle,
  setNodeTypes,
  titleForUid,
  uidForTitle,
} from "~/graph";

const EVD = "[[EVD]] - {content} - {Source}";
const RES = "[[RES]] - {content} - {Source}";

const stubQ = (impl: (query: string, ...params: unknown[]) => unknown[][]) => {
  const q = vi.fn(async (query: string, ...params: unknown[]) => impl(query, ...params));
  (window as unknown as Record<string, unknown>).roamAlphaAPI = {
    data: { async: { q } },
  };
  return q;
};

/* Each datalog row is a one-element array holding the pulled page. */
const rowsFor = (pages: unknown[]) => () => pages.map((p) => [p]);

const nodePage = (type: string, format: string) => ({
  ":node/title": `discourse-graph/nodes/${type}`,
  ":block/children": [
    { ":block/string": "Shortcut", ":block/children": [{ ":block/string": "R" }] },
    { ":block/string": "Format", ":block/children": [{ ":block/string": format }] },
  ],
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setNodeTypes([]);
});

describe("pick", () => {
  /* Pull results come back namespaced from some API surfaces and bare from
   * others. Betting on one silently yields zero node types. */
  it("reads a namespaced key", () => {
    expect(pick({ ":node/title": "x" }, "node/title")).toBe("x");
  });
  it("reads the same key written plainly", () => {
    expect(pick({ "node/title": "x" }, "node/title")).toBe("x");
  });
  it("reads the bare attribute name", () => {
    expect(pick({ title: "x" }, "node/title")).toBe("x");
  });
  it("returns undefined rather than throwing on a missing entity", () => {
    expect(pick(undefined, "node/title")).toBeUndefined();
  });
});

describe("loadNodeTypes", () => {
  it("reads the format from the Format block's child", async () => {
    stubQ(rowsFor([nodePage("Result", RES)]));
    await loadNodeTypes();
    expect(findNodeTypeForTitle("[[RES]] - A finding - @key2020")?.type).toBe("Result");
  });

  it("skips a page with no Format block instead of failing", async () => {
    stubQ(
      rowsFor([
        { ":node/title": "discourse-graph/nodes/Bare", ":block/children": [] },
        nodePage("Result", RES),
      ]),
    );
    await loadNodeTypes();
    expect(findNodeTypeForTitle("[[RES]] - A finding - @key2020")?.type).toBe("Result");
  });

  /* The per-type try/catch. Without it one typo on one config page aborts
   * the whole batch and the extension has no node types at all. */
  it("survives a malformed Format on one page", async () => {
    stubQ(rowsFor([nodePage("Weird", "[[WEI]] - {content} (unbalanced"), nodePage("Result", RES)]));
    await loadNodeTypes();
    expect(findNodeTypeForTitle("[[RES]] - A finding - @key2020")?.type).toBe("Result");
  });

  it("drops the malformed type itself", async () => {
    stubQ(rowsFor([nodePage("Weird", "[[WEI]] - {content} (unbalanced"), nodePage("Result", RES)]));
    await loadNodeTypes();
    expect(findNodeTypeForTitle("[[WEI]] - anything")).toBeNull();
  });

  /* Zero types is otherwise invisible: nothing gets marked, right-click does
   * nothing, and that looks identical to a graph with no discourse nodes. */
  it("warns when it finds none, naming the config prefix", async () => {
    stubQ(() => []);
    await loadNodeTypes();
    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("discourse-graph/nodes/");
  });

  it("stays silent on a normal, non-zero set", async () => {
    stubQ(rowsFor([nodePage("Result", RES)]));
    await loadNodeTypes();
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });

  it("logs the count either way", async () => {
    stubQ(() => []);
    await loadNodeTypes();
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toMatch(/\b0\b/);
  });

  it("passes the prefix as a query input rather than interpolating it", async () => {
    const q = stubQ(() => []);
    await loadNodeTypes();
    expect(q.mock.calls[0]?.[1]).toBe("discourse-graph/nodes/");
  });
});

describe("findNodeTypeForTitle", () => {
  beforeEach(() => setNodeTypes([{ type: "Evidence", format: EVD }, { type: "Result", format: RES }]));

  it("finds the Evidence type from a title", () => {
    expect(findNodeTypeForTitle("[[EVD]] - A finding - @key2020")?.type).toBe("Evidence");
  });
  it("does not treat an ordinary page as a node", () => {
    expect(findNodeTypeForTitle("Meeting notes")).toBeNull();
  });
  it("caches by title, and the cache clears when the types change", () => {
    expect(cachedTypeForTitle("[[EVD]] - x - @k")).toBe("Evidence");
    setNodeTypes([]);
    expect(cachedTypeForTitle("[[EVD]] - x - @k")).toBe("");
  });
});

describe("resolveBlockRefs", () => {
  it("replaces a reference with the referenced text", async () => {
    stubQ(() => [["abcd12345", "the referenced text"]]);
    expect(await resolveBlockRefs("as shown in ((abcd12345)) above")).toBe(
      "as shown in the referenced text above",
    );
  });

  it("leaves an unresolvable reference alone rather than blanking it", async () => {
    stubQ(() => []);
    expect(await resolveBlockRefs("as shown in ((abcd12345)) above")).toBe(
      "as shown in ((abcd12345)) above",
    );
  });

  it("does not query at all when there is nothing to resolve", async () => {
    const q = stubQ(() => []);
    expect(await resolveBlockRefs("plain content")).toBe("plain content");
    expect(q).not.toHaveBeenCalled();
  });

  /* One query for every reference, not one per reference. */
  it("resolves several references in a single query", async () => {
    const q = stubQ(() => [
      ["abcd12345", "first"],
      ["efgh67890", "second"],
    ]);
    expect(await resolveBlockRefs("((abcd12345)) then ((efgh67890))")).toBe("first then second");
    expect(q).toHaveBeenCalledTimes(1);
  });
});

describe("uid and title lookups", () => {
  it("finds a uid for a title, passing the title as an input", async () => {
    const q = stubQ(() => [[{ ":block/uid": "uid-1" }]]);
    expect(await uidForTitle("[[EVD]] - x - @k")).toBe("uid-1");
    expect(q.mock.calls[0]?.[1]).toBe("[[EVD]] - x - @k");
  });

  /* Interpolation used to need backslash escaping, because titles in these
   * graphs really do contain LaTeX and an unescaped backslash is an invalid
   * Clojure string escape that throws. Parameterizing removes the hazard. */
  it("needs no escaping for a title containing LaTeX and quotes", async () => {
    const q = stubQ(() => [[{ ":block/uid": "uid-2" }]]);
    const title = '[[EVD]] - $$\\frac{a}{b}$$ and a "quote" - @k';
    expect(await uidForTitle(title)).toBe("uid-2");
    expect(q.mock.calls[0]?.[1]).toBe(title);
    expect(String(q.mock.calls[0]?.[0])).not.toContain("frac");
  });

  it("returns empty when the page is gone", async () => {
    stubQ(() => []);
    expect(await uidForTitle("nothing")).toBe("");
  });

  it("finds a title for a uid", async () => {
    stubQ(() => [[{ ":node/title": "[[EVD]] - x - @k" }]]);
    expect(await titleForUid("uid-1")).toBe("[[EVD]] - x - @k");
  });

  it("builds a Roam URL from the graph in the location", async () => {
    stubQ(() => [[{ ":block/uid": "uid-1" }]]);
    window.history.replaceState({}, "", "/#/app/sandbox-dg/page/abc");
    expect(graphName()).toBe("sandbox-dg");
    expect(await roamUrlForTitle("x")).toBe(
      "https://roamresearch.com/#/app/sandbox-dg/page/uid-1",
    );
  });

  it("falls back to the bare label when there is no uid to link to", async () => {
    stubQ(() => []);
    expect(await roamUrlForTitle("x")).toBe("");
  });
});
