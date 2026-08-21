/* The menu itself: clipboard writes and the popup.
 *
 * The popup is plain DOM with prototype-scoped classes rather than Roam's
 * Blueprint menu classes. Borrowing bp3-* would track Roam's Blueprint
 * version for styling this owns, and the repository asks prototypes not to
 * depend on host implementation classes. Appearance is matched in styles.css.
 */
import { render as renderToast } from "roamjs-components/components/Toast";
import { latexForTitle, labelForTitle } from "~/payload";
import { roamUrlForTitle, uidForTitle } from "~/graph";

export const ROOT_CLASS = "roam-prototype-copy-for-latex";
export const CLIPBOARD_FAIL_MESSAGE =
  "Could not write to the clipboard — nothing was copied.";

let toastSeq = 0;
export const toast = (message: string): void => {
  renderToast({
    id: `copy-for-latex-${(toastSeq += 1)}`,
    content: message,
    timeout: 6000,
  });
};

/* execCommand is deprecated but still the only path that works when the
 * document is not focused, which is exactly the case right after a
 * contextmenu in some browsers. */
const copyViaTextarea = (text: string): boolean => {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy") === true;
  } catch (e) {
    return false;
  } finally {
    ta.remove();
  }
};

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return copyViaTextarea(text);
  }
};

type MenuItem = { label: string; run: () => Promise<void> } | { divider: true };

let openMenuEl: HTMLElement | null = null;

export const closeMenu = (): void => {
  openMenuEl?.remove();
  openMenuEl = null;
};

export const getOpenMenu = (): HTMLElement | null => openMenuEl;

export const menuItemsFor = (
  title: string,
  opts: { omitJumpToPage?: boolean } = {},
): MenuItem[] =>
  (
    [
      {
        label: "Copy for LaTeX",
        run: async () => {
          const { latex, warning } = await latexForTitle(title);
          if (!latex) {
            // Nothing usable to copy — leave the clipboard untouched rather
            // than silently overwriting it with an empty string.
            if (warning) toast(warning);
            return;
          }
          const copied = await copyText(latex);
          if (!copied) toast(CLIPBOARD_FAIL_MESSAGE);
          else if (warning) toast(warning);
        },
      },
      {
        label: "Copy as hyperlink",
        run: async () => {
          const url = await roamUrlForTitle(title);
          const label = labelForTitle(title);
          const copied = await copyText(url ? `[${label}](${url})` : label);
          if (!copied) toast(CLIPBOARD_FAIL_MESSAGE);
        },
      },
      { divider: true as const },
      {
        label: "Jump to page",
        run: async () => {
          const uid = await uidForTitle(title);
          // The page can vanish between the right-click and the click.
          if (uid) await window.roamAlphaAPI.ui.mainWindow.openPage({ page: { uid } });
        },
      },
      {
        label: "Open in sidebar",
        run: async () => {
          const uid = await uidForTitle(title);
          if (uid)
            await window.roamAlphaAPI.ui.rightSidebar.addWindow({
              /* The typings declare "page-uid" for an outline window, but the
               * runtime wants "block-uid" — verified live, and the Discourse
               * Graph plugin suppresses the same error in seven places. Left
               * as ts-expect-error rather than a cast so this starts failing
               * the day roamjs-components corrects the type. */
              // @ts-expect-error stale roamjs-components typing
              window: { type: "outline", "block-uid": uid },
            });
        },
      },
    ] as MenuItem[]
  ).filter((item) => !(opts.omitJumpToPage && "label" in item && item.label === "Jump to page"));

export const openMenu = (
  title: string,
  x: number,
  y: number,
  opts: { omitJumpToPage?: boolean } = {},
): HTMLElement => {
  closeMenu();
  const menu = document.createElement("ul");
  menu.className = `${ROOT_CLASS} cfl-menu`;
  menuItemsFor(title, opts).forEach((item) => {
    const li = document.createElement("li");
    if ("divider" in item) {
      li.className = "cfl-menu-divider";
    } else {
      const a = document.createElement("a");
      a.className = "cfl-menu-item";
      a.textContent = item.label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        void item.run();
      });
      li.appendChild(a);
    }
    menu.appendChild(li);
  });

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  openMenuEl = menu;
  return menu;
};

/* A press on a menu item must not dismiss the menu, because that item's own
 * handler still has to run. */
export const shouldCloseOnPointer = (target: Node | null): boolean =>
  !(openMenuEl && target && openMenuEl.contains(target));
