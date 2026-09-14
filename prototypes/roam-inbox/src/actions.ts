/* What the panel's row buttons do to the graph. */
import { logError, replyStubFor } from "~/config";
import { findTextarea, typeInto } from "~/editor";
import { blockString, createChildBlock, focusBlock, type Message, openInSidebar, updateBlock } from "~/roam";
import { toggleDone } from "~/text";

export const open = (uid: string): void => {
  void openInSidebar(uid).catch((e) => logError("could not open sidebar", e));
};

export const markDone = async (uid: string): Promise<void> => {
  // If the row is also open in an editor (common: you clicked Open first),
  // write through the textarea so the closing editor cannot flush its stale
  // value back over the check-off. Same trap as the picker's insert.
  const ta = findTextarea(uid);
  const next = toggleDone(ta ? ta.value : await blockString(uid));
  if (!next) return;
  if (ta) typeInto(ta, next, next.length);
  else await updateBlock(uid, next);
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const replyTo = async (row: Message): Promise<void> => {
  // Open the thread in the sidebar before focusing: a block that is not
  // mounted cannot take focus, and the sidebar is where the reply is read.
  const [childUid] = await Promise.all([
    createChildBlock(row.uid, replyStubFor(row.author)),
    openInSidebar(row.uid),
  ]);
  await sleep(350);
  const ta = findTextarea(childUid);
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return;
  }
  await focusBlock(childUid).catch(() => {
    /* the stub is in the sidebar; the user can click it */
  });
};
