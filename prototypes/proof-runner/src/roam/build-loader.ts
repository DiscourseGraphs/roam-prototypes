import { roam } from "./roam";

// Loads a Discourse Graph build that CI put on Vercel Blob, the way Roam
// Depot would, but from a page: fetch extension.js, check which commit it
// is, run it, and add its stylesheet. The CDN ignores query strings and can
// lag an upload by a minute, so the commit inside the file is the only
// trustworthy name for what loaded.

export const BLOB_ROOT = "https://6b4k1ntlti17rkf1.public.blob.vercel-storage.com/releases/roam";
export const DG_REPO = "DiscourseGraphs/discourse-graph";

export type LoadedBuild = {
  branch: string;
  // The PR the page named, when it named one.
  pr: number | null;
  commit: string | null;
  // The PR head when the page names a PR, to say whether CI has caught up.
  prHead: string | null;
  url: string;
  loadedAt: number;
  unload: () => Promise<void>;
};

type Command = { label: string; callback: () => unknown; [key: string]: unknown };

// The parts of Roam's extensionAPI the runner and DG use.
export type ExtensionAPI = {
  settings: {
    get(key: string): unknown;
    getAll(): Record<string, unknown> | null | undefined;
    set(key: string, value: unknown): Promise<void> | void;
    panel?: { create(config: unknown): void };
  };
  ui: {
    commandPalette: {
      addCommand(command: Command): Promise<void> | void;
      removeCommand(args: { label: string }): Promise<void> | void;
    };
  };
};

// Every command palette entry registered while the build runs, so a kit's
// command_palette step can run one by label without the palette's UI.
export class PaletteRegistry {
  private readonly commands = new Map<string, Command>();
  private restoreRoam: (() => void) | null = null;

  add(command: Command): void {
    this.commands.set(command.label, command);
  }

  remove(label: string): void {
    this.commands.delete(label);
  }

  labels(): string[] {
    return [...this.commands.keys()].sort();
  }

  find(label: string): Command | null {
    const wanted = label.replace(/\s+/g, " ").trim().toLowerCase();
    const all = [...this.commands.values()];
    return (
      all.find((command) => command.label.toLowerCase() === wanted) ??
      all.find((command) => command.label.toLowerCase().includes(wanted)) ??
      null
    );
  }

  async run(label: string): Promise<boolean> {
    const command = this.find(label);
    if (!command) return false;
    await command.callback();
    return true;
  }

  // Commands registered straight through roamAlphaAPI, not extensionAPI.
  watchRoam(): void {
    if (this.restoreRoam) return;
    const palette = roam().ui.commandPalette as { addCommand: (command: Command) => unknown };
    const original = palette.addCommand;
    try {
      palette.addCommand = (command: Command) => {
        this.add(command);
        return original.call(palette, command);
      };
      this.restoreRoam = () => {
        palette.addCommand = original;
      };
    } catch {
      // A frozen API just means direct registrations go through the palette UI.
    }
  }

  stopWatching(): void {
    this.restoreRoam?.();
    this.restoreRoam = null;
  }
}

const SETTINGS_KEY = (graph: string): string => `proof:dg-settings:${graph}`;

const readSettings = (graph: string): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY(graph)) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};

// What DG gets for extensionAPI. Loaded as an extension, the runner hands on
// its own: DG's settings live in Roam under a dg: prefix and its commands go
// away with the runner. From roam/js there is no extensionAPI, so settings
// stay in this browser and the runner removes the commands itself. Either
// way the settings panel isn't drawn: DG opens its settings from the
// command palette too.
export const extensionAPIForDg = ({
  graph,
  palette,
  extensionAPI,
}: {
  graph: string;
  palette: PaletteRegistry;
  extensionAPI?: ExtensionAPI;
}): ExtensionAPI & { removeCommands(): Promise<void> } => {
  const own = new Set<string>();
  const settings: ExtensionAPI["settings"] = extensionAPI
    ? {
        get: (key) => extensionAPI.settings.get(`dg:${key}`),
        getAll: () =>
          Object.fromEntries(
            Object.entries(extensionAPI.settings.getAll() ?? {})
              .filter(([key]) => key.startsWith("dg:"))
              .map(([key, value]) => [key.slice(3), value]),
          ),
        set: (key, value) => extensionAPI.settings.set(`dg:${key}`, value),
        panel: { create: () => undefined },
      }
    : {
        get: (key) => readSettings(graph)[key],
        getAll: () => readSettings(graph),
        set: (key, value) => {
          const all = readSettings(graph);
          all[key] = value;
          localStorage.setItem(SETTINGS_KEY(graph), JSON.stringify(all));
        },
        panel: { create: () => undefined },
      };
  const commands = extensionAPI?.ui.commandPalette ?? roam().ui.commandPalette;
  return {
    settings,
    ui: {
      commandPalette: {
        addCommand: async (command) => {
          palette.add(command);
          own.add(command.label);
          await commands.addCommand(command);
        },
        removeCommand: async ({ label }) => {
          palette.remove(label);
          own.delete(label);
          await commands.removeCommand({ label });
        },
      },
    },
    // Roam removes commands added through a real extensionAPI on unload;
    // the ones added straight to Roam are the runner's to remove.
    removeCommands: async () => {
      if (extensionAPI) return;
      for (const label of own) await roam().ui.commandPalette.removeCommand({ label });
      own.clear();
    },
  };
};

export const buildUrl = (branch: string): string =>
  branch === "main"
    ? `${BLOB_ROOT}/`
    : `${BLOB_ROOT}/${branch.split("/").map(encodeURIComponent).join("/")}/`;

export const commitOf = (source: string): string | null =>
  /buildCommit:"([0-9a-f]{7,40})"/.exec(source)?.[1] ?? null;

export const branchOf = (source: string): string | null =>
  /buildBranch:"([^"]+)"/.exec(source)?.[1] ?? null;

type DgWindow = {
  roamjs?: { loaded?: Set<string>; extension?: { queryBuilder?: { runQuery?: unknown; getDiscourseNodes?: unknown } } };
};

// A DG (or any roamjs-components extension built without a package name)
// already running: from Roam Depot or developer mode. A second copy would
// refuse to start, so the loader doesn't try.
export const dgRunning = (): boolean => {
  const dg = (window as unknown as DgWindow).roamjs;
  return Boolean(dg?.loaded?.has("roamjs") || dg?.extension?.queryBuilder?.runQuery);
};

export const dgReady = (): boolean => {
  const builder = (window as unknown as DgWindow).roamjs?.extension?.queryBuilder;
  return Boolean(builder?.runQuery && builder?.getDiscourseNodes);
};

// The branch and head commit of a PR, from GitHub's public API.
export const prHead = async (pr: number): Promise<{ branch: string; sha: string } | null> => {
  try {
    const response = await fetch(`https://api.github.com/repos/${DG_REPO}/pulls/${pr}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { head?: { ref?: string; sha?: string } };
    return body.head?.ref && body.head.sha ? { branch: body.head.ref, sha: body.head.sha } : null;
  } catch {
    return null;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CSS_ID = "proof-dg-build-css";

export const loadBuild = async ({
  branch,
  pr = null,
  graph,
  palette,
  head,
  extensionAPI,
  timeout = 60_000,
}: {
  branch: string;
  pr?: number | null;
  graph: string;
  palette: PaletteRegistry;
  head: string | null;
  extensionAPI?: ExtensionAPI;
  timeout?: number;
}): Promise<LoadedBuild> => {
  const url = buildUrl(branch);
  // no-store skips the browser's day-long copy; the CDN serves its latest.
  const response = await fetch(`${url}extension.js?proof=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `No build at ${url}extension.js (HTTP ${response.status}). CI uploads a build when a PR from this repo is opened or pushed to.`,
    );
  }
  const source = await response.text();
  const commit = commitOf(source);
  const builtFrom = branchOf(source);
  if (builtFrom && builtFrom !== branch && !(branch === "main" && builtFrom === "main")) {
    throw new Error(`The file at ${url} says it was built from ${builtFrom}, not ${branch}.`);
  }
  const css = await fetch(`${url}extension.css?proof=${Date.now()}`, { cache: "no-store" })
    .then((reply) => (reply.ok ? reply.text() : ""))
    .catch(() => "");
  // Importing the text that was checked, through a blob: URL, so the code
  // that runs is the commit the panel names.
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const module = (await import(/* webpackIgnore: true */ moduleUrl)) as {
    default?: { onload?: (args: unknown) => unknown; onunload?: () => unknown };
  };
  URL.revokeObjectURL(moduleUrl);
  const extension = module.default;
  if (typeof extension?.onload !== "function") {
    throw new Error(`${url}extension.js has no default export with onload.`);
  }
  const api = extensionAPIForDg({ graph, palette, extensionAPI });
  // Whatever the build managed to set up before failing or being unloaded:
  // its own registrations, the commands added for it, the stylesheet.
  const cleanUp = async (): Promise<void> => {
    try {
      await extension.onunload?.();
    } finally {
      await api.removeCommands();
      palette.stopWatching();
      document.getElementById(CSS_ID)?.remove();
    }
  };
  try {
    document.getElementById(CSS_ID)?.remove();
    if (css) {
      const style = document.createElement("style");
      style.id = CSS_ID;
      style.textContent = css;
      document.head.append(style);
    }
    palette.watchRoam();
    await extension.onload({
      extensionAPI: api,
      extension: { version: commit ? `${branch}@${commit.slice(0, 7)}` : branch },
    });
    const deadline = Date.now() + timeout;
    while (!dgReady()) {
      if (Date.now() > deadline) throw new Error(`The build from ${branch} ran but DG didn't report ready in ${timeout / 1000}s.`);
      await sleep(200);
    }
  } catch (error) {
    await cleanUp().catch(() => undefined);
    throw error;
  }
  return { branch, pr, commit, prHead: head, url, loadedAt: Date.now(), unload: cleanUp };
};
