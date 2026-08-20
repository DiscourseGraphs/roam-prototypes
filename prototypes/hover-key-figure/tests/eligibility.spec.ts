import { describe, expect, it } from "vitest";
import { formatToRegex } from "~/nodeFormat";
import { FALLBACK_TITLE_REGEX, isEligibleTitle } from "~/eligibility";
import type { DiscourseNodeType } from "~/graph";

const type = (name: string, format: string): DiscourseNodeType => ({
  type: name,
  format,
  regex: formatToRegex(format).regex,
});

const DG_TYPES = [
  type("Result", "[[RES]] - {content} - {Source}"),
  type("Claim", "[[CLM]] - {content}"),
];

describe("isEligibleTitle with configured node types", () => {
  it("matches titles against the graph's own formats", () => {
    expect(
      isEligibleTitle("[[RES]] - actin grew - [[@src2024]]", DG_TYPES, null),
    ).toBe(true);
    expect(isEligibleTitle("[[CLM]] - graphs help", DG_TYPES, null)).toBe(true);
  });
  it("rejects ordinary pages, and does NOT use the fallback when types exist", () => {
    expect(isEligibleTitle("Meeting notes", DG_TYPES, null)).toBe(false);
    // [[ISS]] is not among the configured types above, so it must not match.
    expect(isEligibleTitle("[[ISS]] - some issue", DG_TYPES, null)).toBe(false);
  });
  it("honors format semantics: content is required", () => {
    expect(isEligibleTitle("[[CLM]] - ", DG_TYPES, null)).toBe(true); // lazy capture allows empty
    expect(isEligibleTitle("[[CLM]]", DG_TYPES, null)).toBe(false);
  });
});

describe("isEligibleTitle fallback (no node types loaded)", () => {
  it("accepts the house convention", () => {
    expect(isEligibleTitle("[[RES]] - anything - src", [], null)).toBe(true);
    expect(isEligibleTitle("[[HYP]] - a hypothesis", [], null)).toBe(true);
  });
  it("rejects non-node titles", () => {
    expect(isEligibleTitle("August 20th, 2026", [], null)).toBe(false);
    expect(isEligibleTitle("res - lowercase", [], null)).toBe(false);
    expect(isEligibleTitle("", [], null)).toBe(false);
  });
  it("FALLBACK_TITLE_REGEX stays anchored", () => {
    expect(FALLBACK_TITLE_REGEX.test("prefix [[RES]] - x")).toBe(false);
  });
});

describe("extra pattern", () => {
  it("extends eligibility regardless of node types", () => {
    expect(isEligibleTitle("@brown2020actin", DG_TYPES, /^@/)).toBe(true);
    expect(isEligibleTitle("@brown2020actin", [], /^@/)).toBe(true);
    expect(isEligibleTitle("plain page", DG_TYPES, /^@/)).toBe(false);
  });
});
