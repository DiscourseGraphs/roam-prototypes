/* The badge count, end to end through load(): fake graph in, unread count
 * out. The badge itself never mounts (no `.rm-topbar` in jsdom) and that is
 * deliberate: these pin the COUNT, which is the part that was wrong.
 */
import { afterEach, describe, expect, it } from "vitest";
import { refreshLists, state, subscribe } from "~/inbox";
import { debug, load, unload } from "~/lifecycle";
import { installFakeRoam, ME, row } from "./fixtures";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SEEN_KEY = "roam-inbox:seen:dg-team:uid-me";
const LEGACY_KEY = "roam-inbox:lastSeen:dg-team:uid-me";

const loadWith = async (addressed: unknown[][], storage: Record<string, string> = {}) => {
  window.localStorage.clear();
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  installFakeRoam({ addressed });
  await load();
};

const msg = (uid: string, text: string, createTime: number, author: string) =>
  row(uid, `{{[[TODO]]}} [[+${ME}]] ${text}`, createTime, author);

afterEach(() => {
  unload();
  window.localStorage.clear();
});

describe("unread count", () => {
  const now = Date.now();

  /* The bug this file exists for. A message is "new" when it becomes addressed
   * to you, which is an EDIT to a block that may be arbitrarily old. Keying
   * off `:create/time` means an address added to last month's bullet is born
   * already read. Measured on dg-team: every one of the 65 open messages had
   * a create-time older than any plausible lastSeen, so the badge was pinned
   * at zero and only a brand-new block could ever light it up. */
  it("counts an address added to a month-old block as new", async () => {
    await loadWith([msg("blk-old-1", "^above", now - 30 * DAY, "Joel Chan")], {
      [SEEN_KEY]: JSON.stringify([]),
    });
    expect(debug().unreadCount).toBe(1);
  });

  it("counts a brand-new message as new", async () => {
    await loadWith([msg("blk-fresh", "can you read me?", now - MINUTE, "Michael Gartner")], {
      [SEEN_KEY]: JSON.stringify([]),
    });
    expect(debug().unreadCount).toBe(1);
  });

  /* Opening the panel records the uid; later edits to the same block (a typo
   * fix, a reply appended) must not re-light the badge. */
  it("does not count an already-seen message", async () => {
    await loadWith([msg("blk-seen", "older news", now - 2 * DAY, "Sid")], {
      [SEEN_KEY]: JSON.stringify(["blk-seen"]),
    });
    expect(debug().unreadCount).toBe(0);
  });

  it("starts a fresh browser at zero, not at the backlog, and seeds the seen set", async () => {
    await loadWith([
      msg("blk-a", "backlog one", now - 200 * DAY, "Trang Doan"),
      msg("blk-b", "backlog two", now - 100 * DAY, "Sid"),
    ]);
    expect(debug().unreadCount).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(SEEN_KEY) || "[]").sort()).toEqual(["blk-a", "blk-b"]);
  });

  it("starts clean when upgrading from the lastSeen build", async () => {
    await loadWith([msg("blk-old-2", "pre-upgrade", now - 50 * DAY, "Karola Kirsanow")], {
      [LEGACY_KEY]: String(now - HOUR),
    });
    expect(debug().unreadCount).toBe(0);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  /* 12 of the 68 measured on dg-team were `[[+Self]]` personal todos, and
   * filtering them under-reported those inboxes. */
  it("counts self-addressed messages", async () => {
    await loadWith([msg("blk-self", "remind myself", now - 10 * MINUTE, "me")], {
      [SEEN_KEY]: JSON.stringify([]),
    });
    expect(debug().unreadCount).toBe(1);
  });

  /* Messages and mentions come from one query and are told apart by the
   * TODO reference; only messages badge. */
  it("does not count a mention without a checkbox", async () => {
    await loadWith(
      [
        row("blk-cc", `[[+${ME}]] fyi`, now - MINUTE, "Sid", { todo: false }),
        msg("blk-msg", "please", now - MINUTE, "Sid"),
      ],
      { [SEEN_KEY]: JSON.stringify([]) },
    );
    const d = debug();
    expect(d.unreadCount).toBe(1);
    expect(d.counts).toEqual({ messages: 1, mentions: 1, tasks: 0 });
  });

  it("reports what the badge should show", async () => {
    await loadWith([msg("blk-x", "x", now - MINUTE, "Sid")], { [SEEN_KEY]: JSON.stringify([]) });
    const d = debug();
    expect(d.badge).toBe("blue 1");
    expect(d.me).toBe(ME);
    expect(d.watching).toBe(`+${ME}`);
    expect(d.pullWatchActive).toBe(true);
  });
});

describe("lifecycle", () => {
  it("exposes and then removes the console surface", async () => {
    await loadWith([]);
    expect(window.roamInbox?.version).toBeTruthy();
    expect(document.getElementById("roam-inbox-style")).toBeTruthy();
    unload();
    expect(window.roamInbox).toBeUndefined();
    expect(document.getElementById("roam-inbox-style")).toBeNull();
  });

  it("still loads /message when the user has no display page", async () => {
    installFakeRoam({ me: null });
    await load();
    expect(window.roamInbox).toBeTruthy();
    expect(debug().me).toBeNull();
    expect(debug().badge).toBe("hidden");
  });

  it("notifies subscribers after a refresh and drops a refresh that lands after unload", async () => {
    await loadWith([]);
    let notified = 0;
    subscribe(() => notified++);
    await refreshLists();
    expect(notified).toBe(1);
    const pending = refreshLists();
    unload();
    await pending;
    expect(state.me).toBeNull();
    expect(notified).toBe(1);
  });
});
