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

const addPrototype = async ({ root, name }) => {
  const prototype = path.join(root, "prototypes", name);
  const dist = path.join(prototype, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(prototype, "README.md"), `# ${name}\n`, "utf8");
  await writeFile(path.join(dist, "extension.js"), "export default true;\n", "utf8");
};

test("prepares an empty manifest when the prototypes directory does not exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "roam-empty-artifacts-test-"));
  try {
    const manifest = await prepareArtifacts({ repoRoot: root });
    assert.deepEqual(manifest, { schemaVersion: 1, prototypes: [] });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, "packaged-artifacts", "manifest.json"))),
      manifest,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test("packages only selected prototypes", async () => {
  await withRepository(async ({ root }) => {
    await addPrototype({ root, name: "another-prototype" });

    const manifest = await prepareArtifacts({
      repoRoot: root,
      prototypes: ["sample-prototype"],
    });

    assert.deepEqual(manifest.prototypes, ["sample-prototype"]);
    await assert.rejects(
      readFile(path.join(root, "packaged-artifacts", "another-prototype", "extension.js")),
      /ENOENT/,
    );
  });
});

test("prepares an empty manifest when no prototypes are selected", async () => {
  await withRepository(async ({ root }) => {
    const manifest = await prepareArtifacts({ repoRoot: root, prototypes: [] });
    assert.deepEqual(manifest.prototypes, []);
  });
});

test("CI selects changed prototypes for pull requests and main pushes", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.ok(
    workflow.includes(
      "BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}",
    ),
  );
  assert.ok(
    workflow.includes(
      "HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    ),
  );
  assert.ok(workflow.includes("if: github.event_name != 'workflow_dispatch'"));
  assert.ok(workflow.includes("--prototype-list changed-prototypes.txt"));
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
