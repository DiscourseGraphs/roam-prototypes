import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_ARTIFACTS,
  assertPrototypeName,
  validateArtifactDirectory,
} from "./artifact-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const exists = async (target) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const output = path.resolve(root, argumentValue("--output", "packaged-artifacts"));
const relativeOutput = path.relative(root, output);
if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
  throw new Error("Artifact output must be a child of the repository root");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const prototypesRoot = path.join(root, "prototypes");
const entries = await readdir(prototypesRoot, { withFileTypes: true });
const packaged = [];

for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const prototype = assertPrototypeName(entry.name);
  const source = path.join(prototypesRoot, prototype);
  const dist = path.join(source, "dist");
  const extension = path.join(dist, "extension.js");

  if (!(await exists(extension))) {
    console.log(`Skipping ${prototype}: no dist/extension.js`);
    continue;
  }

  const destination = path.join(output, prototype);
  await mkdir(destination, { recursive: true });

  for (const file of ALLOWED_ARTIFACTS) {
    const distFile = path.join(dist, file);
    const sourceFile = path.join(source, file);
    const selected = (await exists(distFile))
      ? distFile
      : await exists(sourceFile)
        ? sourceFile
        : null;
    if (selected) await cp(selected, path.join(destination, file));
  }

  await validateArtifactDirectory(destination, prototype);
  packaged.push(prototype);
}

const manifest = { schemaVersion: 1, prototypes: packaged };
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared ${packaged.length} prototype artifact set(s).`);

