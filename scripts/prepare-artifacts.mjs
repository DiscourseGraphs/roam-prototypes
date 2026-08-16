import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_ARTIFACTS,
  assertAllowedEnvironmentReferences,
  assertPrototypeName,
  validateArtifactDirectory,
} from "./artifact-utils.mjs";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const validateSourceEnvironmentReferences = async (
  directory,
  prototype,
  sourceRoot = directory,
) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await validateSourceEnvironmentReferences(target, prototype, sourceRoot);
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      assertAllowedEnvironmentReferences(
        await readFile(target, "utf8"),
        `${prototype}/${path.relative(path.join(sourceRoot, ".."), target)}`,
      );
    }
  }
};

const allowedBuildOutputs = new Set(ALLOWED_ARTIFACTS);

export const prepareArtifacts = async ({
  repoRoot = scriptRoot,
  output = path.join(repoRoot, "packaged-artifacts"),
} = {}) => {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedOutput = path.resolve(output);
  const relativeOutput = path.relative(resolvedRoot, resolvedOutput);
  if (
    !relativeOutput ||
    relativeOutput.startsWith("..") ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error("Artifact output must be a child of the repository root");
  }

  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });

  const prototypesRoot = path.join(resolvedRoot, "prototypes");
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

    const buildEntries = await readdir(dist, { withFileTypes: true });
    for (const buildEntry of buildEntries) {
      if (!buildEntry.isFile() || !allowedBuildOutputs.has(buildEntry.name)) {
        throw new Error(
          `${prototype} dist contains an unexpected build output: ${buildEntry.name}`,
        );
      }
    }
    await validateSourceEnvironmentReferences(path.join(source, "src"), prototype);

    const destination = path.join(resolvedOutput, prototype);
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
    path.join(resolvedOutput, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`Prepared ${packaged.length} prototype artifact set(s).`);
  return manifest;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  await prepareArtifacts({
    output: path.resolve(scriptRoot, argumentValue("--output", "packaged-artifacts")),
  });
}
