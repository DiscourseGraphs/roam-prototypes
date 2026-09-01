import { describe, expect, it } from "vitest";
import { formatToRegex, parseNodeTitle } from "~/nodeFormat";

const EVD = "[[EVD]] - {content} - {Source}";
const QUE = "[[QUE]] - {content}";

describe("parseNodeTitle", () => {
  it("splits content and source", () => {
    expect(
      parseNodeTitle(
        "[[EVD]] - Uniform constriction forces led to pinched deformation - @vasan2020mechanical",
        EVD,
      ),
    ).toEqual({
      content: "Uniform constriction forces led to pinched deformation",
      source: "@vasan2020mechanical",
    });
  });

  it("leaves source empty for a format without a source slot", () => {
    expect(parseNodeTitle("[[QUE]] - How isotropic is membrane curvature in 3D?", QUE)).toEqual({
      content: "How isotropic is membrane curvature in 3D?",
      source: "",
    });
  });

  it("yields nothing for a title that does not match", () => {
    expect(parseNodeTitle("Some ordinary page", EVD)).toEqual({ content: "", source: "" });
  });

  it("has no format to match against when the format is empty", () => {
    expect(parseNodeTitle("anything", "")).toEqual({ content: "", source: "" });
  });
});

describe("formatToRegex", () => {
  /* Mirrors the plugin's own expression builder. Agreeing with the plugin
   * about where content ends matters more than being cleverer than it. */
  it("escapes only the five characters the plugin escapes", () => {
    const { regex } = formatToRegex("[[EVD]] - {content}");
    expect(regex.test("[[EVD]] - anything at all")).toBe(true);
  });

  it("captures lazily, so the last separator wins the source slot", () => {
    expect(parseNodeTitle("[[EVD]] - A finding - with an aside - @key2020", EVD)).toEqual({
      content: "A finding",
      source: "with an aside - @key2020",
    });
  });

  it("matches across newlines", () => {
    expect(parseNodeTitle("[[QUE]] - two\nlines", QUE).content).toBe("two\nlines");
  });

  it("names placeholders case-insensitively, so {Source} fills source", () => {
    expect(formatToRegex(EVD).names).toEqual(["content", "source"]);
  });
});
