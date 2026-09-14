/* Pure text helpers: no DOM, no graph. */

const TODO_RE = /\{{2,3}\[?\[?TODO\]?\]?\}{2,3}/;
const CHECKBOX_RE = /\{{2,3}\[?\[?(TODO|DONE)\]?\]?\}{2,3}/g;

export const relTime = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  if (d < 365) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 365)}y ago`;
};

/* Roam markup is noise in a one-line inbox row. Strip it down to prose. */
export const prettify = (raw: string, myAddress: string | null): string => {
  let s = raw || "";
  s = s.replace(CHECKBOX_RE, "");
  // The hashtag form first, or its `#` is left behind.
  if (myAddress) s = s.split(`#[[${myAddress}]]`).join("").split(`[[${myAddress}]]`).join("");
  // Collapse block refs FIRST: a Roam alias whose target is a block ref
  // (`[label](((uid)))`) is three levels of parens, which no sane link regex
  // survives. Once it is `[label](⟨ref⟩)` the link strip is trivial.
  s = s.replace(/\(\([^()]{9,}\)\)/g, "⟨ref⟩");
  s = s.replace(/\[([^[\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1"); // markdown links
  // Nested page refs (`[[[[ART]] - x]]`) need repeated inside-out passes.
  for (let i = 0; i < 4; i++) s = s.replace(/#?\[\[([^[\]]*)\]\]/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  s = s.replace(/!\[\]\(\S+\)/g, "🖼");
  return s.replace(/\s+/g, " ").trim();
};

/* The checked-off form of a TODO block, or null when there is no TODO in it. */
export const toggleDone = (raw: string): string | null =>
  TODO_RE.test(raw) ? raw.replace(TODO_RE, "{{[[DONE]]}}") : null;
