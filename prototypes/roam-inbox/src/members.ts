/* Who the picker offers. Cached, refreshed in the background. */
import { logError, MEMBER_CACHE_MS } from "~/config";
import { allMembers, recentlyActiveMembers } from "~/roam";

export type Members = { active: string[]; all: string[]; at: number };

let cache: Members | null = null;
let inFlight: Promise<Members> | null = null;

const quietly = (what: string) => (e: unknown) => {
  logError(what, e);
  return [] as string[];
};

const refresh = (): Promise<Members> => {
  if (!inFlight) {
    inFlight = Promise.all([
      allMembers().catch(quietly("member query failed")),
      recentlyActiveMembers().catch(quietly("activity query failed")),
    ])
      .then(([all, active]) => (cache = { all, active: active.length ? active : all, at: Date.now() }))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
};

/* Fill the cache ahead of the first /message so the picker opens instantly. */
export const warmMembers = (): void => {
  void refresh();
};

/* Serves the cache immediately and refreshes it behind the scenes when it is
 * stale. A cold cache waits only for the cheap member list; the whole-graph
 * activity scan fills in the "recently active" order when it lands. */
export const getMembers = async (): Promise<Members> => {
  if (!cache) {
    const all = await allMembers().catch(quietly("member query failed"));
    cache = { all, active: all, at: 0 };
  }
  if (Date.now() - cache.at >= MEMBER_CACHE_MS) warmMembers();
  return cache;
};

export const resetMembers = (): void => {
  cache = null;
};
