/* Key-figure resolution. Pure core — all graph reads arrive through the
 * injected KeyFigureIO, so every branch is unit-testable without Roam.
 *
 * Resolution order (SPEC.md "Key-figure resolution"):
 *
 *   1. Manual key image — the page's Roam props, where ENG-2123 decided
 *      manual key images will live (`discourse-graph` → `keyImage`). Not
 *      shipped in the plugin yet, but reading its future home costs one pull
 *      and makes this prototype agree with the decided storage direction.
 *   2. Automatic — a port of `findFirstImage` from the plugin's
 *      calcCanvasNodeSizeAndImg.ts, preserving the cases naive "first image"
 *      implementations miss: images referenced via `((block refs))`, images
 *      inside `{{[[embed]]: ((uid))}}` trees (ENG-485; also the failure mode
 *      of the AICS evidence import), and a cycle guard.
 *
 * Per-block priority, matching the plugin: own text → blocks referenced from
 * own text → embedded trees → children in document order.
 */

export type BlockNode = {
  uid: string;
  string: string;
  children: BlockNode[];
};

export type KeyFigureIO = {
  /* Full block tree for a page or block uid, children in document order. */
  fetchTree: (uid: string) => Promise<BlockNode | null>;
  /* Block strings for a batch of uids, in one query. */
  fetchStrings: (uids: string[]) => Promise<Map<string, string>>;
  /* ENG-2123's manual key image from the page's props, or "". */
  fetchManualKeyImage: (uid: string) => Promise<string>;
};

export type KeyFigure = { url: string; source: "manual" | "auto" };

/* Markdown image with an absolute URL. The plugin's regex accepts https only;
 * http is tolerated here because test graphs serve fixtures over it. */
export const IMAGE_REGEX = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/;

export const BLOCK_REF_REGEX = /\(\(([\w\d_-]{9,})\)\)/g;

/* The plugin's EMBED_REGEX (calcCanvasNodeSizeAndImg.ts), case-insensitive,
 * tolerating extra parens around the uid. */
export const EMBED_REGEX =
  /\{\{\[\[(?:embed|embed-path|embed-children)\]\]:\s*\(\(+([^)\s]+?)\)+\s*\}\}/gi;

export const extractImageUrl = (text: string): string =>
  (text || "").match(IMAGE_REGEX)?.[1] ?? "";

const embedUidsIn = (text: string): string[] =>
  [...(text || "").matchAll(EMBED_REGEX)].map((m) => m[1] as string);

const refUidsIn = (text: string): string[] =>
  [...(text || "").matchAll(BLOCK_REF_REGEX)].map((m) => m[1] as string);

const findFirstImage = async (
  node: BlockNode | null,
  io: KeyFigureIO,
  visited: Set<string>,
): Promise<string> => {
  if (!node || (node.uid && visited.has(node.uid))) return "";
  if (node.uid) visited.add(node.uid);
  const text = node.string || "";

  // 1. The block's own text.
  const direct = extractImageUrl(text);
  if (direct) return direct;

  // 2. Blocks referenced from the text — but not the uids that belong to
  //    embed syntax: those must recurse as whole trees in step 3, and marking
  //    them visited here would silently skip that recursion.
  const embeds = embedUidsIn(text);
  const embedSet = new Set(embeds);
  const refs = refUidsIn(text).filter((u) => !embedSet.has(u) && !visited.has(u));
  if (refs.length) {
    const strings = await io.fetchStrings(refs);
    for (const u of refs) {
      visited.add(u);
      const img = extractImageUrl(strings.get(u) || "");
      if (img) return img;
    }
  }

  // 3. Embedded trees, recursively.
  for (const u of embeds) {
    if (visited.has(u)) continue;
    const tree = await io.fetchTree(u);
    const img = await findFirstImage(tree, io, visited);
    if (img) return img;
  }

  // 4. Children, depth-first, in document order.
  for (const child of node.children || []) {
    const img = await findFirstImage(child, io, visited);
    if (img) return img;
  }
  return "";
};

export const resolveKeyFigure = async (
  pageUid: string,
  io: KeyFigureIO,
): Promise<KeyFigure | null> => {
  const manual = await io.fetchManualKeyImage(pageUid).catch(() => "");
  if (manual) return { url: manual, source: "manual" };
  const tree = await io.fetchTree(pageUid);
  const url = await findFirstImage(tree, io, new Set<string>());
  return url ? { url, source: "auto" } : null;
};

/* Manual-key-image extraction from a pulled props object. Lenient on
 * purpose: props written as strings read back as keywords and vice versa
 * (the string-write/keyword-read trap), key casing varies by writer, and the
 * value may be a bare URL or a markdown image. Accepts any key whose
 * normalized form ends in "keyimage", at any nesting depth.
 */
export const manualKeyImageFromProps = (props: unknown): string => {
  const normalize = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const urlFrom = (v: unknown): string => {
    if (typeof v !== "string") return "";
    const fromMarkdown = extractImageUrl(v);
    if (fromMarkdown) return fromMarkdown;
    return /^https?:\/\/\S+$/.test(v.trim()) ? v.trim() : "";
  };
  const walk = (value: unknown, keyHit: boolean): string => {
    if (value === null || typeof value !== "object") {
      return keyHit ? urlFrom(value) : "";
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = keyHit || normalize(k).endsWith("keyimage");
      const found = walk(v, hit);
      if (found) return found;
    }
    return "";
  };
  return walk(props, false);
};
