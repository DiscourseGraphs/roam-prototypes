/* The shim evaluated the way Roam evaluates a roam/render code block: as a
 * plain script that defines a global function, which is then rendered by a
 * React tree the extension does not own. */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_CLASS, GLOBAL_KEY, HOST_CLASS, QUEUE_KEY } from "~/config";
import { load, unload } from "~/lifecycle";
import { forgetReads } from "~/roam";
import { SHIM_BLOCK, SHIM_FUNCTION, SHIM_SOURCE } from "~/shim";
import { buildGraph, installFakeRoam, U } from "./fixtures";

const w = window as unknown as Record<string, unknown>;

// What Roam does with the block: evaluate it, then look the name up.
type RenderProps = { args?: unknown[] };
const evaluateShim = (): React.FunctionComponent<RenderProps> =>
  new Function(`${SHIM_SOURCE}; return ${SHIM_FUNCTION};`)();

// Roam's own tree, standing in for the block that holds the render. Roam
// mounts the shim function as a component with props { args }, as its React
// fibers on dg-team show.
const roamRoots: Root[] = [];
const renderAsRoamWould = async (props: RenderProps, shim = evaluateShim()) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roamRoots.push(root);
  await act(async () => {
    root.render(React.createElement(shim, props));
  });
  return { container, root, shim };
};

beforeEach(() => {
  forgetReads();
  installFakeRoam(buildGraph());
  w.React = React;
});
afterEach(() => {
  for (const r of roamRoots.splice(0)) act(() => r.unmount());
  unload();
  delete w[QUEUE_KEY];
  document.body.innerHTML = "";
});

describe("the roam/render shim", () => {
  it("is a plain ES5 script Roam can evaluate", () => {
    expect(SHIM_SOURCE).not.toMatch(/=>|\bconst\b|\blet\b|`|\bimport\b|useState|useEffect/);
    expect(SHIM_BLOCK.startsWith("```javascript\n")).toBe(true);
    expect(typeof evaluateShim()).toBe("function");
  });

  it("parks its host and shows a note when the extension has not loaded", async () => {
    const { container: root } = await renderAsRoamWould({ args: [{ "block-uid": U("host") }] });
    const queue = w[QUEUE_KEY] as { el: Element }[];
    expect(queue).toHaveLength(1);
    expect(queue[0].el.className).toBe(HOST_CLASS);
    expect(root.querySelector(`.${FALLBACK_CLASS}`)?.textContent).toMatch(/waiting for the roam-meeting-tasks extension/);
  });

  it("is picked up when the extension loads later", async () => {
    const { container: root } = await renderAsRoamWould({ args: [{ "block-uid": U("host") }] });
    await act(async () => {
      load();
    });
    await expect.poll(() => root.querySelector(".rmt-count")?.textContent).toMatch(/open items/);
    expect(w[QUEUE_KEY]).toBeUndefined();
    // The note is still in the DOM but hidden by the extension's stylesheet.
    expect(document.getElementById("roam-meeting-tasks-style")?.textContent).toContain(
      `.${FALLBACK_CLASS} { display: none; }`,
    );
  });

  it("mounts straight away when the extension is already loaded", async () => {
    load();
    const { container: root } = await renderAsRoamWould({ args: [{ "block-uid": U("host") }] });
    await expect.poll(() => root.querySelector(".rmt-count")?.textContent).toMatch(/open items/);
    expect(w[QUEUE_KEY]).toBeUndefined();
  });

  it("keeps the widget's state when Roam re-renders the block", async () => {
    load();
    const props = { args: [{ "block-uid": U("host") }] };
    const { container, root, shim } = await renderAsRoamWould(props);
    await expect.poll(() => container.querySelector(".rmt-toggle")).toBeTruthy();
    await act(async () => {
      (container.querySelector(".rmt-toggle") as HTMLElement).click();
    });
    // Roam re-renders the block: the shim runs again with a new ref callback.
    await act(async () => {
      root.render(React.createElement(shim, { ...props }));
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('[data-section="secondary"]')).toBeTruthy();
  });

  it("is unmounted when Roam removes the block", async () => {
    load();
    const { root } = await renderAsRoamWould({ args: [{ "block-uid": U("host") }] });
    const mounted = () => (w[GLOBAL_KEY] as { debug: () => { mounted: number } }).debug().mounted;
    await expect.poll(mounted).toBe(1);
    await act(async () => {
      root.unmount();
    });
    await expect.poll(mounted).toBe(0);
  });
});
