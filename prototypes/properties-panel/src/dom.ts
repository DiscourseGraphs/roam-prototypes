/* DOM-only helpers shared by the panel UI and the mount machinery. */

import type * as ReactDOMType from "react-dom";
import ReactDOM from "react-dom";

/** Module-scoped mutable handles shared across ui/actions/mount. */
export const refs: {
  hiddenBlockEl: HTMLElement | null;
  panelHost: HTMLElement | null;
  actionsHost: HTMLElement | null;
  actionsCtx: {
    pageUid: string;
    pageTitle: string;
    nodeType: string;
    propertiesBlockUid: string;
  } | null;
} = {
  hiddenBlockEl: null,
  panelHost: null,
  actionsHost: null,
  actionsCtx: null,
};

export const blockDomContainer = (uid: string): HTMLElement | null => {
  // The properties block can also render inside query results, linked
  // references, or embeds — prefer the main-article copy (after a reload
  // the reference copies sometimes render first).
  const candidates = Array.from(
    document.querySelectorAll(`.roam-article div[id$="${uid}"]`),
  );
  const input =
    candidates.find(
      (el) =>
        !el.closest(
          ".rm-reference-main, .rm-inline-references, .rm-embed-container, .rm-query, .rm-block-ref",
        ),
    ) ||
    candidates[0] ||
    null;
  return input ? (input.closest(".rm-block") as HTMLElement | null) : null;
};

/**
 * Remove EVERY panel/actions host in the document, tracked or not. A Roam
 * re-render can detach and recreate block DOM around a mounted host,
 * orphaning it from our tracking — sweeping by id makes mounting
 * idempotent no matter what survived the re-render.
 */
export const removeStrayHosts = (): void => {
  for (const el of Array.from(
    document.querySelectorAll("#dg-props-panel-host, #dg-props-actions"),
  )) {
    try {
      (ReactDOM as typeof ReactDOMType & {
        unmountComponentAtNode: (el: Element) => void;
      }).unmountComponentAtNode(el);
    } catch (e) {
      /* not a react root; fine */
    }
    el.remove();
  }
};
