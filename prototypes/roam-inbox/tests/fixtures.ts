/* A fake `window.roamAlphaAPI` with just enough surface for load(). */
import { Q_OPEN_REFS, Q_OPEN_TODOS } from "~/roam";

export const ME = "Matt Akamatsu";
export const MY_UID = "uid-me";

/* One pulled row in the namespaced key style. `author: "me"` means the
 * signed-in user; `todo: false` makes it a mention rather than a message. */
export const row = (
  uid: string,
  string: string,
  createTime: number,
  author: string,
  { todo = true, addressed = `+${ME}` }: { todo?: boolean; addressed?: string } = {},
): unknown[] => [
  {
    ":block/uid": uid,
    ":block/string": string,
    ":create/time": createTime,
    ":block/refs": [{ ":node/title": addressed }, ...(todo ? [{ ":node/title": "TODO" }] : [])],
    ":create/user": {
      ":user/uid": author === "me" ? MY_UID : "uid-them",
      ":user/display-page": { ":node/title": author === "me" ? ME : author },
    },
    ":block/page": { ":node/title": "Sync / Roam Product" },
    ":block/_children": [{ ":block/string": "next actions" }],
  },
];

export type FakeGraph = {
  me?: string | null; // display-page title; null for a user with no display page
  addressed?: unknown[][]; // rows referencing +Me (messages and mentions)
  tasks?: unknown[][]; // rows referencing Me with a TODO
};

export const installFakeRoam = ({ me = ME, addressed = [], tasks = [] }: FakeGraph = {}) => {
  const q = async (query: string, ...params: unknown[]): Promise<unknown[][]> => {
    if (query.includes(":user/uid ?uid")) return me ? [[me]] : [];
    if (query === Q_OPEN_REFS && params[0] === `+${me}`) return addressed;
    if (query === Q_OPEN_TODOS && params[0] === me) return tasks;
    return [];
  };
  const api = {
    graph: { name: "dg-team" },
    user: { uid: () => MY_UID },
    util: { generateUID: () => "new-uid" },
    data: {
      async: { q, pull: async () => null },
      backend: { q: async () => [] },
      addPullWatch: () => true,
      removePullWatch: () => true,
      page: { create: async () => {} },
      block: { create: async () => {}, update: async () => {} },
    },
    ui: {
      slashCommand: { addCommand() {}, removeCommand() {} },
      rightSidebar: { addWindow: async () => {}, open: async () => {} },
      setBlockFocusAndSelection: async () => {},
    },
  };
  (window as unknown as Record<string, unknown>).roamAlphaAPI = api;
  return api;
};
