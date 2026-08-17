import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAllowedEnvironmentReferences,
  assertPrototypeName,
  readDirectoryIfExists,
} from "./artifact-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPrototypesRoot = path.join(root, "prototypes");
const sourceExtension = /\.[cm]?[jt]sx?$/;

const isFile = async (target) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const validateSourceDirectory = async (directory, prototype, prototypesRoot) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await validateSourceDirectory(target, prototype, prototypesRoot);
    } else if (entry.isFile() && sourceExtension.test(entry.name)) {
      const source = await readFile(target, "utf8");
      assertAllowedEnvironmentReferences(
        source,
        `${prototype}/${path.relative(path.join(prototypesRoot, prototype), target)}`,
      );
    } else if (!entry.isFile()) {
      throw new Error(`${prototype} source contains a non-file entry: ${entry.name}`);
    }
  }
};

export const validatePrototypes = async ({
  prototypesRoot = defaultPrototypesRoot,
} = {}) => {
  const entries = await readDirectoryIfExists(prototypesRoot, {
    withFileTypes: true,
  });
  let packageCount = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const prototype = assertPrototypeName(entry.name);
    const directory = path.join(prototypesRoot, prototype);
    const packageFile = path.join(directory, "package.json");
    if (!(await isFile(packageFile))) {
      console.log(`Skipping ${prototype}: placeholder has no package.json`);
      continue;
    }

    const manifest = JSON.parse(await readFile(packageFile, "utf8"));
    if (manifest.name !== prototype) {
      throw new Error(`${prototype}/package.json name must equal ${prototype}`);
    }
    for (const script of ["dev", "build", "test"]) {
      if (typeof manifest.scripts?.[script] !== "string") {
        throw new Error(`${prototype}/package.json is missing the ${script} script`);
      }
    }
    if (!(await isFile(path.join(directory, "README.md")))) {
      throw new Error(`${prototype} is missing README.md`);
    }
    const sourceDirectory = path.join(directory, "src");
    if (!(await isFile(path.join(sourceDirectory, "index.ts")))) {
      throw new Error(`${prototype} is missing src/index.ts`);
    }

    await validateSourceDirectory(sourceDirectory, prototype, prototypesRoot);
    packageCount += 1;
  }

  return packageCount;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const packageCount = await validatePrototypes();
    console.log(`Validated ${packageCount} prototype package(s).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
