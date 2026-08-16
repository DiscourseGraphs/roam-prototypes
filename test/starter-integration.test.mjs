import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPrototype } from "../scripts/create-prototype.mjs";
import { prepareArtifacts } from "../scripts/prepare-artifacts.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  "node_modules",
  "pnpm",
  "bin",
  "pnpm.cjs",
);
const run = (args, cwd) => {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: false,
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
      const placeholder = path.join(repoRoot, "prototypes", "personal-homepage");
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
      if (!process.env.CI) installArguments.push("--offline");
      run(installArguments, repoRoot);
      run(["--dir", destination, "test"], repoRoot);
      const recursiveBuild = run(
        ["--recursive", "--if-present", "--filter", "./prototypes/**", "build"],
        repoRoot,
      );
      assert.match(recursiveBuild, new RegExp(name));
      assert.doesNotMatch(recursiveBuild, /personal-homepage@/);

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
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  },
);
