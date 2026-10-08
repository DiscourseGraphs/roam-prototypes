import { describe, expect, it } from "vitest";
import type { Fixture } from "../src/core/kit";
import { applyBeforeLoad, planBeforeLoad } from "../src/roam/runner";

const context = { env: {}, kit: "demo", run: "r1" };

const fixture = (id: string, check: string | null, apply: string): Fixture => ({
  id,
  why: `${id} holds`,
  phase: "before-load",
  ...(check ? { check: { js: check } } : {}),
  apply: { js: apply },
});

describe("before-load fixtures", () => {
  it("keeps what holds, applies what doesn't, and skips what needs a missing key", async () => {
    const plan = await planBeforeLoad(
      [
        fixture("flag-on", "true", "window.__applied = (window.__applied || 0) + 1"),
        fixture("flag-off", "false", "window.__applied = (window.__applied || 0) + 1"),
        fixture("database-session", "false", "signIn('{{env.SUPABASE_SERVICE_ROLE_KEY}}')"),
      ],
      context,
    );
    expect(plan.kept.map((item) => item.id)).toEqual(["flag-on"]);
    expect(plan.apply.map((item) => item.id)).toEqual(["flag-off"]);
    expect(plan.skip.map((item) => item.reason)).toEqual(["needs SUPABASE_SERVICE_ROLE_KEY, which this browser doesn't have"]);
    const outcomes = await applyBeforeLoad(plan, context);
    expect(outcomes.map((item) => `${item.id}:${item.outcome}`)).toEqual(["flag-on:kept", "database-session:skipped", "flag-off:ok"]);
    expect((window as unknown as { __applied: number }).__applied).toBe(1);
  });
});
