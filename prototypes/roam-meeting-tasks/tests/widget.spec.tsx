/* The widget end to end against the fake graph: mount into a host element
 * exactly as the shim does, let it load, and read what it shows.
 *
 * The first three blocks port the roam/render component's offline harness
 * check for check, so the port is held to the behavior it replaces. */
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmountAll } from "~/mount";
import { forgetReads } from "~/roam";
import { buildGraph, installFakeRoam, OTHER_PAGE, PAGE, U, type FakeApi, type FakeGraph } from "./fixtures";

let graph: FakeGraph;
let api: FakeApi;

beforeEach(() => {
  forgetReads();
  graph = buildGraph();
  api = installFakeRoam(graph);
  window.location.hash = `#/app/discourse-graphs/page/${PAGE}`;
});
afterEach(() => {
  unmountAll();
  document.body.innerHTML = "";
});

const render = async (argv: unknown[]): Promise<HTMLElement> => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    mount(el, argv);
  });
  await vi.waitFor(() => expect(el.textContent).not.toContain("Loading tasks"));
  return el;
};

const texts = (el: Element, section?: "primary" | "secondary"): string[] =>
  [...el.querySelectorAll(`${section ? `[data-section="${section}"] ` : ""}.rmt-text`)].map(
    (a) => a.textContent ?? "",
  );

const openSecondary = async (el: HTMLElement) => {
  const toggle = el.querySelector(".rmt-toggle") as HTMLElement;
  await act(async () => {
    toggle.click();
  });
  await vi.waitFor(() => expect(el.querySelector('[data-section="secondary"] .rmt-row')).toBeTruthy());
};

const host = (uid = "host") => ({ "block-uid": U(uid) });

describe("page mode", () => {
  it("finds every carried-over next action, across header wordings and wrappers", async () => {
    const el = await render([host(), "debug"]);
    const primary = texts(el, "primary").join(" | ");
    expect(primary).toMatch(/Trang Doan send team/); // plain TODO under **next actions**
    expect(primary).toMatch(/Karola Kirsanow track OKR 1/); // on-page ((ref)) wrapper
    expect(primary).toMatch(/Sid: create documentation/); // off-page ((ref)) wrapper
    expect(primary).toMatch(/backlog count over time/); // "Action items/for next time"
    expect(primary).toMatch(/old open item from three meetings ago/); // "Actions"
  });

  it("ages out a DONE item older than 14 days", async () => {
    const el = await render([host()]);
    await openSecondary(el);
    expect(texts(el).join(" ")).not.toMatch(/text selection bug/);
  });

  it("keeps prose 'next steps for...' at depth 3 out of the headers", async () => {
    const el = await render([host()]);
    expect(texts(el, "primary").join(" ")).not.toMatch(/buried task/);
    await openSecondary(el);
    expect(texts(el, "secondary").join(" ")).toMatch(/buried task under discussion/);
  });

  it("shows only real next-action items in the carried-over section", async () => {
    const el = await render([host()]);
    const primary = texts(el, "primary");
    expect(primary.length).toBe(5);
    for (const t of primary)
      expect(t).toMatch(/Trang Doan|Karola Kirsanow|Sid: create documentation|backlog count|old open item/);
  });

  it("strips markers and brackets from display text", async () => {
    const el = await render([host()]);
    await openSecondary(el);
    const all = texts(el).join(" ");
    expect(all).not.toMatch(/\{\{\[\[/);
    expect(all).not.toMatch(/\[\[|\]\]/);
  });

  it("shows a task carried across two meetings once", async () => {
    const el = await render([host()]);
    await openSecondary(el);
    expect(texts(el).filter((t) => /Trang Doan send team/.test(t))).toHaveLength(1);
  });

  it("collects tasks outside next-actions headers, and page-level inbox tasks", async () => {
    const el = await render([host()]);
    await openSecondary(el);
    const secondary = texts(el, "secondary").join(" | ");
    expect(secondary).toMatch(/not under a next-actions header/);
    expect(secondary).toMatch(/page-level inbox task/);
    expect(el.querySelector('[data-section="secondary"] [data-inbox="true"]')?.textContent).toBe("inbox");
  });

  it("reports the same diagnostics as the component it replaces", async () => {
    const el = await render([host(), "debug"]);
    const debug = el.querySelector(".rmt-debug")?.textContent ?? "";
    expect(debug).toContain("meetings=4"); // prose that cites a date is not a 5th
    expect(debug).toContain("lookback=120d(3/4 meetings)");
    expect(debug).toContain("headers=3");
    expect(debug).toContain("carried=6");
  });
});

describe("lookback window", () => {
  it("excludes a meeting older than 120 days, keeps old inbox work, and says so", async () => {
    const el = await render([host()]);
    await openSecondary(el);
    const all = texts(el).join(" ");
    expect(all).not.toMatch(/ancient item/);
    expect(all).toMatch(/page-level inbox task/);
    expect(el.querySelector(".rmt-footer")?.textContent).toBe("window 120d · 1 older meeting not shown");
  });

  it("widens with a bare number, and drops the footer once nothing is excluded", async () => {
    const el = await render([host(), "365"]);
    await openSecondary(el);
    expect(texts(el).join(" ")).toMatch(/ancient item from outside the window/);
    expect(el.querySelector(".rmt-footer")).toBeNull();
  });
});

describe("meeting mode (mounted inside the newest meeting)", () => {
  const mountInM1 = async () => {
    graph.add("hostInM1", "{{roam/render: ((CODE))}}");
    graph.blocks.get(U("m1"))!.children.unshift(U("hostInM1"));
    return render([host("hostInM1")]);
  };

  it("headlines the previous meeting's next actions", async () => {
    const el = await mountInM1();
    expect(texts(el, "primary")).toEqual(["MG to take a look at backlog count over time"]);
  });

  it("labels the section with the meeting's date text, without brackets", async () => {
    const el = await mountInM1();
    const headings = [...el.querySelectorAll(".rmt-heading")].map((h) => h.textContent);
    expect(headings[0]).toBe("From last meeting · Meeting two");
  });
});

describe("write-back", () => {
  it("writes {{[[DONE]]}} to the real task block, never to a ((ref)) wrapper", async () => {
    const el = await render([host()]);
    const row = [...el.querySelectorAll('[data-section="primary"] .rmt-row')].find((r) =>
      /Trang Doan/.test(r.textContent ?? ""),
    )!;
    const box = row.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => {
      box.click();
    });
    expect(api.data.block.update).toHaveBeenCalledTimes(1);
    const { block } = api.data.block.update.mock.calls[0][0];
    expect(block.uid).toBe(U("t1"));
    expect(block.string).toMatch(/^\{\{\[\[DONE\]\]\}\}/);
    expect(box.checked).toBe(true);
    expect(row.getAttribute("data-done")).toBe("true");
    expect(el.querySelector(".rmt-count")?.textContent).toBe("5 open items");
  });

  it("writes through a wrapper to an off-page target", async () => {
    const el = await render([host()]);
    const row = [...el.querySelectorAll('[data-section="primary"] .rmt-row')].find((r) =>
      /Sid: create documentation/.test(r.textContent ?? ""),
    )!;
    await act(async () => {
      (row.querySelector("input") as HTMLInputElement).click();
    });
    const { block } = api.data.block.update.mock.calls[0][0];
    expect(block.uid).toBe(U("t3off"));
    expect(block.string).toBe("next: {{[[TODO]]}} Sid: create documentation");
    expect(graph.blocks.get(U("t3off"))!.page).toBe(OTHER_PAGE);
  });

  it("puts the checkbox back when the write fails", async () => {
    api.data.block.update.mockRejectedValueOnce(new Error("offline"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = await render([host()]);
    const box = el.querySelector('[data-section="primary"] .rmt-row input') as HTMLInputElement;
    const was = box.checked;
    await act(async () => {
      box.click();
    });
    await vi.waitFor(() => expect(box.checked).toBe(was));
    expect(errors).toHaveBeenCalled();
  });

  it("updates every widget showing the same task", async () => {
    const a = await render([host()]);
    const b = await render([host()]);
    const rowIn = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-section="primary"] .rmt-row')].find((r) =>
        /Trang Doan/.test(r.textContent ?? ""),
      )!;
    await act(async () => {
      (rowIn(a).querySelector("input") as HTMLInputElement).click();
    });
    expect((rowIn(b).querySelector("input") as HTMLInputElement).checked).toBe(true);
  });
});

describe("shift-click", () => {
  it("leaves a plain click alone, and opens the right sidebar on shift-click", async () => {
    const el = await render([host()]);
    const link = el.querySelector('[data-section="primary"] .rmt-text') as HTMLAnchorElement;
    const uid = link.getAttribute("href")!.split("/").pop();

    const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.addEventListener("click", (e) => e.preventDefault(), { once: true }); // keep jsdom from navigating
    link.dispatchEvent(plain);
    expect(api.ui.rightSidebar.addWindow).not.toHaveBeenCalled();

    const shifted = new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true });
    await act(async () => {
      link.dispatchEvent(shifted);
    });
    expect(shifted.defaultPrevented).toBe(true);
    expect(api.ui.rightSidebar.addWindow).toHaveBeenCalledWith({
      window: { type: "block", "block-uid": uid },
    });
    expect(api.ui.rightSidebar.open).toHaveBeenCalled();
  });
});

describe("what changed in the port", () => {
  it("renders nothing, not an error, on a page with no meetings", async () => {
    window.location.hash = "#/app/discourse-graphs/page/EMPTYxxxx";
    const el = await render([{ "block-uid": "nope" }]);
    expect(el.textContent).toBe("");
  });

  it("shares page-wide reads between widgets on the same page", async () => {
    await render([host()]);
    await render([host()]);
    await render([host(), "365"]);
    const titlePulls = api.data.async.pull.mock.calls.filter(([, eid]) => eid[0] === ":node/title");
    // .sticky, TODO and DONE once each, not once per widget
    expect(titlePulls.map(([, eid]) => eid[1]).sort()).toEqual([".sticky", "DONE", "TODO"]);
  });

  it("does not read or render the collapsed section until it is opened", async () => {
    const el = await render([host()]);
    expect(el.querySelector('[data-section="secondary"]')).toBeNull();
    expect(el.querySelector(".rmt-toggle")?.textContent).toBe("▸ 3 Other tasks on this page");
    await openSecondary(el);
    expect(texts(el, "secondary")).toHaveLength(3);
  });

  it("follows a chain of ((ref)) wrappers to the task", async () => {
    graph.add("wrapA", `((${U("wrapB")}))`);
    graph.add("wrapB", `((${U("deep")}))`, [], { page: OTHER_PAGE });
    graph.add("deep", "{{[[TODO]]}} task two refs away", [], { page: OTHER_PAGE });
    graph.blocks.get(U("m1na"))!.children.push(U("wrapA"));
    const el = await render([host()]);
    expect(texts(el, "primary")).toContain("task two refs away");
  });

  it("resolves refs inside refs in the display text", async () => {
    graph.add("outer", `{{[[TODO]]}} ((${U("mid")})) -- ongoing`);
    graph.add("mid", `{{[[DONE]]}} ((${U("inner")}))`, [], { page: OTHER_PAGE });
    graph.add("inner", "Has anyone compared the intensities?", [], { page: OTHER_PAGE });
    graph.blocks.get(U("m1na"))!.children.push(U("outer"));
    const el = await render([host()]);
    expect(texts(el, "primary")).toContain("Has anyone compared the intensities? -- ongoing");
  });

  it("falls back to the date-reference query on a page without #.sticky", async () => {
    for (const b of graph.blocks.values()) b.string = b.string.replace(" #.sticky", "");
    const el = await render([host(), "debug"]);
    expect(api.data.async.q).toHaveBeenCalledTimes(1);
    // Without #.sticky the dated prose block counts as a meeting too, as before.
    expect(el.querySelector(".rmt-debug")?.textContent).toContain("meetings=5");
  });
});
