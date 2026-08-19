import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPrototype,
  parseArguments,
  renderTemplate,
} from "../scripts/create-prototype.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(repoRoot, "packages", "extension-base", "template");

const withSandbox = async (callback) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "roam-prototype-test-"));
  const prototypesRoot = path.join(root, "prototypes");
  await mkdir(prototypesRoot);
  try {
    await callback({ root, prototypesRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const options = (prototypesRoot, overrides = {}) => ({
  name: "sample-prototype",
  title: "Sample Prototype",
  description: "Tests the starter convention.",
  repoRoot,
  prototypesRoot,
  templateRoot,
  skipInstall: true,
  createdDate: "2026-08-16",
  ...overrides,
});

test("creates a complete prototype with catalog dependencies", async () => {
  await withSandbox(async ({ prototypesRoot }) => {
    const result = await createPrototype(options(prototypesRoot));
    const manifest = JSON.parse(
      await readFile(path.join(result.destination, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, "sample-prototype");
    assert.equal(
      manifest.devDependencies["@discoursegraphs/extension-base"],
      "workspace:*",
    );
    assert.equal(manifest.scripts.build, "roam-prototype build");
    assert.equal(manifest.scripts.dev, "roam-prototype dev");
    assert.equal(manifest.scripts.start, undefined);
    assert.equal(manifest.devDependencies["@samepage/scripts"], undefined);
    assert.equal(manifest.dependencies["roamjs-components"], "catalog:");
    assert.equal(manifest.dependencies["use-sync-external-store"], "catalog:");
    const entry = await readFile(
      path.join(result.destination, "src", "index.ts"),
      "utf8",
    );
    assert.match(
      entry,
      /import \{ runExtension \} from "roamjs-components\/util";/,
    );
    assert.doesNotMatch(
      entry,
      /import runExtension from "roamjs-components\/util\/runExtension";/,
    );
    assert.match(entry, /if \(args\.extensionAPI\) throw error;/);
    const readme = await readFile(path.join(result.destination, "README.md"), "utf8");
    assert.match(readme, /Load Developer Extensions from URL/);
    assert.match(readme, /extensionAPI: undefined/);
    assert.match(readme, /extension\.css\?v=/);
    assert.match(readme, /previousExtension\?\.onunload/);
    const loader = /```javascript\n([\s\S]*?)\n```/.exec(readme)?.[1];
    assert.ok(loader, "generated README should contain a roam/js loader");
    assert.doesNotThrow(() => new Function(loader));
  });
});

test("dry runs report changes without writing", async () => {
  await withSandbox(async ({ prototypesRoot }) => {
    const result = await createPrototype(
      options(prototypesRoot, { name: "dry-example", dryRun: true }),
    );
    assert.equal(result.dryRun, true);
    assert.ok(result.files.includes("package.json"));
    assert.deepEqual(await readdir(prototypesRoot), []);
  });
});

test("copies an optional specification", async () => {
  await withSandbox(async ({ root, prototypesRoot }) => {
    const specPath = path.join(root, "input.md");
    await writeFile(specPath, "# Required behavior\n", "utf8");
    const result = await createPrototype(options(prototypesRoot, { specPath }));
    assert.equal(
      await readFile(path.join(result.destination, "SPEC.md"), "utf8"),
      "# Required behavior\n",
    );
  });
});

test("adopts README/SPEC-only placeholders without overwriting them", async () => {
  await withSandbox(async ({ prototypesRoot }) => {
    const destination = path.join(prototypesRoot, "sample-prototype");
    await mkdir(destination);
    await writeFile(path.join(destination, "README.md"), "reserved readme", "utf8");
    await writeFile(path.join(destination, "SPEC.md"), "reserved spec", "utf8");
    await createPrototype(options(prototypesRoot, { adoptExisting: true }));
    assert.equal(await readFile(path.join(destination, "README.md"), "utf8"), "reserved readme");
    assert.equal(await readFile(path.join(destination, "SPEC.md"), "utf8"), "reserved spec");
    assert.ok(JSON.parse(await readFile(path.join(destination, "package.json"), "utf8")));
  });
});

test("preserves generated files when the workspace install fails", async () => {
  await withSandbox(async ({ root, prototypesRoot }) => {
    const specPath = path.join(root, "input.md");
    const destination = path.join(prototypesRoot, "sample-prototype");
    await writeFile(specPath, "# Keep this specification\n", "utf8");

    await assert.rejects(
      createPrototype(
        options(prototypesRoot, {
          specPath,
          skipInstall: false,
          install: () => {
            throw new Error("pnpm is unavailable");
          },
        }),
      ),
      /Files were preserved; run pnpm install --ignore-scripts/,
    );

    assert.equal(
      await readFile(path.join(destination, "SPEC.md"), "utf8"),
      "# Keep this specification\n",
    );
    assert.ok(JSON.parse(await readFile(path.join(destination, "package.json"), "utf8")));
  });
});

test("rejects invalid names, traversal, duplicates, and non-placeholder adoption", async () => {
  await withSandbox(async ({ prototypesRoot }) => {
    await assert.rejects(
      createPrototype(options(prototypesRoot, { name: "Invalid Name" })),
      /Invalid prototype/,
    );
    await assert.rejects(
      createPrototype(options(prototypesRoot, { name: "..\\escape" })),
      /Invalid prototype/,
    );

    await createPrototype(options(prototypesRoot));
    await assert.rejects(createPrototype(options(prototypesRoot)), /already exists/);

    const other = path.join(prototypesRoot, "other-prototype");
    await mkdir(other);
    await writeFile(path.join(other, "unexpected.txt"), "no", "utf8");
    await assert.rejects(
      createPrototype(
        options(prototypesRoot, { name: "other-prototype", adoptExisting: true }),
      ),
      /only README\.md and SPEC\.md/,
    );
  });
});

test("rejects unresolved template tokens and maps CLI spec arguments", () => {
  assert.throws(() => renderTemplate("__UNKNOWN_TOKEN__", {}, "bad.txt"), /unresolved token/);
  assert.deepEqual(parseArguments(["--spec", "plan.md", "--skip-install"]), {
    specPath: "plan.md",
    skipInstall: true,
  });
});
