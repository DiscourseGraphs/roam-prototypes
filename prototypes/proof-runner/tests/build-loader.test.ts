import { afterEach, describe, expect, it, vi } from "vitest";
import { PaletteRegistry, branchOf, buildUrl, commitOf, extensionAPIForDg, type ExtensionAPI } from "../src/roam/build-loader";

const fakeExtensionAPI = () => {
  const store: Record<string, unknown> = { "own-setting": 1 };
  const added: string[] = [];
  const api: ExtensionAPI = {
    settings: {
      get: (key) => store[key],
      getAll: () => ({ ...store }),
      set: (key, value) => {
        store[key] = value;
      },
    },
    ui: {
      commandPalette: {
        addCommand: ({ label }) => {
          added.push(label);
        },
        removeCommand: () => undefined,
      },
    },
  };
  return { api, store, added };
};

describe("loading a CI build", () => {
  afterEach(() => {
    delete (window as unknown as { roamAlphaAPI?: unknown }).roamAlphaAPI;
  });

  it("names a build by the commit inside it", () => {
    const source = 'x={buildCommit:"158ae99817f0c5497597bd1cf15704426e862ec9",buildBranch:"eng-2344-speed-up"}';
    expect(commitOf(source)).toBe("158ae99817f0c5497597bd1cf15704426e862ec9");
    expect(branchOf(source)).toBe("eng-2344-speed-up");
  });

  it("finds main at the root of the release folder and branches under it", () => {
    expect(buildUrl("main")).toMatch(/\/releases\/roam\/$/);
    expect(buildUrl("eng-1-a")).toMatch(/\/releases\/roam\/eng-1-a\/$/);
    expect(buildUrl("sid/fix one")).toMatch(/\/releases\/roam\/sid\/fix%20one\/$/);
  });

  it("hands DG the runner's own extensionAPI, with DG's settings under dg:", async () => {
    const { api, store, added } = fakeExtensionAPI();
    const palette = new PaletteRegistry();
    const forDg = extensionAPIForDg({ graph: "g", palette, extensionAPI: api });
    await forDg.settings.set("use-reified-relations", true);
    expect(store["dg:use-reified-relations"]).toBe(true);
    expect(forDg.settings.get("use-reified-relations")).toBe(true);
    expect(forDg.settings.getAll()).toEqual({ "use-reified-relations": true });
    const callback = vi.fn();
    await forDg.ui.commandPalette.addCommand({ label: "DG: Open Node Search", callback });
    expect(added).toEqual(["DG: Open Node Search"]);
    expect(await palette.run("open node search")).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("falls back to this browser's storage and removes its own commands without one", async () => {
    const removed: string[] = [];
    (window as unknown as { roamAlphaAPI: unknown }).roamAlphaAPI = {
      ui: { commandPalette: { addCommand: () => undefined, removeCommand: ({ label }: { label: string }) => removed.push(label) } },
    };
    const forDg = extensionAPIForDg({ graph: "test-graph", palette: new PaletteRegistry() });
    await forDg.settings.set("hide-metadata", true);
    expect(JSON.parse(localStorage.getItem("proof:dg-settings:test-graph") ?? "{}")).toEqual({ "hide-metadata": true });
    await forDg.ui.commandPalette.addCommand({ label: "DG: Share current node", callback: () => undefined });
    await forDg.removeCommands();
    expect(removed).toEqual(["DG: Share current node"]);
  });
});
