import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrototypeName,
  assertPublicArtifactSafe,
  branchToSlug,
  releasePath,
} from "../scripts/artifact-utils.mjs";

test("normalizes branches for one preview URL segment", () => {
  assert.equal(
    branchToSlug("agent/Personal Homepage_shell"),
    "agent--personal-homepage-shell",
  );
});

test("validates lowercase kebab-case prototype names", () => {
  assert.equal(assertPrototypeName("personal-homepage"), "personal-homepage");
  assert.throws(() => assertPrototypeName("Personal Homepage"));
  assert.throws(() => assertPrototypeName("../personal-homepage"));
});

test("builds stable and preview Blob paths", () => {
  assert.equal(
    releasePath({
      mode: "stable",
      branch: "main",
      prototype: "personal-homepage",
      file: "extension.js",
    }),
    "releases/prototypes/personal-homepage/extension.js",
  );
  assert.equal(
    releasePath({
      mode: "preview",
      branch: "agent/personal-homepage",
      prototype: "personal-homepage",
      file: "README.md",
    }),
    "releases/prototypes/previews/agent--personal-homepage/personal-homepage/README.md",
  );
});

test("rejects common secrets in public artifacts", () => {
  const fakeToken = Buffer.from(`const token = "vercel_blob_rw_${"x".repeat(30)}";`);
  assert.throws(() => assertPublicArtifactSafe(fakeToken, "extension.js"));
  assert.doesNotThrow(() =>
    assertPublicArtifactSafe(Buffer.from("export const enabled = true;"), "extension.js"),
  );
});

