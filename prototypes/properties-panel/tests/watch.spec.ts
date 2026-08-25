/* watchBlock is how external writes (issuesync's Linear:: writeback, agents,
 * collaborators) reach the panel without navigation. Two things are worth
 * pinning: removal must pass the IDENTICAL (pattern, eid, handler) triple —
 * Roam matches watches structurally, and a mismatched removePullWatch leaks
 * the watch silently — and a Roam build without pull watches must degrade to
 * a no-op instead of throwing at panel mount. */
import { afterEach, describe, expect, it } from "vitest";
import { watchBlock } from "~/graph";

const w = window as any;

afterEach(() => {
  delete w.roamAlphaAPI;
});

describe("watchBlock", () => {
  it("registers and unregisters with the identical pattern/eid/handler triple", () => {
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    w.roamAlphaAPI = {
      data: {
        addPullWatch: (...args: unknown[]) => added.push(args),
        removePullWatch: (...args: unknown[]) => removed.push(args),
      },
    };
    const unwatch = watchBlock("abc123XYZ", () => {});
    expect(added).toHaveLength(1);
    expect(added[0][1]).toBe('[:block/uid "abc123XYZ"]');
    unwatch();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toEqual(added[0]);
  });

  it("fires the callback when the watch reports a change", () => {
    let watchHandler: (() => void) | null = null;
    w.roamAlphaAPI = {
      data: {
        addPullWatch: (_p: string, _e: string, h: () => void) => {
          watchHandler = h;
        },
        removePullWatch: () => {},
      },
    };
    let fired = 0;
    watchBlock("abc123XYZ", () => fired++);
    watchHandler!();
    watchHandler!();
    expect(fired).toBe(2);
  });

  it("degrades to a no-op without pull-watch support", () => {
    w.roamAlphaAPI = { data: {} };
    const unwatch = watchBlock("abc123XYZ", () => {});
    expect(() => unwatch()).not.toThrow();
  });
});
