/* Mount machinery: find the current page's #.properties block, hide the
 * native subtree, and render the panel above it — idempotently, because
 * Roam re-renders can blow the host away at any time (hence the poll). */

import React from "react";
import ReactDOM from "react-dom";
import { CONFIG } from "~/config";
import { currentPageContext, findPropertiesBlock, loadRegistry, pullTreeByUid } from "~/graph";
import { blockDomContainer, refs, removeStrayHosts } from "~/dom";
import { actionRegistry, PanelRoot, TitleActions, type ActionSpec } from "~/ui";

const h = React.createElement;
const render = (ReactDOM as any).render as (el: unknown, host: Element) => void;

let currentMount: { pageUid: string | null } = { pageUid: null };

export const unmountAll = (): void => {
  removeStrayHosts(); // includes the tracked hosts, and any orphaned ones
  refs.panelHost = null;
  refs.actionsHost = null;
  if (refs.hiddenBlockEl) {
    refs.hiddenBlockEl.style.display = "";
    refs.hiddenBlockEl = null;
  }
  currentMount = { pageUid: null };
  refs.actionsCtx = null;
};

export const rerenderActions = (): void => {
  if (refs.actionsHost && document.contains(refs.actionsHost))
    render(h(TitleActions, { ctx: refs.actionsCtx }), refs.actionsHost);
};

export const registerAction = (spec: ActionSpec): (() => void) => {
  if (!spec || typeof spec.key !== "string" || typeof spec.mount !== "function")
    throw new Error(
      "dg-properties-panel registerAction needs { key: string, mount: function }",
    );
  actionRegistry.set(spec.key, spec);
  rerenderActions();
  return () => {
    actionRegistry.delete(spec.key);
    rerenderActions();
  };
};

let mounting = false;

export const mountForCurrentPage = async (): Promise<void> => {
  if (!CONFIG.defaultOn) return;
  if (mounting) return; // poll can fire while a previous pass still awaits
  mounting = true;
  try {
    const ctx = await currentPageContext();
    if (!ctx) return unmountAll();
    const { pageUid, pageTitle, type } = ctx;

    const pageTree = await pullTreeByUid(pageUid);
    const { block } = findPropertiesBlock(pageTree || { children: [] });
    if (!block) return unmountAll();

    const container = blockDomContainer(block.uid);
    if (!container) return; // DOM not ready; poll will retry

    // "Mounted" must mean mounted AGAINST THE CURRENT CONTAINER — after a
    // Roam re-render recreates the block DOM, a surviving host next to a
    // stale container reads as mounted by weaker checks, and the fresh
    // container gets a second panel.
    const alreadyMounted =
      currentMount.pageUid === pageUid &&
      refs.panelHost &&
      document.contains(refs.panelHost) &&
      refs.panelHost.nextElementSibling === container;
    if (alreadyMounted) return;
    unmountAll();

    const registry = await loadRegistry();

    refs.hiddenBlockEl = container;
    refs.panelHost = document.createElement("div");
    refs.panelHost.id = "dg-props-panel-host";
    container.parentElement!.insertBefore(refs.panelHost, container);
    render(h(PanelRoot, { pageUid, type, registry }), refs.panelHost);

    if (CONFIG.actionsAtTitle) {
      const titleEl = document.querySelector(".roam-article .rm-title-display");
      if (titleEl) {
        refs.actionsHost = document.createElement("div");
        refs.actionsHost.id = "dg-props-actions";
        titleEl.parentElement!.insertBefore(refs.actionsHost, titleEl.nextSibling);
        refs.actionsCtx = {
          pageUid,
          pageTitle,
          nodeType: type.name,
          propertiesBlockUid: block.uid,
        };
        render(h(TitleActions, { ctx: refs.actionsCtx }), refs.actionsHost);
      }
    }
    currentMount = { pageUid };
  } finally {
    mounting = false;
  }
};
