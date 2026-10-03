import { afterEach, describe, expect, it } from "vitest";
import type { Fixture } from "../src/core/kit";
import { backendOf } from "../src/roam/build-loader";
import { buildStatus, planBeforeLoad, wouldConnect } from "../src/roam/runner";

// A CI build signs in to the hosted database itself; the kits' local
// sign-in fixture is a stand-in for that on a local stack.

const signIn: Fixture = {
  id: "database-session",
  why: "the extension has a database session",
  phase: "before-load",
  check: { js: "false" },
  apply: { js: "proof.supabase.signIn({ serviceKey: '{{env.SUPABASE_SERVICE_ROLE_KEY}}', publishableKey: '{{env.SUPABASE_PUBLISHABLE_KEY}}' })" },
};

const context = { env: {}, kit: "demo", run: "r1" };

describe("the build's database", () => {
  it("is read from the build: the hosted project, or 127 for a local dist", () => {
    expect(backendOf('a="https://zytfjzqyijgagqxrzbmz.supabase.co",b=1')).toBe("zytfjzqyijgagqxrzbmz");
    expect(backendOf('url:"http://127.0.0.1:54321"')).toBe("127");
    expect(backendOf("no database here")).toBeNull();
  });

  it("leaves the local sign-in to a hosted build instead of skipping it", async () => {
    const hosted = await planBeforeLoad([signIn], context, "zytfjzqyijgagqxrzbmz");
    expect(hosted.byBuild.map((item) => item.id)).toEqual(["database-session"]);
    expect(hosted.skip).toEqual([]);
    const local = await planBeforeLoad([signIn], context, "127");
    expect(local.byBuild).toEqual([]);
    expect(local.skip.map((item) => item.reason)).toEqual(["needs SUPABASE_SERVICE_ROLE_KEY, which this browser doesn't have"]);
  });
});

describe("a kit that needs the database", () => {
  const loaded = { branch: "eng-2194-x", pr: 1485, commit: "d6af83c111", prHead: "d6af83c111" };
  const base = { config: { build: null, pr: 1485 }, loaded, mine: true, setup: false, loading: false, buildError: null, needsDatabase: true };

  it("waits for DG's session, and says why when there is none", () => {
    expect(buildStatus({ ...base, database: { state: "checking", detail: "" } }).blocked).toMatch(/Waiting for DG to sign in/);
    expect(buildStatus({ ...base, database: { state: "missing", detail: "DG tried and failed: Failed to create space" } }).blocked).toBe(
      "No database session: DG tried and failed: Failed to create space",
    );
    expect(buildStatus({ ...base, database: { state: "ok", detail: "signed in" } }).blocked).toBeNull();
  });

  it("doesn't hold up a kit that doesn't need it", () => {
    expect(buildStatus({ ...base, needsDatabase: false, database: null }).blocked).toBeNull();
  });
});

describe("the production database", () => {
  const sync: Fixture = {
    id: "flag-sync",
    why: "sync is on",
    phase: "before-load",
    apply: { js: "proof.flags.set('Suggestive mode overlay enabled', true)" },
  };
  const syncOff: Fixture = { ...sync, id: "no-sync", apply: { js: "proof.flags.set('Suggestive mode overlay enabled', false)" } };

  it("is never connected to by a kit that needs a database or turns on sync or sharing", () => {
    expect(wouldConnect({ needsDatabase: true, connectingFlagOn: false, apply: [] })).toBe(true);
    expect(wouldConnect({ needsDatabase: false, connectingFlagOn: true, apply: [] })).toBe(true);
    expect(wouldConnect({ needsDatabase: false, connectingFlagOn: false, apply: [sync] })).toBe(true);
  });

  it("can still load for a UI-only kit with sync and sharing off", () => {
    expect(wouldConnect({ needsDatabase: false, connectingFlagOn: false, apply: [syncOff] })).toBe(false);
  });
});
