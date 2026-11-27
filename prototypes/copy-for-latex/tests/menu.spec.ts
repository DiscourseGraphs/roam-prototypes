/* The menu, the clipboard, and the right-click decision. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts: string[] = [];
vi.mock("roamjs-components/components/Toast", () => ({
  render: ({ content }: { content: string }) => {
    toasts.push(content);
    return () => {};
  },
}));

import { CLIPBOARD_FAIL_MESSAGE, ROOT_CLASS, closeMenu, copyText, getOpenMenu, menuItemsFor, openMenu, shouldCloseOnPointer } from "~/menu";
import { handleContextMenu, handleKeydown, handlePointer } from "~/contextMenu";
import { latexForTitle, labelForTitle } from "~/payload";
import { setNodeTypes } from "~/graph";
import { MARK_ATTR } from "~/dom";

const EVD = "[[EVD]] - {content} - {Source}";
const NODE_TITLE = "[[EVD]] - The tube pinched - @vasan2020mechanical";

const stubGraph = (rows: unknown[][] = []) => {
  (window as unknown as Record<string, unknown>).roamAlphaAPI = {
    data: { async: { q: vi.fn(async () => rows) } },
    ui: {
      mainWindow: { openPage: vi.fn(async () => {}) },
      rightSidebar: { addWindow: vi.fn(async () => {}) },
    },
  };
};

const setClipboard = (writeText: (t: string) => Promise<void>) => {
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
};

const labels = () =>
  Array.from(getOpenMenu()?.querySelectorAll(".cfl-menu-item") || []).map((e) => e.textContent);

beforeEach(() => {
  toasts.length = 0;
  setNodeTypes([{ type: "Evidence", format: EVD }]);
  stubGraph();
  document.body.innerHTML = "";
});
afterEach(() => {
  closeMenu();
  setNodeTypes([]);
});

describe("payload", () => {
  it("builds the cited sentence", async () => {
    expect((await latexForTitle(NODE_TITLE)).latex).toBe(
      "The tube pinched \\autocite{vasan2020mechanical}.",
    );
  });

  it("refuses a page that is not a discourse node, and says why", async () => {
    const out = await latexForTitle("Meeting notes");
    expect(out.latex).toBe("");
    expect(out.warning).toContain("not a discourse node");
  });

  it("drops the type marker and the citekey brackets from a hyperlink label", () => {
    expect(labelForTitle("[[EVD]] - The tube pinched - [[@vasan2020mechanical]]")).toBe(
      "The tube pinched - @vasan2020mechanical",
    );
  });

  it("falls back to the unwrapped title for a non-node", () => {
    expect(labelForTitle("[[Some page]]")).toBe("Some page");
  });
});

describe("menuItemsFor", () => {
  it("offers the full set by default", () => {
    expect(menuItemsFor(NODE_TITLE).map((i) => ("label" in i ? i.label : "—"))).toEqual([
      "Copy for LaTeX",
      "Copy as hyperlink",
      "—",
      "Jump to page",
      "Open in sidebar",
    ]);
  });

  it("drops Jump to page when asked", () => {
    expect(
      menuItemsFor(NODE_TITLE, { omitJumpToPage: true }).some(
        (i) => "label" in i && i.label === "Jump to page",
      ),
    ).toBe(false);
  });
});

describe("openMenu", () => {
  it("scopes its class to this prototype rather than borrowing Roam's", () => {
    const menu = openMenu(NODE_TITLE, 10, 10);
    expect(menu.className).toContain(ROOT_CLASS);
    expect(menu.className).not.toContain("bp3-");
  });

  it("replaces an already-open menu instead of stacking a second one", () => {
    openMenu(NODE_TITLE, 10, 10);
    openMenu(NODE_TITLE, 20, 20);
    expect(document.querySelectorAll(`.${ROOT_CLASS}`).length).toBe(1);
  });

  it("closes on Escape", () => {
    openMenu(NODE_TITLE, 10, 10);
    handleKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(getOpenMenu()).toBeNull();
  });
});

describe("dismissal", () => {
  it("keeps the menu open for a press on one of its own items", () => {
    const menu = openMenu(NODE_TITLE, 10, 10);
    expect(shouldCloseOnPointer(menu.querySelector(".cfl-menu-item"))).toBe(false);
  });

  it("closes on a press anywhere else", () => {
    openMenu(NODE_TITLE, 10, 10);
    handlePointer(new MouseEvent("mousedown"));
    expect(getOpenMenu()).toBeNull();
  });

  it("treats any press as closable when nothing is open", () => {
    expect(shouldCloseOnPointer(document.body)).toBe(true);
  });
});

describe("copyText", () => {
  it("uses the clipboard API when it works", async () => {
    const written: string[] = [];
    setClipboard(async (t) => {
      written.push(t);
    });
    expect(await copyText("hello")).toBe(true);
    expect(written).toEqual(["hello"]);
  });

  /* execCommand is the only path that works when the document is not focused,
   * which is exactly the case right after a contextmenu in some browsers. */
  it("falls back to execCommand when the clipboard API rejects", async () => {
    setClipboard(async () => {
      throw new Error("not focused");
    });
    const exec = vi.fn(() => true);
    (document as unknown as Record<string, unknown>).execCommand = exec;
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  /* A failed copy used to resolve normally with no toast, so the user
   * pasted whatever was on the clipboard before. */
  it("reports failure when both paths fail", async () => {
    setClipboard(async () => {
      throw new Error("no");
    });
    (document as unknown as Record<string, unknown>).execCommand = () => false;
    expect(await copyText("hello")).toBe(false);
  });
});

describe("clicking an item", () => {
  const clickItem = async (text: string) => {
    const item = Array.from(getOpenMenu()?.querySelectorAll(".cfl-menu-item") || []).find(
      (e) => e.textContent === text,
    ) as HTMLElement;
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  };

  it("copies the LaTeX sentence", async () => {
    const written: string[] = [];
    setClipboard(async (t) => {
      written.push(t);
    });
    openMenu(NODE_TITLE, 10, 10);
    await clickItem("Copy for LaTeX");
    expect(written).toEqual(["The tube pinched \\autocite{vasan2020mechanical}."]);
  });

  it("toasts rather than copying when there is nothing usable", async () => {
    const written: string[] = [];
    setClipboard(async (t) => {
      written.push(t);
    });
    openMenu("Meeting notes", 10, 10);
    await clickItem("Copy for LaTeX");
    expect(written).toEqual([]);
    expect(toasts[0]).toContain("not a discourse node");
  });

  it("toasts when the clipboard write fails", async () => {
    setClipboard(async () => {
      throw new Error("no");
    });
    (document as unknown as Record<string, unknown>).execCommand = () => false;
    openMenu(NODE_TITLE, 10, 10);
    await clickItem("Copy for LaTeX");
    expect(toasts).toContain(CLIPBOARD_FAIL_MESSAGE);
  });
});

describe("handleContextMenu", () => {
  const rightClickOn = (el: Element) => {
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "target", { value: el });
    handleContextMenu(e);
    return e;
  };

  const headingFor = (title: string, { inMainWindow = true } = {}) => {
    document.body.innerHTML = `<div class="${
      inMainWindow ? "roam-article" : "rm-sidebar-outline"
    }"><div class="rm-title-display-container"><h1 class="rm-title-display" data-cfl-title="${title}" ${MARK_ATTR}="Evidence">x</h1></div></div>`;
    return document.querySelector("h1") as HTMLElement;
  };

  it("opens on a node's own heading and suppresses the native menu", () => {
    const e = rightClickOn(headingFor(NODE_TITLE));
    expect(labels()).toContain("Copy for LaTeX");
    expect(e.defaultPrevented).toBe(true);
  });

  it("drops Jump to page on the page you are already on", () => {
    rightClickOn(headingFor(NODE_TITLE));
    expect(labels()).toEqual(["Copy for LaTeX", "Copy as hyperlink", "Open in sidebar"]);
  });

  it("keeps it on a sidebar heading, where it still goes somewhere", () => {
    rightClickOn(headingFor(NODE_TITLE, { inMainWindow: false }));
    expect(labels()).toEqual([
      "Copy for LaTeX",
      "Copy as hyperlink",
      "Jump to page",
      "Open in sidebar",
    ]);
  });

  /* A heading's parked answer can be a page behind. */
  it("leaves the native menu alone when the parked title is not a node", () => {
    const e = rightClickOn(headingFor("Meeting notes"));
    expect(getOpenMenu()).toBeNull();
    expect(e.defaultPrevented).toBe(false);
  });

  it("opens the full menu on an inline reference", () => {
    document.body.innerHTML = `<div class="roam-article"><span class="rm-page-ref" ${MARK_ATTR}="Evidence" data-tag="${NODE_TITLE}">x</span></div>`;
    rightClickOn(document.querySelector("span") as HTMLElement);
    expect(labels()).toEqual([
      "Copy for LaTeX",
      "Copy as hyperlink",
      "Jump to page",
      "Open in sidebar",
    ]);
  });

  it("ignores a right-click on ordinary text", () => {
    document.body.innerHTML = `<div class="roam-article"><p>plain</p></div>`;
    const e = rightClickOn(document.querySelector("p") as HTMLElement);
    expect(getOpenMenu()).toBeNull();
    expect(e.defaultPrevented).toBe(false);
  });
});
