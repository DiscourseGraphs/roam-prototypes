import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPrototype } from "../scripts/create-prototype.mjs";
import { prepareArtifacts } from "../scripts/prepare-artifacts.mjs";
import { runPnpmSync } from "../scripts/pnpm.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (args, cwd) => {
  const result = runPnpmSync(args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    [`pnpm ${args.join(" ")} failed`, result.stdout, result.stderr].join("\n"),
  );
  return `${result.stdout}\n${result.stderr}`;
};

test(
  "the generated starter resolves the shared esbuild CLI and emits the public contract",
  { timeout: 180_000 },
  async () => {
    const name = `starter-integration-${process.pid}`;
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "roam-starter-integration-"));
    const destination = path.join(repoRoot, "prototypes", name);
    try {
      const base = path.join(repoRoot, "packages", "extension-base");
      await mkdir(base, { recursive: true });
      await cp(
        path.join(sourceRoot, "packages", "extension-base", "template"),
        path.join(base, "template"),
        { recursive: true },
      );
      for (const file of ["package.json", "tsconfig.json", "tailwind.config.cjs"]) {
        await cp(path.join(sourceRoot, "packages", "extension-base", file), path.join(base, file));
      }
      await cp(
        path.join(sourceRoot, "packages", "extension-base", "scripts"),
        path.join(base, "scripts"),
        { recursive: true },
      );
      await cp(
        path.join(sourceRoot, "pnpm-workspace.yaml"),
        path.join(repoRoot, "pnpm-workspace.yaml"),
      );
      await writeFile(
        path.join(repoRoot, "package.json"),
        `${JSON.stringify({ private: true, packageManager: "pnpm@10.15.1" }, null, 2)}\n`,
        "utf8",
      );
      const placeholder = path.join(repoRoot, "prototypes", "readme-only-placeholder");
      await mkdir(placeholder, { recursive: true });
      await writeFile(path.join(placeholder, "README.md"), "# Reserved\n", "utf8");

      await createPrototype({
        name,
        title: "Starter Integration",
        description: "Temporary workspace used by the starter integration test.",
        repoRoot,
        skipInstall: true,
      });

      const installArguments = [
        "install",
        "--ignore-scripts",
        "--lockfile=false",
        "--force",
      ];
      if (!process.env.CI) installArguments.push("--prefer-offline");
      run(installArguments, repoRoot);
      run(["--dir", destination, "test"], repoRoot);
      const recursiveBuild = run(
        ["--recursive", "--if-present", "--filter", "./prototypes/**", "build"],
        repoRoot,
      );
      assert.match(recursiveBuild, new RegExp(name));
      assert.match(recursiveBuild, /Built dist/);
      assert.doesNotMatch(recursiveBuild, /readme-only-placeholder@/);

      for (const file of [
        "extension.js",
        "README.md",
        "CHANGELOG.md",
        "extension.css",
      ]) {
        const info = await stat(path.join(destination, "dist", file));
        assert.ok(info.size > 0, `${file} should be non-empty`);
      }

      const output = path.join(destination, ".prepared");
      const manifest = await prepareArtifacts({ repoRoot, output });
      assert.deepEqual(manifest.prototypes, [name]);
      assert.doesNotMatch(
        await readFile(path.join(destination, "dist", "extension.js"), "utf8"),
        /sourceMappingURL/,
      );
      assert.doesNotMatch(
        await readFile(path.join(destination, "dist", "extension.js"), "utf8"),
        /process\.env\.(?:PACKAGE_NAME|ROAMJS_VERSION|VERSION)/,
      );

      const smokeTest = path.join(destination, "artifact-smoke.mjs");
      await writeFile(
        smokeTest,
        `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const roamRequire = createRequire(require.resolve("roamjs-components/package.json"));
const TSLib = roamRequire("tslib");

globalThis.window = globalThis;
globalThis.HTMLElement = class HTMLElement {};
const body = new EventTarget();
const head = { appendChild: () => {} };
globalThis.document = {
  body,
  createElement: () => ({ remove: () => {}, setAttribute: () => {} }),
  getElementById: () => null,
  getElementsByTagName: () => [head],
};
window.React = {};
window.ReactDOM = {};
window.TSLib = TSLib;
window.Blueprint = { Core: {}, DateTime: {}, Select: {} };
window.RoamLazy = {};
window.Nanoid = { nanoid: () => "smoke-test" };
globalThis.localStorage = { getItem: () => null };
let errorReports = 0;
globalThis.fetch = async () => {
  errorReports += 1;
  return { ok: true, status: 204 };
};
window.roamAlphaAPI = {
  graph: { name: "artifact-smoke" },
  ui: { commandPalette: { removeCommand: () => {} } },
};

const extension = (await import("./dist/extension.js")).default;
if (typeof extension?.onload !== "function" || typeof extension?.onunload !== "function") {
  throw new Error("Built artifact does not expose the Roam extension lifecycle");
}
extension.onload({
  extensionAPI: { settings: { getAll: () => ({}) } },
  extension: { version: "artifact-smoke" },
});
await new Promise((resolve) => setTimeout(resolve, 0));
extension.onunload();
if (errorReports) {
  throw new Error("Built artifact reported a lifecycle failure");
}

const roamJsExtension = (await import("./dist/extension.js?mode=roam-js")).default;
roamJsExtension.onload({
  extensionAPI: undefined,
  extension: { version: "roam/js" },
});
await new Promise((resolve) => setTimeout(resolve, 0));
roamJsExtension.onunload();
if (errorReports) {
  throw new Error("Built artifact reported a roam/js lifecycle failure");
}
`,
        "utf8",
      );
      run(["--dir", destination, "exec", "node", smokeTest], repoRoot);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  },
);
