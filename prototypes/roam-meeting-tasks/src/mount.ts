/* The bridge between Roam's roam/render blocks and this extension.
 *
 * Roam has no API for registering an inline component (registerComponent is
 * for whole main-window views), so `{{roam/render: ((uid))}}` stays the way a
 * widget is placed. The code block it points at is a small shim (shim.ts)
 * that renders an empty host element and hands it here. Each host gets its
 * own React root, so the widget has ordinary state and effects: the shim
 * never runs any of the widget's code during Roam's render.
 */
import React from "react";
import ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import { parseArgs } from "~/args";
import { logError } from "~/config";
import { MeetingTasks } from "~/view";

type Root = { render: (node: React.ReactElement) => void; unmount: () => void };

/* Roam ships React 18 (18.2 as of September 2026), so each widget gets a
 * createRoot root. The legacy render API is the fallback for older hosts. */
const createRoot = (el: Element): Root => {
  const client = ReactDOMClient as unknown as { createRoot?: (el: Element) => Root };
  if (typeof client.createRoot === "function") return client.createRoot(el);
  const legacy = ReactDOM as unknown as {
    render: (node: React.ReactElement, el: Element) => void;
    unmountComponentAtNode: (el: Element) => boolean;
  };
  return {
    render: (node) => legacy.render(node, el),
    unmount: () => void legacy.unmountComponentAtNode(el),
  };
};

const roots = new Map<Element, Root>();

const unmountHost = (el: Element): void => {
  try {
    roots.get(el)?.unmount();
  } catch (error) {
    logError("could not unmount a widget", error);
  }
  roots.delete(el);
};

/* Render (or re-render in place) the widget into a host element. Roam calls
 * the shim again whenever it re-renders the block; rendering into the same
 * root updates it, so state such as an opened section and the loaded data
 * survive. */
export const mount = (el: Element, argv: unknown): void => {
  const args = parseArgs(Array.isArray(argv) ? argv : []);
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(React.createElement(MeetingTasks, { args }));
};

/* The shim lets go of a host. It may be re-attaching the same element on its
 * next render, so only unmount once the element has really left the page.
 * The delay also keeps the unmount out of React's own commit phase. */
export const release = (el: Element): void => {
  window.setTimeout(() => {
    if (!el.isConnected) unmountHost(el);
  }, 0);
};

/* Roam can remove a block's DOM without the shim hearing about it. */
export const sweep = (): void => {
  for (const el of [...roots.keys()]) if (!el.isConnected) unmountHost(el);
};

export const unmountAll = (): void => {
  for (const el of [...roots.keys()]) unmountHost(el);
};

export const mountedCount = (): number => roots.size;
