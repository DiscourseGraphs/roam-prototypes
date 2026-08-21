/* Roam markup to LaTeX. Pure: nothing here touches the graph or the DOM.
 *
 * The governing constraint for every function in this file is that nothing
 * emitted may fail to compile. That is why escaping is exhaustive rather than
 * minimal, and why an unusable citekey degrades to prose plus a warning
 * instead of an empty or malformed \autocite.
 */

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export const escapeLatex = (s: string): string =>
  s ? s.replace(/[\\&%$#_{}~^]/g, (c) => LATEX_ESCAPES[c] as string) : "";

/* One pass over every delimiter type: math, tags, links, spans.
 *
 * A single alternation rather than sequential passes, because slicing on
 * `**` or `__` first would cut `^^…^^`, `[[…]]`, and `#[[…]]` pairs in half.
 * Recursing on captured inner text is what makes nesting work. */
export const roamToLatex = (input: string): string => {
  if (!input) return "";
  const out: string[] = [];
  const re =
    /\$\$([\s\S]+?)\$\$|#\[\[([^\]]*)\]\]|#([\w.-]+)|\[\[([^\]]*)\]\]|\^\^([\s\S]*?)\^\^|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(escapeLatex(input.slice(last, m.index)));
    if (m[1] !== undefined) {
      /* Per character, not /(^|[^\\])%/g: that pattern consumes the character
       * it is guarding with, so the second % of a `%%` pair escapes nothing. */
      out.push(
        `$${m[1].replace(/%/g, (c, i: number, str: string) =>
          str[i - 1] === "\\" ? c : "\\%",
        )}$`,
      );
    } else if (m[2] !== undefined) {
      // bracketed tag — removed entirely
    } else if (m[3] !== undefined) {
      // bare tag — removed entirely
    } else if (m[4] !== undefined) {
      out.push(roamToLatex(m[4]));
    } else if (m[5] !== undefined) {
      out.push(roamToLatex(m[5]));
    } else if (m[6] !== undefined) {
      out.push(`\\textbf{${roamToLatex(m[6])}}`);
    } else if (m[7] !== undefined) {
      out.push(`\\textit{${roamToLatex(m[7])}}`);
    }
    last = re.lastIndex;
  }
  out.push(escapeLatex(input.slice(last)));
  return out.join("");
};

/* A usable citekey has no whitespace and no slash. That rejects the internal
 * `@analysis/...` source pages, which is the point: they are real Roam pages
 * but not bibliography entries. */
const CITEKEY = /^[A-Za-z0-9][A-Za-z0-9_:.+-]*$/;

export const toCitekey = (source: string): string => {
  const bare = (source || "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/^@/, "")
    .trim();
  return CITEKEY.test(bare) ? bare : "";
};

export type LatexPayload = { latex: string; warning?: string };

export const assembleLatex = (
  content: string,
  source: string,
  title: string,
): LatexPayload => {
  // /\.+\s*$/ not /\.\s*$/: content ending in an ellipsis would otherwise
  // keep two of its three dots and read as a typo before the citation.
  const body = roamToLatex(content).replace(/\.+\s*$/, "");
  // Content already ending in terminal punctuation gets no added period —
  // "Why does it pinch?." reads as a mistake, not a sentence.
  const period = /[?!]$/.test(body) ? "" : ".";
  const key = toCitekey(source);
  /* A space before \autocite. Parenthetical and inline biblatex styles want
   * one ("...beyond Roam [12]."); footnote and superscript styles arguably do
   * not, since the marker should hug the word. If the manuscript's style is
   * footnote-based, this is the line to change. */
  if (key) return { latex: `${body} \\autocite{${key}}${period}` };
  return {
    latex: `${body}${period}`,
    warning: `No citekey on "${title}" — copied without a citation.`,
  };
};

/* A markdown link label cannot contain `[[…]]`: the brackets terminate the
 * label early and the rest of the title leaks out beside a broken link. */
export const unwrapLinks = (s: string): string =>
  (s || "").replace(/\[\[([^\]]*)\]\]/g, "$1");
