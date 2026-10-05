import { afterEach, describe, expect, it, vi } from "vitest";
import { PROOF_DB_URL } from "../src/core/database";
import type { Fixture, Kit } from "../src/core/kit";
import { backendOf, fetchBuild, pointBuild } from "../src/roam/build-loader";
import { buildStatus, helperState, kitNeedsDatabase, planBeforeLoad, wouldConnect } from "../src/roam/runner";

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
    expect(backendOf('a="http://localhost:3003";url:"http://127.0.0.1:55321"')).toBe("127");
    expect(backendOf('n="http://127.0.0.1:3210"')).toBeNull();
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
    expect(wouldConnect({ needsDatabase: true, flagsOn: [], apply: [] })).toBe(true);
    expect(wouldConnect({ needsDatabase: false, flagsOn: ["Enable node sharing"], apply: [] })).toBe(true);
    expect(wouldConnect({ needsDatabase: false, flagsOn: [], apply: [sync] })).toBe(true);
  });

  it("can still load for a UI-only kit whose setup turns sync and sharing off, even when they're on now", () => {
    expect(wouldConnect({ needsDatabase: false, flagsOn: [], apply: [syncOff] })).toBe(false);
    expect(wouldConnect({ needsDatabase: false, flagsOn: ["Suggestive mode overlay enabled"], apply: [syncOff] })).toBe(false);
  });
});

describe("the proof database", () => {
  it("comes from this machine's helper, which says when it's still starting or why it couldn't", () => {
    expect(helperState(null).state).toBe("missing");
    expect(helperState({ database: null, starting: true }).state).toBe("connecting");
    expect(helperState({ database: null, error: "Couldn't start the proof database: port taken" })).toEqual({
      state: "failed",
      detail: "Couldn't start the proof database: port taken",
    });
    expect(helperState({ database: { url: PROOF_DB_URL, publishableKey: "pk", serviceKey: "sk" } }).state).toBe("ok");
  });

  it("is needed by a kit that says so or signs in", () => {
    const kit = { name: "k", cases: [] } as unknown as Kit;
    expect(kitNeedsDatabase(kit, [])).toBe(false);
    expect(kitNeedsDatabase({ ...kit, needs: ["supabase"] } as Kit, [])).toBe(true);
    expect(kitNeedsDatabase(kit, [signIn])).toBe(true);
  });

  describe("a PR's CI build", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("is pointed at the proof database before it runs, with nothing of the hosted stack left", async () => {
      vi.stubGlobal("fetch", async (url: string) =>
        url.includes("extension.js")
          ? new Response(
              'buildCommit:"abc1234def",buildBranch:"eng-1/x";let e="https://zytfjzqyijgagqxrzbmz.supabase.co",r="sb_publishable_Z0WSigL";var b=()=>"https://discoursegraphs.com/";',
            )
          : new Response("", { status: 404 }),
      );
      const fetched = await fetchBuild("eng-1/x");
      expect(fetched).toMatchObject({ pointed: false, backend: "zytfjzqyijgagqxrzbmz", commit: "abc1234def" });
      const pointed = pointBuild(fetched, "sb_publishable_proof");
      expect(pointed).toMatchObject({ pointed: true, database: PROOF_DB_URL, backend: "127", commit: "abc1234def" });
      expect(pointed.source).toBe(
        'buildCommit:"abc1234def",buildBranch:"eng-1/x";let e="http://127.0.0.1:55321",r="sb_publishable_proof";var b=()=>"http://127.0.0.1:3210/";',
      );
    });

    it("that names no database isn't pointed at all", () => {
      const fetched = { branch: "b", url: "u", source: 'buildCommit:"abc"', css: "", commit: "abc", database: null, backend: null, pointed: false };
      expect(() => pointBuild(fetched, "pk")).toThrow(/names no database/);
    });
  });
});
