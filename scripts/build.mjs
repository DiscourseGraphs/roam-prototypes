import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPrototypeName } from "./artifact-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypesRoot = path.join(root, "prototypes");
const entries = await readdir(prototypesRoot, { withFileTypes: true });
let buildCount = 0;

for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const prototype = assertPrototypeName(entry.name);
  const directory = path.join(prototypesRoot, prototype);
  const packageFile = path.join(directory, "package.json");
  try {
    if (!(await stat(packageFile)).isFile()) continue;
  } catch {
    continue;
  }

  console.log(`Building ${prototype}...`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "build", "--if-present"], {
    cwd: directory,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  buildCount += 1;
}

console.log(`Processed ${buildCount} prototype package(s).`);

