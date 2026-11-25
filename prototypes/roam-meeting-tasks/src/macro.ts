import { logError } from "~/config";
import { mount, release } from "~/mount";
import { readBlockText } from "~/roam";

const macro = /\{\{meeting-tasks(?:\s*:\s*([^{}]*))?\}\}/i;
const hint = /^\(if you(?: are|['’]re) seeing this (?:block|message),\s*enable (?:it|meeting tasks) here:\s*\(\([\w-]+\)\)\)$/i;
const blockSelector = ".roam-block";
const buttonSelector = "button.rm-xparser-default-meeting-tasks";
const hiddenClass = "rmt-native-macro";

export const observeMacros = (): (() => void) => {
  const entries = new Map<HTMLElement, { host: HTMLElement; original: HTMLElement }>();
  const pending = new Map<HTMLElement, symbol>();

  function remove(button: HTMLElement) {
    pending.delete(button);
    const entry = entries.get(button);
    if (entry) {
      entry.original.classList.remove(hiddenClass);
      entry.host.remove();
      release(entry.host);
      entries.delete(button);
    }
  }

  async function update(button: HTMLElement) {
    const block = button.closest<HTMLElement>(blockSelector);
    const uid = block?.closest<HTMLElement>(".roam-block-container")?.dataset.blockUid || block?.id.slice(-9);
    if (!block || !uid || !/^meeting[- ]tasks$/i.test(button.textContent?.trim() ?? "")) {
      remove(button);
      return;
    }
    const token = Symbol();
    pending.set(button, token);
    try {
      const source = await readBlockText(uid);
      if (pending.get(button) !== token || !button.isConnected) return;
      const match = macro.exec(source);
      if (!match) return remove(button);
      const suffix = source.slice(match.index + match[0].length).trim();
      // Only replace the entire text region when it consists of our macro and hint.
      const original = !source.slice(0, match.index).trim() && hint.test(suffix) ? block : button;
      let entry = entries.get(button);
      if (!entry || entry.original !== original || !entry.host.isConnected) {
        remove(button);
        const host = document.createElement("div");
        host.className = "rmt-macro-host";
        original.after(host);
        original.classList.add(hiddenClass);
        entry = { host, original };
        entries.set(button, entry);
      }
      mount(entry.host, [{ "block-uid": uid }, ...(match[1]?.trim().split(/[\s,]+/) ?? [])]);
    } catch (error) {
      if (pending.get(button) === token || !pending.has(button)) logError("could not load macro", error);
    } finally {
      if (pending.get(button) === token) pending.delete(button);
    }
  }

  function collect(node: Element, buttons: Set<HTMLElement>) {
    if (node.closest(".rmt-macro-host")) return;
    if (node instanceof HTMLElement && node.matches(buttonSelector)) buttons.add(node);
    node.querySelectorAll<HTMLElement>(buttonSelector).forEach(button => buttons.add(button));
  }

  const observer = new MutationObserver(records => {
    const buttons = new Set<HTMLElement>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".rmt-macro-host")) continue;
      const block = target?.closest(blockSelector);
      if (block) collect(block, buttons);
      for (const node of record.addedNodes) if (node instanceof Element) collect(node, buttons);
    }
    for (const button of [...entries.keys(), ...pending.keys()]) if (!button.isConnected) remove(button);
    for (const button of buttons) void update(button);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const initial = new Set<HTMLElement>();
  collect(document.body, initial);
  initial.forEach(button => void update(button));
  return () => {
    observer.disconnect();
    pending.clear();
    for (const button of entries.keys()) remove(button);
  };
};
