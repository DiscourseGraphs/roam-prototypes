import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPrototype } from "../scripts/create-prototype.mjs";
import {
  assertNoRoamJsDefaultImports,
  validatePrototypes,
} from "../scripts/validate-prototypes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("validates the generated dev script convention", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "roam-validator-test-"));
  const prototypesRoot = path.join(root, "prototypes");
  await mkdir(prototypesRoot);

  try {
    const result = await createPrototype({
      name: "sample-prototype",
      title: "Sample Prototype",
      description: "Tests the validator's script convention.",
      repoRoot,
      prototypesRoot,
      skipInstall: true,
    });

    assert.equal(await validatePrototypes({ prototypesRoot }), 1);

    const packageFile = path.join(result.destination, "package.json");
    const manifest = JSON.parse(await readFile(packageFile, "utf8"));
    manifest.scripts.start = manifest.scripts.dev;
    delete manifest.scripts.dev;
    await writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await assert.rejects(
      validatePrototypes({ prototypesRoot }),
      /sample-prototype\/package\.json is missing the dev script/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects default imports from published roamjs-components CommonJS subpaths", () => {
  assert.throws(
    () =>
      assertNoRoamJsDefaultImports(
        'import addStyle from "roamjs-components/dom/addStyle";',
        "sample-prototype/src/index.ts",
      ),
    /default-imports roamjs-components\/dom\/addStyle/,
  );
  assert.throws(
    () =>
      assertNoRoamJsDefaultImports(
        'import Alert, { render } from "roamjs-components/components/Toast";',
        "sample-prototype/src/index.ts",
      ),
    /default-imports roamjs-components\/components\/Toast/,
  );
  assert.doesNotThrow(() =>
    assertNoRoamJsDefaultImports(
      [
        'import { addStyle } from "roamjs-components/dom";',
        'import { runExtension } from "roamjs-components/util";',
        'import type { OnloadArgs } from "roamjs-components/types";',
      ].join("\n"),
      "sample-prototype/src/index.ts",
    ),
  );
});
