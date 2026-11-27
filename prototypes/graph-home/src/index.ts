import { createElement, Fragment } from "react";
import { render } from "react-dom";
import { runExtension } from "roamjs-components/util";
import { Home, HOME_TITLE } from "./Home";
import "./styles.css";

const ACTIVE_CLASS = "dg-graph-home-active";

export default runExtension(async () => {
  const root = document.createElement("div");
  root.className = "dg-graph-home";
  let mountedPage: HTMLElement | null = null;

  const clearPage = (): void => {
    mountedPage?.classList.remove(ACTIVE_CLASS);
    mountedPage = null;
  };

  const sync = (): void => {
    const article = document.querySelector<HTMLElement>(
      ".roam-main .roam-article",
    );
    const title = article?.querySelector(".rm-title-display");
    const homePage = title?.textContent?.trim() === HOME_TITLE ? article : null;
    if (mountedPage === homePage && (!homePage || root.isConnected)) return;
    if (mountedPage) {
      clearPage();
      // Clear the page UI while keeping the root registered for extension unload.
      render(createElement(Fragment), root);
      root.remove();
    }
    if (!homePage || !title) return;

    const heading = title.closest(".rm-title-display-container") ?? title;
    heading.after(root);
    render(createElement(Home), root);
    homePage.classList.add(ACTIVE_CLASS);
    mountedPage = homePage;
  };

  const observer = new MutationObserver(sync);
  sync();
  observer.observe(document.querySelector(".roam-main") ?? document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return { reactRoots: [root], observers: [observer], unload: clearPage };
});
