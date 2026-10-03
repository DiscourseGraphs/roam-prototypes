// Playwright's selector syntax, as far as kits use it, for running inside the
// page: CSS with :has-text("…"), :text("…") and :visible, parts chained with
// >>, and >> nth=N. Text matches the way Playwright's do: case-insensitive,
// whitespace collapsed, a substring.

type Filter =
  | { kind: "has-text"; text: string }
  | { kind: "text"; text: string }
  | { kind: "visible" };

type Compound = { combinator: " " | ">" | "+" | "~"; css: string; filters: Filter[] };

type Part =
  | { kind: "css"; compounds: Compound[] }
  | { kind: "nth"; index: number }
  | { kind: "text"; text: string };

const normalize = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const NO_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);
const NO_TEXT_SELECTOR = "script, style, noscript, template";

// Text the way Playwright reads it: script and style contents don't count.
const rawText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE || NO_TEXT.has((node as Element).tagName)) return "";
  let text = "";
  for (const child of Array.from(node.childNodes)) text += rawText(child);
  return text;
};

export const elementText = (element: Element): string => {
  if (NO_TEXT.has(element.tagName)) return "";
  if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
    return normalize(element.value);
  }
  return normalize(element.querySelector(NO_TEXT_SELECTOR) ? rawText(element) : (element.textContent ?? ""));
};

// Visible the way Playwright means it: a non-empty box and not
// visibility:hidden.
export const isVisible = (element: Element): boolean => {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  return getComputedStyle(element).visibility !== "hidden";
};

// Splits at a separator found outside quotes, brackets and parentheses.
const splitTop = (input: string, isSeparator: (rest: string) => number): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0) {
      const length = isSeparator(input.slice(index));
      if (length > 0) {
        parts.push(input.slice(start, index));
        index += length - 1;
        start = index + 1;
      }
    }
  }
  parts.push(input.slice(start));
  return parts;
};

const unquoteArg = (raw: string): string => {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
};

const PSEUDO =
  /:(has-text|text|visible)(?![\w-])(?:\(((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)])*)\))?/g;

const parseCompound = (raw: string, combinator: Compound["combinator"]): Compound => {
  const filters: Filter[] = [];
  const css = raw
    .replace(PSEUDO, (_match, name: string, arg: string | undefined) => {
      if (name === "visible") filters.push({ kind: "visible" });
      else filters.push({ kind: name as "has-text" | "text", text: normalize(unquoteArg(arg ?? "")) });
      return "";
    })
    .trim();
  return { combinator, css: css || "*", filters };
};

// "a b > c" → compounds, each with the combinator that leads into it.
const parseCss = (raw: string): Compound[] => {
  const compounds: Compound[] = [];
  let combinator: Compound["combinator"] = " ";
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  const flush = (): void => {
    if (!current) return;
    compounds.push(parseCompound(current, compounds.length === 0 ? " " : combinator));
    current = "";
    combinator = " ";
  };
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      current += char;
      if (char === "\\") current += raw[++index] ?? "";
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(char)) {
      flush();
      if (char !== " " && !/\s/.test(char)) combinator = char as Compound["combinator"];
      continue;
    }
    current += char;
  }
  flush();
  return compounds;
};

export const parseSelector = (selector: string): Part[] =>
  splitTop(selector, (rest) => (/^\s*>>\s*/.exec(rest)?.[0].length ?? 0)).map(
    (raw): Part => {
      const part = raw.trim();
      const nth = /^nth=(-?\d+)$/.exec(part);
      if (nth) return { kind: "nth", index: Number(nth[1]) };
      if (part.startsWith("text=")) return { kind: "text", text: normalize(unquoteArg(part.slice(5))) };
      if (part.startsWith("css=")) return { kind: "css", compounds: parseCss(part.slice(4)) };
      return { kind: "css", compounds: parseCss(part) };
    },
  );

const passes = (element: Element, filters: Filter[]): boolean =>
  filters.every((filter) => {
    if (filter.kind === "visible") return isVisible(element);
    const text = elementText(element);
    if (!text.includes(filter.text)) return false;
    if (filter.kind === "has-text") return true;
    // :text() is the smallest element holding the text.
    return !Array.from(element.children).some((child) =>
      elementText(child).includes(filter.text),
    );
  });

const inOrder = (elements: Iterable<Element>): Element[] =>
  Array.from(new Set(elements)).sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

const scopeAll = (root: ParentNode, css: string): Element[] =>
  Array.from(root.querySelectorAll(css));

const advance = (current: Element[] | null, root: ParentNode, compound: Compound): Element[] => {
  const matches = (element: Element): boolean =>
    element.matches(compound.css) && passes(element, compound.filters);
  if (current === null) return scopeAll(root, compound.css).filter((el) => passes(el, compound.filters));
  const found: Element[] = [];
  for (const element of current) {
    if (compound.combinator === " ") {
      found.push(...scopeAll(element, compound.css).filter((el) => passes(el, compound.filters)));
    } else if (compound.combinator === ">") {
      found.push(...Array.from(element.children).filter(matches));
    } else if (compound.combinator === "+") {
      const next = element.nextElementSibling;
      if (next && matches(next)) found.push(next);
    } else {
      let next = element.nextElementSibling;
      while (next) {
        if (matches(next)) found.push(next);
        next = next.nextElementSibling;
      }
    }
  }
  return inOrder(found);
};

const cssPart = (roots: ParentNode[], compounds: Compound[]): Element[] => {
  const plain = compounds.every((compound) => compound.filters.length === 0);
  const found: Element[] = [];
  for (const root of roots) {
    if (plain) {
      const css = compounds
        .map((compound, index) =>
          index === 0 ? compound.css : `${compound.combinator === " " ? " " : ` ${compound.combinator} `}${compound.css}`,
        )
        .join("");
      found.push(...scopeAll(root, css));
      continue;
    }
    let current: Element[] | null = null;
    for (const compound of compounds) current = advance(current, root, compound);
    found.push(...(current ?? []));
  }
  return inOrder(found);
};

const textPart = (roots: ParentNode[], text: string): Element[] =>
  inOrder(
    roots.flatMap((root) =>
      scopeAll(root, "*").filter((element) =>
        passes(element, [{ kind: "text", text }]),
      ),
    ),
  );

// Every element the selector matches, in document order.
export const queryAll = (selector: string, root: ParentNode = document): Element[] => {
  let roots: ParentNode[] = [root];
  let found: Element[] = [];
  for (const part of parseSelector(selector)) {
    if (part.kind === "nth") {
      const index = part.index < 0 ? found.length + part.index : part.index;
      found = found[index] ? [found[index]] : [];
    } else if (part.kind === "text") {
      found = textPart(roots, part.text);
    } else {
      found = cssPart(roots, part.compounds);
    }
    roots = found;
  }
  return found;
};

export const query = (selector: string, root: ParentNode = document): Element | null =>
  queryAll(selector, root)[0] ?? null;
