/* Every read of the graph.
 *
 * All async (`data.async.*` only — repository rule; the legacy synchronous
 * `roamAlphaAPI.q` alias is forbidden), and all datalog inputs are
 * parameterized through `:in` rather than interpolated: node titles in these
 * graphs contain LaTeX, and an unescaped backslash is an invalid Clojure
 * string escape that throws.
 *
 * loadNodeTypes / pick are ported from prototypes/copy-for-latex/src/graph.ts.
 */
import { formatToRegex } from "~/nodeFormat";
import type { BlockNode } from "~/keyFigure";
import { manualKeyImageFromProps } from "~/keyFigure";

export type DiscourseNodeType = { type: string; format: string; regex: RegExp };

const NODES_PAGE_PREFIX = "discourse-graph/nodes/";

/* Pull results come back with namespaced keys (":node/title") from some API
 * surfaces and bare ones ("title") from others. Tolerate both rather than
 * betting on one: guessing wrong yields zero results, silently. */
export const pick = <T = unknown>(obj: unknown, attr: string): T | undefined => {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, T>;
  const bare = attr.slice(attr.indexOf("/") + 1);
  return rec[`:${attr}`] ?? rec[attr] ?? rec[bare];
};

const q = (query: string, ...params: unknown[]): Promise<unknown[][]> =>
  window.roamAlphaAPI.data.async.q(query, ...params);

const pull = (selector: string, uid: string): Promise<unknown> =>
  (
    window.roamAlphaAPI.data.async.pull as (
      selector: string,
      eid: unknown,
    ) => Promise<unknown>
  )(selector, [":block/uid", uid]);

let nodeTypes: DiscourseNodeType[] = [];

export const getNodeTypes = (): DiscourseNodeType[] => nodeTypes;

/* Exposed for tests. */
export const setNodeTypes = (types: { type: string; format: string }[]): void => {
  nodeTypes = types.map((n) => ({ ...n, regex: formatToRegex(n.format).regex }));
};

export const loadNodeTypes = async (): Promise<DiscourseNodeType[]> => {
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
      /* One malformed Format is a typo on one config page; letting it throw
       * would abort the map and leave zero node types everywhere. */
      try {
        return { ...n, regex: formatToRegex(n.format).regex };
      } catch {
        console.warn(
          `hover-key-figure: skipping node type "${n.type}" — its Format is not a valid pattern:`,
          n.format,
        );
        return null;
      }
    })
    .filter((n): n is DiscourseNodeType => n !== null);
  console.log(`hover-key-figure: loaded ${nodeTypes.length} discourse node type(s).`);
  if (nodeTypes.length === 0) {
    console.warn(
      `hover-key-figure: found zero discourse node types under "${NODES_PAGE_PREFIX}" — ` +
        "falling back to the built-in [[XXX]] - title pattern.",
    );
  }
  return nodeTypes;
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

/* --- KeyFigureIO backed by the live graph ------------------------------- */

const toBlockNode = (raw: unknown): BlockNode | null => {
  if (!raw || typeof raw !== "object") return null;
  const uid = pick<string>(raw, "block/uid") || "";
  const string =
    pick<string>(raw, "block/string") ?? pick<string>(raw, "node/title") ?? "";
  const rawKids = (pick<unknown[]>(raw, "block/children") || [])
    .slice()
    .sort(
      (a, b) =>
        (pick<number>(a, "block/order") ?? 0) - (pick<number>(b, "block/order") ?? 0),
    );
  const children = rawKids
    .map(toBlockNode)
    .filter((c): c is BlockNode => c !== null);
  return { uid, string, children };
};

export const fetchTree = async (uid: string): Promise<BlockNode | null> =>
  toBlockNode(
    await pull(
      "[:block/uid :block/string :node/title :block/order {:block/children ...}]",
      uid,
    ),
  );

export const fetchStrings = async (uids: string[]): Promise<Map<string, string>> => {
  if (!uids.length) return new Map();
  const rows = await q(
    `[:find ?u ?s :in $ [?u ...] :where [?b :block/uid ?u] [?b :block/string ?s]]`,
    uids,
  );
  return new Map((rows || []).map(([u, s]) => [u as string, s as string]));
};

export const fetchManualKeyImage = async (uid: string): Promise<string> => {
  const raw = await pull("[:block/props]", uid).catch(() => null);
  return manualKeyImageFromProps(pick(raw, "block/props") ?? raw);
};
