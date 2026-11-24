import React from "react";
import { discussionDraftKey, postNativeComment } from "~/discussion-data";

type Draft = { text: string; posting: boolean; error: string; posted: boolean };
const blank = (): Draft => ({
  text: "",
  posting: false,
  error: "",
  posted: false,
});
const entries = new Map<string, Draft>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

const readDraft = (key: string): Draft => {
  const existing = entries.get(key);
  if (existing) return existing;
  const draft = blank();
  try {
    draft.text = sessionStorage.getItem(key) || "";
  } catch {
    /* Session storage is optional. */
  }
  entries.set(key, draft);
  return draft;
};
const saveText = (key: string, text: string): void => {
  try {
    if (text) sessionStorage.setItem(key, text);
    else sessionStorage.removeItem(key);
  } catch {
    /* The in-memory copy stays available. */
  }
};
export const clearDiscussionDrafts = (): void => {
  for (const [key, draft] of entries) if (!draft.posting) entries.delete(key);
};
export const useDiscussionDraft = (uid: string, kind: "thread" | "reply") => {
  const key = "roam-inbox:comment-draft:" + discussionDraftKey(uid);
  const [, redraw] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    listeners.add(redraw);
    redraw();
    return () => {
      listeners.delete(redraw);
    };
  }, [key]);
  const draft = readDraft(key);
  const edit = (text: string): void => {
    if (draft.posting) return;
    Object.assign(draft, { text, error: "", posted: false });
    saveText(key, text);
    notify();
  };
  const submit = async (): Promise<boolean> => {
    if (draft.posting || !draft.text.trim()) return false;
    Object.assign(draft, { posting: true, error: "", posted: false });
    notify();
    try {
      await postNativeComment({ uid, text: draft.text, kind });
      Object.assign(draft, { text: "", posted: true });
      saveText(key, "");
      return true;
    } catch (error) {
      draft.error =
        error instanceof Error
          ? error.message
          : "Could not confirm the post. Check the discussion before trying again.";
      return false;
    } finally {
      draft.posting = false;
      notify();
    }
  };
  return { draft, edit, submit };
};
