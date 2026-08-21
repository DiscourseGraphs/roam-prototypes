/* Every read of the graph. All async: this repository forbids the legacy
 * synchronous `roamAlphaAPI.q` / `roamAlphaAPI.pull` aliases, so the panel
 * renders from a pre-loaded Snapshot instead of pulling during render (the
 * one structural change from the roam/js prototype). Datalog inputs are
 * parameterized through `:in`, never interpolated.
 */

import {
  matchNodeType,
  optionsFromSmartblockResults,
  parseInline,
  parsePropertiesTree,
  registryFromTree,
  slotOrderFromTemplate,
} from "~/core";
import { CONFIG, EXCLUDE_USER_PATTERNS } from "~/config";
import type {
  NodeType,
  ParsedProps,
  PickerOption,
  Registry,
  RegistryEntry,
  Tree,
} from "~/types";

const api = () => (window as any).roamAlphaAPI;

const q = (query: string, ...params: unknown[]): Promise<any[][]> =>
  api().data.async.q(query, ...params);

const pull = (pattern: string, eid: unknown): Promise<any> =>
  api().data.async.pull(pattern, eid);

/* Pull results come back with namespaced keys (":node/title") from some API
 * surfaces and bare ones ("title") from others. Tolerate both. */
const pick = <T = unknown>(obj: unknown, attr: string): T | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, T>;
  const bare = attr.slice(attr.indexOf("/") + 1);
  return rec[`:${attr}`] ?? rec[attr] ?? rec[bare];
};

const BLOCK_PULL = "[:block/uid :block/string :block/order {:block/children ...}]";

const normalizeTree = (raw: unknown): Tree | null => {
  if (!raw) return null;
  const str = pick<string>(raw, "block/string");
  return {
    uid: pick<string>(raw, "block/uid") || pick<string>(raw, "node/title") || "",
    string: str != null ? str : pick<string>(raw, "node/title") || "",
    children: (pick<unknown[]>(raw, "block/children") || [])
      .slice()
      .sort(
        (a, b) => (pick<number>(a, "block/order") || 0) - (pick<number>(b, "block/order") || 0),
      )
      .map(normalizeTree) as Tree[],
  };
};

export const pullTreeByUid = async (uid: string): Promise<Tree | null> =>
  normalizeTree(await pull(BLOCK_PULL, [":block/uid", uid]));

export const pullTreeByTitle = async (title: string): Promise<Tree | null> =>
  normalizeTree(await pull(`[:node/title ${BLOCK_PULL.slice(1)}`, [":node/title", title]));

export const pageUidByTitle = async (title: string): Promise<string | null> =>
  pick<string>(
    (
      await q(`[:find (pull ?p [:block/uid]) :in $ ?t :where [?p :node/title ?t]]`, title)
    )?.[0]?.[0],
    "block/uid",
  ) || null;

export const pageTitleByUid = async (uid: string): Promise<string | null> =>
  pick<string>(
    (
      await q(`[:find (pull ?p [:node/title]) :in $ ?u :where [?p :block/uid ?u]]`, uid)
    )?.[0]?.[0],
    "node/title",
  ) || null;

/* One query for every referenced block, not one per reference. Dangling
 * uids simply don't appear in the result. */
export const blockTextsByUids = async (
  uids: string[],
): Promise<Record<string, string>> => {
  if (!uids.length) return {};
  const rows = await q(
    `[:find ?u ?s :in $ [?u ...] :where [?b :block/uid ?u] [?b :block/string ?s]]`,
    uids,
  );
  return Object.fromEntries((rows || []).map(([u, s]) => [u as string, s as string]));
};

// ------------------------------------------------------------ registries

let registryCache: Registry | null = null;
export const loadRegistry = async (): Promise<Registry> => {
  if (registryCache) return registryCache;
  const tree = await pullTreeByTitle(CONFIG.registryPage);
  registryCache = tree ? registryFromTree(tree) : {};
  return registryCache;
};

let nodeTypesCache: NodeType[] | null = null;
export const loadNodeTypes = async (): Promise<NodeType[]> => {
  if (nodeTypesCache) return nodeTypesCache;
  // Legacy block-tree config: discourse-graph/nodes/{Type} page with a
  // `Format` (or `Format::`) child. Tolerates both shapes; skips pages
  // that declare neither.
  const rows =
    (await q(
      `[:find ?t ?u :in $ ?prefix :where [?p :node/title ?t]
        [(clojure.string/starts-with? ?t ?prefix)]
        [?p :block/uid ?u]]`,
      CONFIG.nodeTypePrefix,
    )) || [];
  const types: NodeType[] = [];
  for (const [title, uid] of rows) {
    const tree = await pullTreeByUid(uid as string);
    if (!tree) continue;
    let format: string | null = null;
    let templateUid: string | null = null;
    for (const c of tree.children || []) {
      const s = (c.string || "").trim();
      const fm = /^Format(?:::)?\s*(.*)$/s.exec(s);
      if (fm && !format) {
        format = fm[1].trim() || ((c.children || [])[0] || ({} as Tree)).string || null;
        if (format) format = format.trim();
      }
      if (/^Template\b/.test(s)) templateUid = c.uid;
    }
    if (format)
      types.push({
        name: (title as string).slice(CONFIG.nodeTypePrefix.length),
        format,
        templateUid,
      });
  }
  nodeTypesCache = types;
  return types;
};

export const findPropertiesBlock = (
  pageTree: Tree | { children: Tree[] },
): { block: Tree | null; duplicates: number } => {
  const hits: Tree[] = [];
  for (const c of pageTree.children || []) {
    const s = c.string || "";
    if (
      s.includes(`#${CONFIG.propertiesTag}`) ||
      s.includes(`#[[${CONFIG.propertiesTag}]]`)
    )
      hits.push(c);
  }
  return { block: hits[0] || null, duplicates: hits.length - 1 };
};

export const templateOrderForType = async (type: NodeType | null): Promise<string[]> => {
  if (!type || !type.templateUid) return [];
  const tree = await pullTreeByUid(type.templateUid);
  if (!tree) return [];
  const stack = [tree];
  while (stack.length) {
    const n = stack.shift()!;
    if (
      (n.string || "").includes(`#${CONFIG.propertiesTag}`) ||
      (n.string || "").includes(`#[[${CONFIG.propertiesTag}]]`)
    )
      return slotOrderFromTemplate(n);
    for (const c of n.children || []) stack.push(c);
  }
  return [];
};

export const listGraphMembers = async (): Promise<string[]> => {
  const rows =
    (await q(
      "[:find ?name :where [?u :user/display-page ?p] [?p :node/title ?name]]",
    )) || [];
  return rows
    .map((r) => r[0] as string)
    .filter((n) => n && !EXCLUDE_USER_PATTERNS.some((re) => re.test(n)))
    .sort((a, b) => a.localeCompare(b));
};

export const titleAutocomplete = async (
  prefix: string | null,
  needle: string,
  cap = 50,
): Promise<string[]> => {
  let rows: any[][];
  if (prefix) {
    rows =
      (await q(
        `[:find ?t :in $ ?pre :where [?p :node/title ?t]
          [(clojure.string/starts-with? ?t ?pre)]]`,
        prefix,
      )) || [];
  } else {
    rows =
      (await q(
        `[:find ?t :in $ ?needle :where [?p :node/title ?t]
          [(clojure.string/includes? ?t ?needle)]]`,
        needle || "",
      )) || [];
  }
  const n = (needle || "").toLowerCase();
  return rows
    .map((r) => r[0] as string)
    .filter((t) => !n || t.toLowerCase().includes(n))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, cap);
};

/**
 * Resolve a dynamic vocabulary by running the registry's options block as a
 * SmartBlock — the EXACT call attribute-select makes, so the option set is
 * parity-by-construction. Returns null when the SmartBlocks API is missing
 * (caller falls back to prefix autocomplete).
 */
const dynOptionsCache = new Map<string, { ts: number; options: PickerOption[] }>();
export const clearDynOptionsCache = () => dynOptionsCache.clear();

export const resolveDynamicOptions = async (
  entry: RegistryEntry | null,
): Promise<PickerOption[] | null> => {
  if (!entry || !entry.optionsUid) return null;
  const hit = dynOptionsCache.get(entry.optionsUid);
  if (hit && Date.now() - hit.ts < CONFIG.dynamicCacheMs) return hit.options;
  const sb = (window as any).roamjs?.extension?.smartblocks;
  if (!sb || typeof sb.triggerSmartblock !== "function") return null;
  const results = await sb.triggerSmartblock({ srcUid: entry.optionsUid });
  if (!Array.isArray(results)) return null;
  const options = optionsFromSmartblockResults(results, entry);
  dynOptionsCache.set(entry.optionsUid, { ts: Date.now(), options });
  return options;
};

// -------------------------------------------------------------- snapshot

export type Snapshot = {
  blockUid: string;
  duplicates: number;
  parsed: ParsedProps;
  templateOrder: string[];
  /** Resolved text for every ((uid)) reachable from the panel's display. */
  refTexts: Record<string, string>;
};

/**
 * Everything the panel needs for one render, loaded up front. Collects the
 * block-ref uids the display will resolve (slot values, multi children,
 * static rows) and fetches their text in one query.
 */
export const loadSnapshot = async (pageUid: string, type: NodeType): Promise<Snapshot | null> => {
  const pageTree = await pullTreeByUid(pageUid);
  const { block, duplicates } = findPropertiesBlock(pageTree || { children: [] });
  if (!block) return null;
  const parsed = parsePropertiesTree(block);
  const templateOrder = await templateOrderForType(type);

  const refUids = new Set<string>();
  for (const slot of parsed.slots) {
    if (slot.value.kind === "blockref") refUids.add(slot.value.uid);
    for (const c of slot.children)
      if (c.value.kind === "blockref") refUids.add(c.value.uid);
  }
  for (const e of parsed.extras)
    if (e.type === "static")
      for (const tok of parseInline(e.valueRaw))
        if (tok.t === "blockref") refUids.add(tok.uid);
  const refTexts = await blockTextsByUids([...refUids]);

  return { blockUid: block.uid, duplicates, parsed, templateOrder, refTexts };
};

export const currentPageContext = async (): Promise<{
  pageUid: string;
  pageTitle: string;
  type: NodeType;
} | null> => {
  let pageUid: string | null = null;
  try {
    pageUid = await api().ui.mainWindow.getOpenPageOrBlockUid();
  } catch (e) {
    return null;
  }
  if (!pageUid) return null;
  const title = await pageTitleByUid(pageUid);
  if (!title) return null; // zoomed into a block, or daily notes feed
  const type = matchNodeType(title, await loadNodeTypes());
  if (!type) return null;
  return { pageUid, pageTitle: title, type };
};

export const clearCaches = () => {
  registryCache = null;
  nodeTypesCache = null;
  dynOptionsCache.clear();
};
