/* Every read of the graph.
 *
 * All of it is async, because this repository forbids the legacy synchronous
 * `roamAlphaAPI.q` alias. Datalog inputs are parameterized through `:in`
 * rather than interpolated, which is also a repository rule and which removes
 * a real hazard: node titles in these graphs contain LaTeX (`$$\frac{a}{b}$$`),
 * and an unescaped backslash is an invalid Clojure string escape that throws.
 */
import { formatToRegex } from "~/nodeFormat";

export type DiscourseNodeType = { type: string; format: string; regex: RegExp };

const NODES_PAGE_PREFIX = "discourse-graph/nodes/";

/* Pull results come back with namespaced keys (":node/title") from some API
 * surfaces and bare ones ("title") from others. Tolerate both rather than
 * betting on one: guessing wrong yields zero node types, which makes the
 * whole feature do nothing at all, silently and with no error to follow. */
export const pick = <T = unknown>(obj: unknown, attr: string): T | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, T>;
  const bare = attr.slice(attr.indexOf("/") + 1);
  return rec[`:${attr}`] ?? rec[attr] ?? rec[bare];
};

const q = (query: string, ...params: unknown[]): Promise<unknown[][]> =>
  window.roamAlphaAPI.data.async.q(query, ...params);

let nodeTypes: DiscourseNodeType[] = [];

export const getNodeTypes = (): DiscourseNodeType[] => nodeTypes;

/* Exposed for tests, and for the reload path: the title cache below is only
 * valid for one set of node types. */
export const setNodeTypes = (types: { type: string; format: string }[]): void => {
  titleCache.clear();
  nodeTypes = types.map((n) => ({ ...n, regex: formatToRegex(n.format).regex }));
};

export const loadNodeTypes = async (): Promise<DiscourseNodeType[]> => {
  titleCache.clear();
  const rows = await q(
    `[:find (pull ?p [:node/title
                      {:block/children [:block/string
                                        {:block/children [:block/string]}]}])
      :in $ ?prefix
      :where [?p :node/title ?t]
             [(clojure.string/starts-with? ?t ?prefix)]]`,
    NODES_PAGE_PREFIX,
  );
  nodeTypes = (rows || [])
    .map(([page]) => {
      const kids = pick<unknown[]>(page, "block/children") || [];
      const formatBlock = kids.find((c) =>
        /^format$/i.test((pick<string>(c, "block/string") || "").trim()),
      );
      const format = (
        pick<string>(
          (pick<unknown[]>(formatBlock, "block/children") || [])[0],
          "block/string",
        ) || ""
      ).trim();
      return {
        type: (pick<string>(page, "node/title") || "").slice(NODES_PAGE_PREFIX.length),
        format,
      };
    })
    .filter((n) => n.format)
    .map((n) => {
      /* Per node type, not around the whole batch. One malformed Format is a
       * typo on one config page; letting it throw here would abort the map
       * and leave the extension with zero node types and no menu anywhere. */
      try {
        return { ...n, regex: formatToRegex(n.format).regex };
      } catch (e) {
        console.warn(
          `copy-for-latex: skipping node type "${n.type}" — its Format is not a valid pattern:`,
          n.format,
        );
        return null;
      }
    })
    .filter((n): n is DiscourseNodeType => n !== null);
  console.log(`copy-for-latex: loaded ${nodeTypes.length} discourse node type(s).`);
  if (nodeTypes.length === 0) {
    console.warn(
      `copy-for-latex: found zero discourse node types under "${NODES_PAGE_PREFIX}" — ` +
        "is the Discourse Graph plugin configured, and are its config pages named with that prefix?",
    );
  }
  return nodeTypes;
};

export const findNodeTypeForTitle = (title: string): DiscourseNodeType | null =>
  nodeTypes.find((n) => n.regex.test(title || "")) || null;

/* Keyed by title; only valid while nodeTypes is unchanged. */
const titleCache = new Map<string, string>();

export const cachedTypeForTitle = (title: string): string => {
  if (!titleCache.has(title)) {
    titleCache.set(title, findNodeTypeForTitle(title)?.type || "");
  }
  return titleCache.get(title) as string;
};

export const uidForTitle = async (title: string): Promise<string> =>
  pick<string>(
    (
      await q(
        `[:find (pull ?p [:block/uid]) :in $ ?t :where [?p :node/title ?t]]`,
        title,
      )
    )?.[0]?.[0],
    "block/uid",
  ) || "";

export const titleForUid = async (uid: string): Promise<string> =>
  pick<string>(
    (
      await q(
        `[:find (pull ?p [:node/title]) :in $ ?u :where [?p :block/uid ?u]]`,
        uid,
      )
    )?.[0]?.[0],
    "node/title",
  ) || "";

const BLOCK_REF = /\(\(([\w\d_-]{9,})\)\)/g;

/* One query for every reference in the string, not one per reference. */
export const resolveBlockRefs = async (text: string): Promise<string> => {
  const uids = [...(text || "").matchAll(BLOCK_REF)].map((m) => m[1] as string);
  if (!uids.length) return text || "";
  const rows = await q(
    `[:find ?u ?s :in $ [?u ...] :where [?b :block/uid ?u] [?b :block/string ?s]]`,
    uids,
  );
  const byUid = new Map(rows.map(([u, s]) => [u as string, s as string]));
  return (text || "").replace(BLOCK_REF, (whole, uid: string) => byUid.get(uid) ?? whole);
};

export const graphName = (): string =>
  (window.location.href.match(/\/app\/([^/#?]+)/) || [])[1] || "";

export const roamUrlForTitle = async (title: string): Promise<string> => {
  const uid = await uidForTitle(title);
  return uid ? `https://roamresearch.com/#/app/${graphName()}/page/${uid}` : "";
};
