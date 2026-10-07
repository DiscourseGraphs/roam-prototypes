import type { BlockNode } from "./page-kit";
import { isProofRoot } from "./page-kit";

// The few Roam calls the runner makes, typed loosely: roamAlphaAPI has no
// published types, and these shapes are the ones its docs show. Reads go
// through data.async, as Roam's docs ask of new extensions.

type PullBlock = {
  ":block/uid"?: string;
  ":block/string"?: string;
  ":block/open"?: boolean;
  ":block/order"?: number;
  ":block/children"?: PullBlock[];
  ":node/title"?: string;
};

type SidebarWindow = { type: string; "block-uid"?: string; "window-id"?: string; [key: string]: unknown };

export type RoamApi = {
  graph?: { name?: string };
  util: { generateUID(): string };
  user?: { uid?(): string | null };
  data: {
    async: {
      pull(pattern: string, id: [string, string]): Promise<PullBlock | null>;
      q(query: string, ...args: unknown[]): Promise<unknown[][]>;
    };
    block: {
      create(args: { location: { "parent-uid": string; order: number | "last" }; block: { string: string; uid?: string; open?: boolean } }): Promise<void>;
      update(args: { block: { uid: string; string?: string; open?: boolean } }): Promise<void>;
      move(args: { location: { "parent-uid": string; order: number | "last" }; block: { uid: string } }): Promise<void>;
      delete(args: { block: { uid: string } }): Promise<void>;
    };
    page: {
      create(args: { page: { title: string; uid?: string } }): Promise<void>;
    };
  };
  ui: {
    mainWindow: {
      getOpenPageOrBlockUid?(): Promise<string | null> | string | null;
      openPage(args: { page: { uid?: string; title?: string } }): Promise<void>;
    };
    rightSidebar: {
      addWindow(args: { window: SidebarWindow }): Promise<void>;
      removeWindow(args: { window: SidebarWindow }): Promise<void>;
      pinWindow?(args: { window: SidebarWindow; "pin-to-top?"?: boolean }): Promise<void>;
      getWindows(): SidebarWindow[];
      open(): Promise<void>;
    };
    commandPalette: {
      addCommand(args: { label: string; callback: () => unknown; [key: string]: unknown }): Promise<void> | void;
      removeCommand(args: { label: string }): Promise<void> | void;
    };
    components: {
      renderBlock(args: { uid: string; el: HTMLElement; "zoom-path?"?: boolean; "open?"?: boolean }): Promise<unknown>;
      unmountNode(args: { el: HTMLElement }): void;
    };
  };
};

export const roam = (): RoamApi => {
  const api = (window as unknown as { roamAlphaAPI?: RoamApi }).roamAlphaAPI;
  if (!api) throw new Error("Roam's API (window.roamAlphaAPI) isn't there yet.");
  return api;
};

export const graphName = (): string =>
  roam().graph?.name ?? /#\/app\/([^/]+)/.exec(location.hash)?.[1] ?? "graph";

const TREE = "[:block/uid :block/string :block/open :block/order :node/title {:block/children ...}]";

const toNode = (pulled: PullBlock): BlockNode => ({
  uid: pulled[":block/uid"],
  string: pulled[":block/string"] ?? pulled[":node/title"] ?? "",
  open: pulled[":block/open"],
  children: [...(pulled[":block/children"] ?? [])]
    .sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0))
    .map(toNode),
});

export const readTree = async (uid: string): Promise<BlockNode | null> => {
  const pulled = await roam().data.async.pull(TREE, [":block/uid", uid]);
  return pulled ? toNode(pulled) : null;
};

// The page or zoomed-in block the main window shows. The URL comes first:
// an extension can start before the main window has routed to the linked
// page, and until then the API reports whatever it showed before.
export const openUid = async (): Promise<string | null> => {
  const fromUrl = /\/page\/([\w-]+)/.exec(location.hash)?.[1];
  if (fromUrl) return fromUrl;
  return (await roam().ui.mainWindow.getOpenPageOrBlockUid?.()) ?? null;
};

const findRoot = (node: BlockNode): BlockNode | null => {
  if (isProofRoot(node.string)) return node;
  for (const child of node.children ?? []) {
    const found = findRoot(child);
    if (found) return found;
  }
  return null;
};

// [?ancestor-uid] for the block's parent.
const PARENT = "[:find ?parent :in $ ?uid :where [?b :block/uid ?uid] [?p :block/children ?b] [?p :block/uid ?parent]]";

// The {{proof}} block on a page, or the one a zoomed-in block sits in or holds.
export const proofRootFor = async (uid: string): Promise<BlockNode | null> => {
  const tree = await readTree(uid);
  if (!tree) return null;
  const inside = findRoot(tree);
  if (inside) return inside;
  for (const [parent] of await roam().data.async.q(PARENT, uid)) {
    const found = await proofRootFor(String(parent));
    if (found) return found;
  }
  return null;
};

export const createTree = async (parentUid: string, nodes: BlockNode[], order: number | "last" = "last"): Promise<void> => {
  let index = 0;
  for (const node of nodes) {
    const uid = node.uid ?? roam().util.generateUID();
    await roam().data.block.create({
      location: { "parent-uid": parentUid, order: order === "last" ? "last" : order + index },
      block: { string: node.string, uid, ...(node.open === false ? { open: false } : {}) },
    });
    index += 1;
    if (node.children?.length) await createTree(uid, node.children);
  }
};

// [?page-uid] for a title.
const PAGE_BY_TITLE = "[:find ?uid :in $ ?title :where [?p :node/title ?title] [?p :block/uid ?uid]]";

export const pageUid = async (title: string): Promise<string | null> => {
  const rows = await roam().data.async.q(PAGE_BY_TITLE, title);
  return rows.length ? String(rows[0][0]) : null;
};

export const ensurePage = async (title: string): Promise<string> => {
  const existing = await pageUid(title);
  if (existing) return existing;
  const uid = roam().util.generateUID();
  await roam().data.page.create({ page: { title, uid } });
  return uid;
};

// [?display-name] for a user uid.
const USER_NAME = "[:find ?name :in $ ?uid :where [?u :user/uid ?uid] [?u :user/display-name ?name]]";

// The name to put on a run log line: the Roam user's display name if the
// graph has one for them.
export const userName = async (): Promise<string | null> => {
  try {
    const uid = roam().user?.uid?.();
    if (!uid) return null;
    const rows = await roam().data.async.q(USER_NAME, uid);
    return rows.length ? String(rows[0][0]) : null;
  } catch {
    return null;
  }
};

// The uid in a rendered block's element id: block-input-<window>-<uid>.
export const blockUidOf = (element: Element): string | null => {
  const input = element.closest(".rm-block__input, .rm-block-input, [id^='block-input-']");
  const match = input ? /-([\w-]{9})$/.exec(input.id) : null;
  return match ? match[1] : null;
};
