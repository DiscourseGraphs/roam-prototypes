/* Roam markup to LaTeX.
 *
 * These are the rules that keep a pasted sentence from corrupting a document.
 * The percent case is the one that motivated the table: it fails silently,
 * swallowing the rest of the line into a LaTeX comment.
 */
import { describe, expect, it } from "vitest";
import { assembleLatex, roamToLatex, toCitekey, unwrapLinks } from "~/latex";

describe("roamToLatex", () => {
  const cases: [string, string, string][] = [
    [
      "escapes percent, so the rest of the sentence is not commented out",
      "50% of cells showed budding",
      "50\\% of cells showed budding",
    ],
    [
      "escapes the other specials",
      "a & b _ c # d $ e { f } g",
      "a \\& b \\_ c \\# d \\$ e \\{ f \\} g",
    ],
    [
      "escapes backslash, tilde and caret with text commands",
      "a \\ b ~ c ^ d",
      "a \\textbackslash{} b \\textasciitilde{} c \\textasciicircum{} d",
    ],
    [
      "converts Roam inline math to LaTeX inline math",
      "curvature $$H = 1/R$$ at the neck",
      "curvature $H = 1/R$ at the neck",
    ],
    ["does not escape inside math", "$$50\\% \\frac{a}{b}$$", "$50\\% \\frac{a}{b}$"],
    [
      "a bare percent inside math is escaped, so it cannot comment out the line",
      "yield $$50% \\alpha$$ measured",
      "yield $50\\% \\alpha$ measured",
    ],
    [
      "every percent in a run inside math is escaped, not just the first",
      "$$50%% off$$",
      "$50\\%\\% off$",
    ],
    ["escaping resumes after math", "$$x^2$$ covers 50% of cases", "$x^2$ covers 50\\% of cases"],
    ["bold becomes textbf", "a **bold** b", "a \\textbf{bold} b"],
    ["double underscore is italics, not an escape", "a __italic__ b", "a \\textit{italic} b"],
    ["escapes inside a formatting span", "**50% yield**", "\\textbf{50\\% yield}"],
    ["highlight markers are dropped, text kept", "a ^^highlighted^^ b", "a highlighted b"],
    [
      "page links are unwrapped to their text",
      "observed in [[budding yeast]] cells",
      "observed in budding yeast cells",
    ],
    ["bare tags are removed", "a finding #evd-candidate", "a finding "],
    [
      "bracketed tags are removed whole, not unwrapped",
      "a finding #[[needs review]] here",
      "a finding  here",
    ],
    [
      "highlight markers drop even with bold nested inside",
      "^^highlighted **bold** text^^",
      "highlighted \\textbf{bold} text",
    ],
    [
      "page links unwrap even with bold nested inside",
      "observed in [[budding **yeast**]] cells",
      "observed in budding \\textbf{yeast} cells",
    ],
    [
      "a bracketed tag is removed whole even with bold nested inside",
      "a finding #[[needs **review**]] here",
      "a finding  here",
    ],
    [
      "a degenerate empty math span escapes rather than opening display math",
      "$$$$",
      "\\$\\$\\$\\$",
    ],
    ["empty input stays empty", "", ""],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(roamToLatex(input)).toBe(expected);
  });
});

describe("toCitekey", () => {
  it("passes a Better BibTeX key straight through", () => {
    expect(toCitekey("@vasan2020mechanical")).toBe("vasan2020mechanical");
  });
  it("unwraps a bracketed source", () => {
    expect(toCitekey("[[@vasan2020mechanical]]")).toBe("vasan2020mechanical");
  });
  it("rejects an internal analysis page, which is a page but not a bibliography entry", () => {
    expect(toCitekey("@analysis/quantify issue claiming")).toBe("");
  });
  it("rejects anything with whitespace", () => {
    expect(toCitekey("@two words")).toBe("");
  });
  it("rejects an empty source", () => {
    expect(toCitekey("")).toBe("");
  });
});

describe("assembleLatex", () => {
  const title = "[[EVD]] - x - @k";
  it("puts the citation before the period, with a space", () => {
    expect(assembleLatex("The tube pinched", "@vasan2020mechanical", title).latex).toBe(
      "The tube pinched \\autocite{vasan2020mechanical}.",
    );
  });
  it("strips a trailing period rather than doubling it", () => {
    expect(assembleLatex("The tube pinched.", "@k", title).latex).toBe(
      "The tube pinched \\autocite{k}.",
    );
  });
  it("strips a whole ellipsis, not one dot of it", () => {
    expect(assembleLatex("It went on...", "@k", title).latex).toBe(
      "It went on \\autocite{k}.",
    );
  });
  it("leaves a question mark alone instead of appending a period", () => {
    expect(assembleLatex("Why does it pinch?", "@k", title).latex).toBe(
      "Why does it pinch? \\autocite{k}",
    );
  });
  it("copies without a citation, and warns, when the source is unusable", () => {
    const out = assembleLatex("A finding", "@analysis/thing", title);
    expect(out.latex).toBe("A finding.");
    expect(out.warning).toContain("No citekey");
  });
  it("still escapes the body when there is no citekey", () => {
    expect(assembleLatex("50% yield", "", title).latex).toBe("50\\% yield.");
  });
});

describe("unwrapLinks", () => {
  it("removes the brackets that would terminate a markdown label early", () => {
    expect(unwrapLinks("[[EVD]] - a finding")).toBe("EVD - a finding");
  });
});
