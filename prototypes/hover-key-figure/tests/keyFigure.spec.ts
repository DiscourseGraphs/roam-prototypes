import { describe, expect, it, vi } from "vitest";
import {
  extractImageUrl,
  manualKeyImageFromProps,
  resolveKeyFigure,
  type BlockNode,
  type KeyFigureIO,
} from "~/keyFigure";

const URL_A = "https://example.com/a.png";
const URL_B = "https://example.com/b.png";

const node = (
  uid: string,
  string: string,
  children: BlockNode[] = [],
): BlockNode => ({ uid, string, children });

const ioFor = (
  trees: Record<string, BlockNode>,
  strings: Record<string, string> = {},
  manual = "",
): KeyFigureIO => ({
  fetchTree: vi.fn(async (uid: string) => trees[uid] ?? null),
  fetchStrings: vi.fn(
    async (uids: string[]) =>
      new Map(uids.map((u) => [u, strings[u] ?? ""] as const)),
  ),
  fetchManualKeyImage: vi.fn(async () => manual),
});

describe("extractImageUrl", () => {
  it("matches markdown images with and without alt text", () => {
    expect(extractImageUrl(`before ![](${URL_A}) after`)).toBe(URL_A);
    expect(extractImageUrl(`![the plot](${URL_A})`)).toBe(URL_A);
  });
  it("ignores plain links and empty text", () => {
    expect(extractImageUrl(`[link](${URL_A})`)).toBe("");
    expect(extractImageUrl("")).toBe("");
  });
});

describe("resolveKeyFigure — automatic resolution", () => {
  it("finds a direct image in a child block, in document order", async () => {
    const io = ioFor({
      page: node("page", "The Page Title", [
        node("b1", "no image here"),
        node("b2", `![](${URL_A})`),
        node("b3", `![](${URL_B})`),
      ]),
    });
    await expect(resolveKeyFigure("page", io)).resolves.toEqual({
      url: URL_A,
      source: "auto",
    });
  });

  it("prefers a block's own text over its children", async () => {
    const io = ioFor({
      page: node("page", "T", [
        node("b1", `own ![](${URL_A})`, [node("b1c", `![](${URL_B})`)]),
      ]),
    });
    await expect(resolveKeyFigure("page", io)).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it("finds an image through a ((block ref)) in the text", async () => {
    const io = ioFor(
      { page: node("page", "T", [node("b1", "see ((refblock01))")]) },
      { refblock01: `![](${URL_A})` },
    );
    await expect(resolveKeyFigure("page", io)).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it("recurses into {{[[embed]]: ((uid))}} trees", async () => {
    const io = ioFor({
      page: node("page", "T", [
        node("b1", "{{[[embed]]: ((embedroot1))}}"),
      ]),
      // The image is in the embedded block's CHILD — only tree recursion,
      // not a string lookup of the embed uid, can find it.
      embedroot1: node("embedroot1", "no image", [
        node("e1", `![](${URL_A})`),
      ]),
    });
    await expect(resolveKeyFigure("page", io)).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it("does not let the block-ref scan swallow the embed recursion", async () => {
    // `((embedroot1))` inside embed syntax also matches the block-ref regex.
    // If the ref scan marks that uid visited, the embed recursion is
    // silently skipped and the image is never found.
    const io = ioFor(
      { page: node("page", "T", [node("b1", "{{[[embed-children]]: ((embedroot1))}}")]),
        embedroot1: node("embedroot1", "", [node("e1", `![](${URL_A})`)]) },
      { embedroot1: "" },
    );
    await expect(resolveKeyFigure("page", io)).resolves.toMatchObject({
      url: URL_A,
    });
  });

  it("survives embed cycles", async () => {
    const io = ioFor({
      page: node("page", "T", [node("b1", "{{[[embed]]: ((loopy0001))}}")]),
      loopy0001: node("loopy0001", "{{[[embed]]: ((loopy0001))}}"),
    });
    await expect(resolveKeyFigure("page", io)).resolves.toBeNull();
  });

  it("returns null when the page has no image anywhere", async () => {
    const io = ioFor({
      page: node("page", "T", [node("b1", "words", [node("b1c", "more words")])]),
    });
    await expect(resolveKeyFigure("page", io)).resolves.toBeNull();
  });
});

describe("resolveKeyFigure — manual precedence (ENG-2123 forward-compat)", () => {
  it("uses the manual key image and never reads the tree", async () => {
    const io = ioFor(
      { page: node("page", "T", [node("b1", `![](${URL_B})`)]) },
      {},
      URL_A,
    );
    await expect(resolveKeyFigure("page", io)).resolves.toEqual({
      url: URL_A,
      source: "manual",
    });
    expect(io.fetchTree).not.toHaveBeenCalled();
  });

  it("falls back to automatic when the manual read throws", async () => {
    const io = ioFor({ page: node("page", "T", [node("b1", `![](${URL_B})`)]) });
    (io.fetchManualKeyImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no props API"),
    );
    await expect(resolveKeyFigure("page", io)).resolves.toMatchObject({
      url: URL_B,
      source: "auto",
    });
  });
});

describe("manualKeyImageFromProps", () => {
  it("reads the ENG-2123 shape: { discourse-graph: { keyImage } }", () => {
    expect(
      manualKeyImageFromProps({ "discourse-graph": { keyImage: URL_A } }),
    ).toBe(URL_A);
  });
  it("tolerates keyword-style namespaced keys", () => {
    expect(
      manualKeyImageFromProps({ ":discourse-graph/keyImage": URL_A }),
    ).toBe(URL_A);
  });
  it("accepts a markdown-image value", () => {
    expect(
      manualKeyImageFromProps({ "discourse-graph": { "key-image": `![](${URL_A})` } }),
    ).toBe(URL_A);
  });
  it("rejects non-URL strings and unrelated keys", () => {
    expect(manualKeyImageFromProps({ "discourse-graph": { keyImage: "soon" } })).toBe("");
    expect(manualKeyImageFromProps({ other: URL_A })).toBe("");
    expect(manualKeyImageFromProps(null)).toBe("");
  });
});
