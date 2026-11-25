import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Lifecycle = {
  reactRoots: HTMLElement[];
  observers: MutationObserver[];
  unload: () => void;
};

vi.mock("roamjs-components/util", async () => {
  const { unmountComponentAtNode } = await import("react-dom");
  return {
    runExtension: (setup: () => Promise<Lifecycle>) => async () => {
      const { reactRoots, observers, unload } = await setup();
      return {
        reactRoots,
        unload: () => {
          for (const root of reactRoots) {
            unmountComponentAtNode(root);
            root.remove();
          }
          for (const observer of observers) observer.disconnect();
          unload();
        },
      };
    },
  };
});

import setup from "../src/index";

const mount = setup as unknown as () => Promise<{
  reactRoots: HTMLElement[];
  unload: () => void;
}>;
const query = vi.fn();
const openPage = vi.fn();
const addWindow = vi.fn();
const openTab = vi.fn();
let unload: () => void;
let reactRoots: HTMLElement[];

const click = async (
  label: string,
  modifiers: MouseEventInit = {},
): Promise<void> => {
  const button = Array.from(document.querySelectorAll("nav button")).find(
    (candidate) => candidate.textContent?.includes(label),
  ) as HTMLButtonElement;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, ...modifiers }),
    );
  });
};

beforeEach(async () => {
  query.mockReset();
  openPage.mockReset();
  addWindow.mockReset();
  openTab.mockReset();
  vi.stubGlobal("open", openTab);
  window.history.replaceState(null, "", "/#/app/test-graph/page/graph-home");
  vi.stubGlobal("roamAlphaAPI", {
    user: { uid: () => "user-123" },
    data: { async: { q: query } },
    ui: { mainWindow: { openPage }, rightSidebar: { addWindow } },
  });
  document.body.innerHTML = `
    <div class="roam-main">
      <article class="roam-article">
        <div class="rm-title-display-container"><h1 class="rm-title-display">🥾 Home</h1></div>
        <div class="kanban-board">Original board</div>
      </article>
    </div>
    <div id="right-sidebar" data-page-title="🥾 Home">
      <div class="kanban-board">Sidebar board</div>
    </div>
  `;
  await act(async () => {
    ({ reactRoots, unload } = await mount());
  });
});

afterEach(() => {
  act(() => unload());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Graph Home", () => {
  it("mounts once on the main Home page and restores the original UI on unload", () => {
    expect(document.querySelectorAll(".dg-graph-home")).toHaveLength(1);
    expect(reactRoots).toEqual([document.querySelector(".dg-graph-home")]);
    expect(
      document.querySelectorAll(".dg-graph-home-active .kanban-board"),
    ).toHaveLength(1);
    expect(
      Array.from(document.querySelectorAll("nav button strong"), (label) => label.textContent),
    ).toEqual(["Team front page", "My Homepage", "Sync / All Hands"]);

    act(() => unload());
    expect(document.querySelector(".dg-graph-home")).toBeNull();
    expect(document.querySelector(".dg-graph-home-active")).toBeNull();
    expect(document.querySelectorAll(".kanban-board")).toHaveLength(2);
  });

  it("unmounts away from Home and remounts on return", async () => {
    const title = document.querySelector("h1")!;
    await act(async () => {
      title.textContent = "Another page";
    });
    expect(document.querySelector(".dg-graph-home")).toBeNull();

    await act(async () => {
      title.textContent = "🥾 Home";
    });
    expect(document.querySelectorAll(".dg-graph-home")).toHaveLength(1);
    expect(reactRoots).toEqual([document.querySelector(".dg-graph-home")]);
  });

  it("looks up the signed-in user's homepage and opens it by UID", async () => {
    query
      .mockResolvedValueOnce([["Test Person"]])
      .mockResolvedValueOnce([["home-uid"]]);
    await click("My Homepage");

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(":user/uid"),
      "user-123",
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(":node/title"),
      "Test Person/Home",
    );
    expect(openPage).toHaveBeenCalledWith({ page: { uid: "home-uid" } });
  });

  it("opens the renamed team front page directly", async () => {
    query.mockResolvedValueOnce([["front-uid"]]);
    await click("Team front page");

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(":node/title"),
      "🚪 Front page for team members",
    );
    expect(openPage).toHaveBeenCalledWith({ page: { uid: "front-uid" } });
  });

  it("falls back to the previous front page title in older graphs", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([["old-front-uid"]]);
    await click("Team front page");

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(":node/title"),
      "🚪 Front page for team members",
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(":node/title"),
      "🚪 Discourse graphs front page for team members",
    );
    expect(openPage).toHaveBeenCalledWith({ page: { uid: "old-front-uid" } });
  });

  it("opens a shortcut in the right sidebar on Shift-click", async () => {
    query.mockResolvedValueOnce([["all-hands-uid"]]);
    await click("Sync / All Hands", { shiftKey: true });

    expect(addWindow).toHaveBeenCalledWith({
      window: { type: "outline", "block-uid": "all-hands-uid" },
    });
    expect(openPage).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "opens a shortcut in a new tab with %o",
    async (modifiers) => {
      const tab = {
        location: { replace: vi.fn() },
        close: vi.fn(),
        opener: window,
      };
      openTab.mockReturnValueOnce(tab);
      query.mockImplementationOnce(() => {
        expect(openTab).toHaveBeenCalledWith("about:blank", "_blank");
        return Promise.resolve([["all-hands-uid"]]);
      });

      await click("Sync / All Hands", modifiers);

      expect(tab.opener).toBeNull();
      expect(tab.location.replace).toHaveBeenCalledWith(
        `${window.location.origin}/#/app/test-graph/page/all-hands-uid`,
      );
      expect(tab.close).not.toHaveBeenCalled();
      expect(openPage).not.toHaveBeenCalled();
      expect(addWindow).not.toHaveBeenCalled();
    },
  );

  it("closes the new tab if the page cannot be found", async () => {
    const tab = {
      location: { replace: vi.fn() },
      close: vi.fn(),
      opener: window,
    };
    openTab.mockReturnValueOnce(tab);
    query.mockResolvedValueOnce([]);

    await click("Sync / All Hands", { ctrlKey: true });

    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Sync / All Hands",
    );
  });

  it("reports a missing destination and allows retry", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([["all-hands-uid"]]);
    await click("Sync / All Hands");

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Sync / All Hands",
    );
    expect(openPage).not.toHaveBeenCalled();

    await click("Sync / All Hands");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(openPage).toHaveBeenCalledWith({ page: { uid: "all-hands-uid" } });
  });

  it("ignores navigation results after the launcher unloads", async () => {
    let finishLookup!: (rows: string[][]) => void;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    await click("Sync / All Hands");

    await act(async () => {
      unload();
      finishLookup([["all-hands-uid"]]);
    });
    expect(openPage).not.toHaveBeenCalled();
  });
});
