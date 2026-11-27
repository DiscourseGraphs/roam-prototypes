/* The extension must carry its own stylesheet.
 *
 * Roam injects a published `extension.css` when it loads an extension from a
 * URL, but nothing injects it when the module is pulled in with `import()`
 * from a `roam/js` block — which is how preview builds get tested. The menu
 * is `position: fixed`, so without its rules it renders as a static, unstyled
 * list at the end of <body>: present, clickable, and invisible in practice.
 * That is exactly how this shipped the first time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_CSS } from "~/styles";
import { openMenu, closeMenu } from "~/menu";
import { setNodeTypes } from "~/graph";

const NODE_TITLE = "[[EVD]] - The tube pinched - @vasan2020mechanical";

afterEach(() => {
  closeMenu();
  setNodeTypes([]);
  document.head.querySelectorAll("style").forEach((s) => s.remove());
});

describe("the stylesheet the bundle carries", () => {
  it("makes the menu float, which is the part that cannot be optional", () => {
    setNodeTypes([{ type: "Evidence", format: "[[EVD]] - {content} - {Source}" }]);
    const style = document.createElement("style");
    style.textContent = MENU_CSS;
    document.head.appendChild(style);

    const menu = openMenu(NODE_TITLE, 10, 10);
    expect(getComputedStyle(menu).position).toBe("fixed");
  });

  it("scopes every rule to this prototype so it cannot restyle the graph", () => {
    const selectors = MENU_CSS.split("}")
      .map((chunk) => chunk.split("{")[0]?.trim())
      .filter((s): s is string => Boolean(s));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain("roam-prototype-copy-for-latex");
    }
  });
});

describe("onload", () => {
  const stubRoam = async () => {
    (window as unknown as Record<string, unknown>).roamAlphaAPI = {
      data: { async: { q: vi.fn(async () => []) } },
      ui: { commandPalette: { addCommand: vi.fn(), removeCommand: vi.fn() } },
      platform: { isPC: true },
    };
    /* runExtension writes a React 17 shim onto window.React the moment it is
     * called, which is at module scope. Roam provides that global; jsdom does
     * not, and an empty object is all the assignment needs. */
    (window as unknown as Record<string, unknown>).React = {};
  };

  it("injects the stylesheet itself, and removes it on unload", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await stubRoam();
    const before = document.head.querySelectorAll("style").length;

    const extension = (await import("~/index")).default;
    await extension.onload({
      extensionAPI: undefined as never,
      extension: { version: "test" } as never,
    });
    /* runExtension's onload is typed as returning void: it starts the async
     * run and does not await it, and only registers the unload callback once
     * that promise resolves. Let it settle before asking about cleanup. */
    await new Promise((resolve) => setTimeout(resolve, 0));

    const during = document.head.querySelectorAll("style").length;
    expect(during).toBeGreaterThan(before);
    expect(
      Array.from(document.head.querySelectorAll("style")).some((s) =>
        s.textContent?.includes("roam-prototype-copy-for-latex"),
      ),
    ).toBe(true);

    await extension.onunload?.();
    expect(
      Array.from(document.head.querySelectorAll("style")).some((s) =>
        s.textContent?.includes("roam-prototype-copy-for-latex"),
      ),
    ).toBe(false);
  });
});

describe("load failure", () => {
  /* runExtension's own failure path loses the error: in production it posts to
   * SamePage and shows a generic toast, and it reads extensionAPI.settings
   * while doing so — which is undefined when the module is imported from a
   * roam/js block, so the reporter throws over the top of the real error.
   * Anything that goes wrong at load has to be caught before it gets there. */
  it("names the missing capability instead of failing deep in a helper", async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a));
    (window as unknown as Record<string, unknown>).React = {};
    (window as unknown as Record<string, unknown>).roamAlphaAPI = {
      graph: { name: "g" },
      data: {}, // no async.q: an older Roam, or a stubbed one
    };
    // runExtension skips onload entirely once its id is in this set
    delete (window as unknown as Record<string, unknown>).roamjs;

    const extension = (await import("~/index")).default;
    await extension.onload({
      extensionAPI: undefined as never,
      extension: { version: "test" } as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors.length).toBeGreaterThan(0);
    // Errors do not survive JSON.stringify, so read the message directly.
    const messages = errors.flat().map((e) => (e instanceof Error ? e.message : String(e)));
    expect(messages.join(" ")).toContain("data.async.q");
  });

  it("does not rethrow, so runExtension's broken reporter is never reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (window as unknown as Record<string, unknown>).React = {};
    (window as unknown as Record<string, unknown>).roamAlphaAPI = { graph: { name: "g" }, data: {} };
    delete (window as unknown as Record<string, unknown>).roamjs;
    const extension = (await import("~/index")).default;
    // extensionAPI undefined is precisely the case that crashed the reporter
    await expect(
      (async () => {
        extension.onload({
          extensionAPI: undefined as never,
          extension: { version: "test" } as never,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      })(),
    ).resolves.toBeUndefined();
  });
});
