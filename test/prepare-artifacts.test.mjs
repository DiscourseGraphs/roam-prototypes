import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareArtifacts } from "../scripts/prepare-artifacts.mjs";

const withRepository = async (callback) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "roam-artifacts-test-"));
  const prototype = path.join(root, "prototypes", "sample-prototype");
  const dist = path.join(prototype, "dist");
  const src = path.join(prototype, "src");
  await mkdir(dist, { recursive: true });
  await mkdir(src);
  await writeFile(path.join(prototype, "README.md"), "# Sample\n", "utf8");
  await writeFile(path.join(dist, "extension.js"), "export default true;\n", "utf8");
  await writeFile(path.join(dist, "CHANGELOG.md"), "# Changes\n", "utf8");
  await writeFile(path.join(dist, "extension.css"), ".sample {}\n", "utf8");
  await writeFile(path.join(src, "index.ts"), "process.env.NODE_ENV;\n", "utf8");
  try {
    await callback({ root, prototype, dist });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("packages only the four public artifact names", async () => {
  await withRepository(async ({ root }) => {
    const manifest = await prepareArtifacts({ repoRoot: root });
    assert.deepEqual(manifest.prototypes, ["sample-prototype"]);
    const publishedPackage = path.join(
      root,
      "packaged-artifacts",
      "sample-prototype",
      "package.json",
    );
    await assert.rejects(readFile(publishedPackage), /ENOENT/);
  });
});

test("rejects source maps and unexpected build outputs", async () => {
  await withRepository(async ({ root, dist }) => {
    await writeFile(path.join(dist, "extension.js.map"), "{}", "utf8");
    await assert.rejects(prepareArtifacts({ repoRoot: root }), /unexpected build output/);
    await rm(path.join(dist, "extension.js.map"));
    await writeFile(path.join(dist, "package.json"), "{}", "utf8");
    await assert.rejects(prepareArtifacts({ repoRoot: root }), /unexpected build output/);
  });
});

test("rejects secrets and disallowed environment references", async () => {
  await withRepository(async ({ root, dist }) => {
    await writeFile(
      path.join(root, "prototypes", "sample-prototype", "src", "index.ts"),
      "process.env.API_SECRET;",
      "utf8",
    );
    await assert.rejects(
      prepareArtifacts({ repoRoot: root }),
      /process indirectly or references a disallowed environment value/,
    );

    await writeFile(
      path.join(root, "prototypes", "sample-prototype", "src", "index.ts"),
      "process.env.NODE_ENV;",
      "utf8",
    );
    await writeFile(
      path.join(dist, "extension.js"),
      `const token = "vercel_blob_rw_${"x".repeat(30)}";`,
      "utf8",
    );
    await assert.rejects(prepareArtifacts({ repoRoot: root }), /Vercel Blob read-write token/);
  });
});
