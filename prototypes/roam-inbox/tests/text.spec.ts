import { describe, expect, it } from "vitest";
import { prettify, relTime, toggleDone } from "~/text";

const ME = "+Matt Akamatsu";

describe("prettify", () => {
  it("drops the checkbox and my own address", () => {
    expect(prettify("{{[[TODO]]}} [[+Matt Akamatsu]] can you read me?", ME)).toBe("can you read me?");
  });
  it("drops a hashtag form of my address too", () => {
    expect(prettify("#[[+Matt Akamatsu]] fyi", ME)).toBe("fyi");
  });
  it("flattens nested page refs inside out", () => {
    expect(prettify("see [[[[ART]] - the figure]]", null)).toBe("see ART - the figure");
  });
  /* A Roam alias whose target is a block ref is three levels of parens. */
  it("collapses a block-ref alias to its label", () => {
    expect(prettify("as in [the paper](((abcdefghi))) here", null)).toBe("as in the paper here");
  });
  it("collapses a bare block ref", () => {
    expect(prettify("see ((abcdefghi))", null)).toBe("see ⟨ref⟩");
  });
  it("strips bold and marks images", () => {
    expect(prettify("**bold** and __also__ ![](https://x/y.png)", null)).toBe("bold and also 🖼");
  });
  it("collapses whitespace", () => {
    expect(prettify("  a   b \n c ", null)).toBe("a b c");
  });
});

describe("toggleDone", () => {
  it("checks off a TODO", () => {
    expect(toggleDone("{{[[TODO]]}} [[+A]] x")).toBe("{{[[DONE]]}} [[+A]] x");
  });
  it("accepts the short checkbox form", () => {
    expect(toggleDone("{{TODO}} x")).toBe("{{[[DONE]]}} x");
  });
  it("returns null when there is nothing to check off", () => {
    expect(toggleDone("[[+A]] x")).toBeNull();
    expect(toggleDone("{{[[DONE]]}} x")).toBeNull();
  });
});

describe("relTime", () => {
  const now = Date.now();
  it.each([
    [now - 5 * 1000, "just now"],
    [now - 5 * 60 * 1000, "5m ago"],
    [now - 3 * 3600 * 1000, "3h ago"],
    [now - 2 * 86400 * 1000, "2d ago"],
    [now - 20 * 86400 * 1000, "2w ago"],
    [now - 800 * 86400 * 1000, "2y ago"],
  ])("formats %d as %s", (ms, expected) => {
    expect(relTime(ms)).toBe(expected);
  });
});
