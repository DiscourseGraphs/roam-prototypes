/* The /message half: a person picker under the caret that turns the block
 * into `{{[[TODO]]}} [[+Name]] `. The picker is forked from roam-task-assign
 * (the /task command), as roam-feedback's was; see README.md. */
import { addressFor, insertFor, LABEL, logError, MAX_FILTER_LEN } from "~/config";
import { el, onPress } from "~/dom";
import { caretCoords, findTextarea, typeInto } from "~/editor";
import { getMembers } from "~/members";
import {
  blockString,
  ensurePage,
  focusBlock,
  registerSlashCommand,
  type SlashContext,
  updateBlock,
} from "~/roam";

let activePicker: (() => void) | null = null;

export const closePicker = (): void => {
  const fn = activePicker;
  activePicker = null;
  fn?.();
};

const openPicker = async ({ uid, windowId }: { uid: string; windowId?: string }): Promise<void> => {
  closePicker();
  const textarea = findTextarea(uid);
  if (!textarea) return;
  const triggerPosition = textarea.selectionStart;

  // Usually instant: the cache is warmed at load.
  const members = await getMembers();
  const live = findTextarea(uid);
  if (!live || document.activeElement !== live) return; // the user moved on
  const allLower = members.all.map((m) => m.toLowerCase());

  let filterText = "";
  let activeIndex = 0;

  const menu = el("div", "rmi-menu");
  const coords = caretCoords(live);
  menu.style.top = `${coords.top}px`;
  menu.style.left = `${coords.left}px`;
  document.body.appendChild(menu);
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
    if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
  });

  const filtered = (): string[] => {
    if (!filterText) return members.active;
    const needle = filterText.toLowerCase();
    return members.all.filter((_, i) => allLower[i].includes(needle));
  };

  // Moving the highlight touches two class lists, not the whole menu.
  const highlight = (): void => {
    menu.querySelectorAll(".rmi-item").forEach((item, i) => {
      item.classList.toggle("rmi-active", i === activeIndex);
    });
  };

  const renderList = (): void => {
    const items = filtered();
    if (activeIndex >= items.length) activeIndex = 0;
    menu.innerHTML = "";
    if (members.all.length === 0) menu.appendChild(el("div", "rmi-empty", "No graph members found"));
    else if (items.length === 0) menu.appendChild(el("div", "rmi-empty", "No matches"));
    else {
      items.forEach((name, i) => {
        const item = el("div", "rmi-item" + (i === activeIndex ? " rmi-active" : ""), name);
        onPress(item, () => select(name)); // mousedown keeps the textarea focused
        item.addEventListener("mouseenter", () => {
          activeIndex = i;
          highlight();
        });
        menu.appendChild(item);
      });
    }
    menu.appendChild(
      el(
        "div",
        "rmi-hint",
        filterText
          ? "message · searching all members · ↑↓ · Enter · Esc"
          : "message · recently active · type to search all · ↑↓ · Enter · Esc",
      ),
    );
  };

  const insertRecipient = async (name: string, liveEnd: number): Promise<void> => {
    // A recipient with no `+Name` page would otherwise be messageable only by
    // accident. Create it up front so the link and their pull watch resolve.
    const address = addressFor(name);
    await ensurePage(address).catch((e) => logError(`could not create ${address}`, e));

    const ta = findTextarea(uid);
    // The textarea is the live truth while editing; the store is not.
    const base = ta ? ta.value : await blockString(uid);
    const start = Math.min(triggerPosition, base.length);
    const end = Math.min(Math.max(liveEnd, start), base.length);
    let insert = insertFor(name);
    if (start > 0 && !/\s$/.test(base.slice(0, start))) insert = " " + insert;
    const newText = base.slice(0, start) + insert + base.slice(end);
    const cursor = start + insert.length;

    if (ta) {
      typeInto(ta, newText, cursor);
      return;
    }
    // The editor already closed, so nothing is left to clobber a store write.
    await updateBlock(uid, newText);
    await focusBlock(uid, windowId, cursor).catch(() => {
      /* the text landed; focus is a nicety */
    });
  };

  const select = (name: string): void => {
    const at = findTextarea(uid);
    const liveEnd = at ? at.selectionStart : triggerPosition + filterText.length;
    cleanup();
    void insertRecipient(name, liveEnd).catch((e) => logError("insert failed", e));
  };

  // Attached to DOCUMENT in the capture phase: Roam replaces the block's
  // textarea element when it strips the typed slash text, so listeners bound
  // to one textarea instance go stale and the menu turns inert. Resolve the
  // live textarea by uid on every event instead.
  const onKeydown = (e: KeyboardEvent): void => {
    const ta = findTextarea(uid);
    if (!ta || document.activeElement !== ta) {
      cleanup();
      return;
    }
    if (e.key === "Tab") {
      cleanup();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
      return; // let the keystroke through; it feeds the filter via input
    }
    const items = filtered();
    if (e.key === "ArrowDown" && items.length) {
      activeIndex = (activeIndex + 1) % items.length;
      highlight();
    } else if (e.key === "ArrowUp" && items.length) {
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      highlight();
    } else if (e.key === "Enter") {
      if (items.length) select(items[activeIndex]);
      else cleanup();
    } else if (e.key === "Escape") {
      cleanup();
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const onInput = (): void => {
    const ta = findTextarea(uid);
    if (!ta) {
      cleanup();
      return;
    }
    const sel = ta.selectionStart;
    if (sel < triggerPosition) {
      cleanup();
      return;
    }
    filterText = ta.value.substring(triggerPosition, sel);
    if (filterText.includes("\n") || filterText.length > MAX_FILTER_LEN) {
      cleanup();
      return;
    }
    renderList();
  };

  const onClickAway = (e: MouseEvent): void => {
    const target = e.target as Node;
    if (!menu.contains(target) && target !== findTextarea(uid)) cleanup();
  };

  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (activePicker === cleanup) activePicker = null;
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("mousedown", onClickAway, true);
    menu.remove();
  };
  activePicker = cleanup;

  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("mousedown", onClickAway, true);
  renderList();
};

/* Returning "" makes Roam remove the typed "/message..." text; the block
 * re-renders (often swapping in a NEW textarea element), so wait for the
 * strip to land before reading the caret. Detect it by watching the
 * textarea's own value change, NOT by waiting for the store to agree with
 * it: Roam defers the store write while the editor is open and that wait
 * can never finish. */
const slashCallback = (ctx: SlashContext): string => {
  const uid = ctx["block-uid"];
  if (!uid) return "";
  const windowId = ctx["window-id"];
  const before = findTextarea(uid)?.value;
  const tryOpen = (attempt: number): void => {
    const ta = findTextarea(uid);
    if (ta && document.activeElement === ta && ta.value !== before) {
      void openPicker({ uid, windowId }).catch((e) => logError("picker failed", e));
    } else if (attempt < 40) {
      setTimeout(() => tryOpen(attempt + 1), 50);
    }
  };
  setTimeout(() => tryOpen(0), 50);
  return "";
};

/* Registers /message. Returns the disposer, or null when Roam has no
 * slash-command API. */
export const registerMessageCommand = (): (() => void) | null => registerSlashCommand(LABEL, slashCallback);
