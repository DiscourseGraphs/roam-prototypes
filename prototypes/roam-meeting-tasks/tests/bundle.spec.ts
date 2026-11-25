/* Load the BUILT bundle the way a roam/js block does.
 *
 * Unit tests test the source; only this tests the artifact. The failure it
 * guards against is invisible to vitest: esbuild's ESM output gives a default
 * import of a CommonJS module the shape `{ default: fn }`, so code that passes
 * every unit test can throw at load. So this imports dist/extension.js into
 * jsdom with Roam's host globals supplied, runs onload exactly as the roam/js
 * loader block does (extensionAPI undefined), renders a widget through the
 * public surface the shim uses, and unloads.
 *
 * Skips when dist/ has not been built yet: run `pnpm build` first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildGraph, installFakeRoam, U } from "./fixtures";

const BUNDLE = join(process.cwd(), "dist", "extension.js");
const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

/* Permissive stand-in for host libraries the bundle destructures lazily
 * (Blueprint, RoamLazy, …): any property access or call yields another
 * proxy, so module-scope destructuring never throws. */
const anyProxy = (): any =>
  new Proxy(function () {}, {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : anyProxy()),
    set: () => true,
    apply: () => anyProxy(),
    construct: () => anyProxy(),
  });

describe.skipIf(!existsSync(BUNDLE))("built bundle", () => {
  const w = window as any;
  afterAll(() => {
    for (const k of ["React", "ReactDOM", "Blueprint", "RoamLazy", "TSLib", "Nanoid", "roamAlphaAPI"])
      delete w[k];
  });

  it("loads via import(), renders a widget, and unloads cleanly", async () => {
    w.React = React;
    // Roam's window.ReactDOM is one object carrying both APIs.
    w.ReactDOM = { ...ReactDOM, createRoot: ReactDOMClient.createRoot };
    w.Blueprint = anyProxy();
    w.RoamLazy = anyProxy();
    w.TSLib = anyProxy();
    w.Nanoid = anyProxy();
    const graph = buildGraph();
    const source = graph.blocks.get(U("host"))!;
    source.string = "{{meeting-tasks: 365, page, debug}} (if you are seeing this block, enable it here: ((setupuid1)))";
    installFakeRoam(graph);
    const fixture = document.createElement("div");
    fixture.innerHTML = `<div class="roam-block" id="block-input-${source.uid}"><button class="bp3-button rm-xparser-default-meeting-tasks">meeting-tasks</button> (if you are seeing this block, enable it here: <a href="#setupuid1">Setup</a>)</div>`;
    document.body.append(fixture);
    const original = fixture.firstElementChild as HTMLElement;
    expect(getComputedStyle(original).display).not.toBe("none");

    const module = await import(/* @vite-ignore */ BUNDLE);
    const extension = module.default;
    expect(typeof extension?.onload).toBe("function");

    // Exactly what the roam/js loader block passes. runExtension's onload
    // returns void, not the load promise, so wait for the public surface.
    extension.onload({ extensionAPI: undefined, extension: { version: "roam/js" } });
    await vi.waitFor(() => expect(w.roamMeetingTasks).toBeTruthy());
    expect(w.roamMeetingTasks.version).toBe(version);
    expect(w.roamMeetingTasks.shim).toMatch(/^```javascript\nfunction dgMeetingTasks\(props\)/);
    expect(document.getElementById("roam-meeting-tasks-style")).toBeTruthy();
    await vi.waitFor(() => expect(fixture.querySelector(".rmt-count")).toBeTruthy());
    expect(getComputedStyle(original).display).toBe("none");

    // Roam may reuse its button when the surrounding block is edited.
    source.string = "{{meeting-tasks}} Related notes";
    original.lastChild!.textContent = " Related notes";
    await vi.waitFor(() => expect(getComputedStyle(original).display).not.toBe("none"));
    expect(original.querySelector(".rmt-macro-host")).toBeTruthy();
    expect(getComputedStyle(original.querySelector("button")!).display).toBe("none");

    const host = document.createElement("div");
    document.body.appendChild(host);
    w.roamMeetingTasks.mount(host, [{ "block-uid": U("host") }]);
    await vi.waitFor(() => expect(host.querySelector(".rmt-count")?.textContent).toMatch(/open items/));

    await act(async () => {
      await extension.onunload();
    });
    expect(w.roamMeetingTasks).toBeUndefined();
    expect(document.getElementById("roam-meeting-tasks-style")).toBeNull();
    expect(host.innerHTML).toBe("");
    expect(fixture.querySelector(".rmt-macro-host")).toBeNull();
    expect(getComputedStyle(original.querySelector("button")!).display).not.toBe("none");
    expect(original.querySelector("a")?.getAttribute("href")).toBe("#setupuid1");
  });
});
