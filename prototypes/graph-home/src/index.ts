import { render, unmountComponentAtNode } from "react-dom";
import { runExtension } from "roamjs-components/util";
import { createElement } from "react";
import { Home, HOME_TITLE } from "./Home";
import "./styles.css";

const ACTIVE_CLASS = "dg-graph-home-active";

export default runExtension(async () => {
  let mounted: { page: HTMLElement; root: HTMLDivElement } | undefined;

  const unmount = (): void => {
    if (!mounted) return;
    mounted.page.classList.remove(ACTIVE_CLASS);
    unmountComponentAtNode(mounted.root);
    mounted.root.remove();
    mounted = undefined;
  };

  const sync = (): void => {
    const article = document.querySelector<HTMLElement>(
      ".roam-main .roam-article",
    );
    const title = article?.querySelector(".rm-title-display");
    const homePage = title?.textContent?.trim() === HOME_TITLE ? article : null;
    if (mounted?.page === homePage && mounted?.root.isConnected) return;
    unmount();
    if (!homePage || !title) return;

    const root = document.createElement("div");
    root.className = "dg-graph-home";
    const heading = title.closest(".rm-title-display-container") ?? title;
    heading.after(root);
    mounted = { page: homePage, root };
    render(createElement(Home), root);
    homePage.classList.add(ACTIVE_CLASS);
  };

  const observer = new MutationObserver(sync);
  sync();
  observer.observe(document.querySelector(".roam-main") ?? document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return {
    unload: () => {
      observer.disconnect();
      unmount();
    },
  };
});
