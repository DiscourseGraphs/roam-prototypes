import { describe, expect, it } from "vitest";
import type { Fixture } from "../src/core/kit";
import { buildStatus, recordFits, retryPlan, type SetupPlan } from "../src/roam/runner";

const loadedFor = (branch: string, pr: number | null, commit = "ac09d76aaaa", prHead: string | null = commit) => ({ branch, pr, commit, prHead });

const base = { mine: false, setup: false, loading: false, buildError: null };

describe("when a kit can run", () => {
  it("runs a kit that names no build on whatever is loaded", () => {
    expect(buildStatus({ ...base, config: { build: null, pr: null }, loaded: null }).blocked).toBeNull();
  });

  it("won't run a PR kit on another kit's build", () => {
    const status = buildStatus({ ...base, config: { build: null, pr: 9 }, loaded: loadedFor("eng-1-other", 1506) });
    expect(status.other).toBe(true);
    expect(status.blocked).toMatch(/reload on this page/);
  });

  it("runs a PR kit on the build loaded for it", () => {
    const status = buildStatus({ ...base, mine: true, config: { build: null, pr: 1506 }, loaded: loadedFor("eng-2348-x", 1506) });
    expect(status).toEqual({ wanted: "eng-2348-x", other: false, behind: null, blocked: null });
  });

  it("won't run while the build failed, is loading, or waits for setup", () => {
    const config = { build: "eng-2348-x", pr: null };
    expect(buildStatus({ ...base, config, loaded: null, buildError: "No build at …" }).blocked).toMatch(/didn't load/);
    expect(buildStatus({ ...base, config, loaded: null, loading: true }).blocked).toMatch(/still loading/);
    expect(buildStatus({ ...base, config, loaded: null, setup: true }).blocked).toMatch(/Set up and load/);
  });

  it("says when CI hasn't caught up with the PR head, and still runs", () => {
    const status = buildStatus({ ...base, mine: true, config: { build: null, pr: 1506 }, loaded: loadedFor("eng-2348-x", 1506, "ac09d76aaaa", "ffff000bbbb") });
    expect(status.behind).toMatch(/PR head is ffff000/);
    expect(status.blocked).toBeNull();
  });
});

describe("before-load setup that fails", () => {
  const fixture = (id: string): Fixture => ({ id, why: id, phase: "before-load", apply: { js: "1" } });
  const plan: SetupPlan = { rootUid: "r", kit: "k", branch: "b", pr: null, head: null, apply: [fixture("a"), fixture("b")], skip: [], kept: [] };

  it("is retried for the fixtures that failed, and loads nothing meanwhile", () => {
    const retry = retryPlan(plan, [
      { id: "a", why: "a", outcome: "ok" },
      { id: "b", why: "b", outcome: "failed", detail: "boom" },
    ]);
    expect(retry?.apply.map((item) => item.id)).toEqual(["b"]);
    expect(retryPlan(plan, [{ id: "a", why: "a", outcome: "ok" }, { id: "b", why: "b", outcome: "ok" }])).toBeNull();
  });
});

describe("resuming a run", () => {
  it("only resumes on the commit the run started on", () => {
    expect(recordFits({ kitHash: "h", commit: "aaa" }, "h", "aaa")).toBe(true);
    expect(recordFits({ kitHash: "h", commit: "aaa" }, "h", "bbb")).toBe(false);
    expect(recordFits({ kitHash: "h", commit: "aaa" }, "other", "aaa")).toBe(false);
    expect(recordFits(null, "h", "aaa")).toBe(false);
  });
});
