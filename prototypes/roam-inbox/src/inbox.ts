/* The inbox's state: who I am, the three lists, and which messages I have
 * already acknowledged. Everything that renders subscribes here and repaints
 * itself when the lists change.
 */
import { addressFor, SEEN_MAX } from "~/config";
import { fetchList, graphName, type Identity, type Message, Q_OPEN_REFS, Q_OPEN_TODOS } from "~/roam";

export type Me = Identity & { address: string };

const empty = () => ({
  me: null as Me | null,
  messages: [] as Message[],
  mentions: [] as Message[],
  tasks: [] as Message[],
});

export const state = empty();

export const setIdentity = (me: Identity): Me => (state.me = { ...me, address: addressFor(me.name) });

export const myAddress = (): string | null => state.me?.address ?? null;

// ---------------------------------------------------------------- listeners

const listeners = new Set<() => void>();

/* Called after every change to the lists or the seen set. */
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = (): void => listeners.forEach((fn) => fn());

// -------------------------------------------------------------------- lists

let refreshSeq = 0;

/* Re-query the graph. Two queries: everything open that references `+Me`,
 * split into messages (with a TODO) and mentions (without), and open TODOs
 * that reference `Me` (the /task channel). A refresh that finishes after a
 * newer one started, or after unload, drops its result. */
export const refreshLists = async (): Promise<void> => {
  const me = state.me;
  if (!me) return;
  const mine = ++refreshSeq;
  const [addressed, named] = await Promise.all([
    fetchList(Q_OPEN_REFS, me.address),
    fetchList(Q_OPEN_TODOS, me.name),
  ]);
  if (mine !== refreshSeq || state.me !== me) return;
  state.messages = addressed.filter((m) => m.todo);
  state.mentions = addressed.filter((m) => !m.todo);
  state.tasks = named;
  notify();
};

// ------------------------------------------------------------------- seen set

/* "New" is tracked by message uid, NOT by timestamp.
 *
 * A message becomes addressed to you the moment someone edits a block to add
 * `[[+You]]`, and that block can be arbitrarily old: a bullet from last
 * month's meeting, a reply appended to a January thread. An earlier build
 * compared `:create/time` against a "last looked" clock, which made every one
 * of those arrive already read. Measured on dg-team: 65 open messages with
 * create-times spanning Dec 2024 to Jul 2026, so the whole standing backlog
 * was permanently uncountable and only a block born after your last panel
 * open could ever light the badge.
 *
 * `:edit/time` is not the fix either: it moves on every later typo fix, so
 * messages you had already dealt with would light up again. A set of uids
 * has neither failure mode.
 *
 * It lives in localStorage, not the graph: writing on every panel open would
 * churn edit-times and pollute the recency signals the team's weekly activity
 * review reads. The cost is that it is per-browser. */
let seen: Set<string> | null = null;

const seenKey = () => `roam-inbox:seen:${graphName()}:${state.me?.uid}`;
const legacyKey = () => `roam-inbox:lastSeen:${graphName()}:${state.me?.uid}`;

const saveSeen = (): void => {
  if (!seen) return;
  // Insertion-ordered, so trimming from the front drops the oldest.
  if (seen.size > SEEN_MAX) seen = new Set([...seen].slice(-SEEN_MAX));
  try {
    window.localStorage.setItem(seenKey(), JSON.stringify([...seen]));
  } catch {
    /* private mode; the badge just will not persist across reloads */
  }
};

export const loadSeen = (): Set<string> => {
  if (seen) return seen;
  try {
    const raw = window.localStorage.getItem(seenKey());
    if (raw != null) {
      seen = new Set(JSON.parse(raw) as string[]);
      return seen;
    }
  } catch {
    /* private mode, or a corrupt value: re-seed below */
  }
  // A fresh browser, or an upgrade from the lastSeen build: everything already
  // in the inbox is "not new to me", so the badge starts clean instead of at
  // the whole backlog. The panel still lists all of it.
  seen = new Set(state.messages.map((m) => m.uid));
  try {
    window.localStorage.removeItem(legacyKey());
  } catch {
    /* nothing to clean up */
  }
  saveSeen();
  return seen;
};

export const markSeen = (rows: Message[]): void => {
  const s = loadSeen();
  const before = s.size;
  rows.forEach((m) => s.add(m.uid));
  if (s.size === before) return;
  saveSeen();
  notify();
};

/* Self-addressed messages DO count. Measured on dg-team: 12 of the 68 open
 * messages are `[[+Self]]`, and they are deliberate personal todos, not
 * noise. Filtering them out silently under-reported those inboxes. What you
 * do not want is a toast for something you just typed; that exclusion lives
 * at the toast. */
export const unreadMessages = (): Message[] => {
  const s = loadSeen();
  return state.messages.filter((m) => !s.has(m.uid));
};

export const resetInbox = (): void => {
  seen = null;
  listeners.clear();
  Object.assign(state, empty());
};
