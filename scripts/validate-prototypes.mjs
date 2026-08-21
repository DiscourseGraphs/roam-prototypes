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
const roamJsImport = /\bimport\s+([^"';]*?)\s+from\s+["'](roamjs-components(?:\/[^"']*)?)["']/g;

const maskCommentsAndStrings = (source) => {
  const masked = source.split("");
  let state = "code";
  const mask = (index) => {
    if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (character === "'" || character === '"' || character === "`") {
        state = character;
        mask(index);
      } else if (character === "/" && next === "/") {
        state = "line-comment";
        mask(index);
        mask(++index);
      } else if (character === "/" && next === "*") {
        state = "block-comment";
        mask(index);
        mask(++index);
      }
    } else if (state === "line-comment") {
      if (character === "\n" || character === "\r") state = "code";
      else mask(index);
    } else if (state === "block-comment") {
      mask(index);
      if (character === "*" && next === "/") {
        mask(++index);
        state = "code";
      }
    } else {
      mask(index);
      if (character === "\\") {
        if (next !== undefined) mask(++index);
      } else if (character === state) {
        state = "code";
      }
    }
  }

  return masked.join("");
};

export const assertNoRoamJsDefaultImports = (source, label) => {
  const codeMask = maskCommentsAndStrings(source);
  for (const match of source.matchAll(roamJsImport)) {
    if (codeMask.slice(match.index, match.index + 6) !== "import") continue;
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const hasNamedDefault =
      clause.startsWith("{") && /(?:\{|,)\s*default\s+as\b/.test(clause);
    if ((clause.startsWith("{") && !hasNamedDefault) || clause.startsWith("*")) continue;
    throw new Error(
      `${label} default-imports ${match[2]}; use a named export from a roamjs-components barrel`,
    );
  }
};

const isFile = async (target) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const validateSourceDirectory = async (directory, label, sourceRoot = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await validateSourceDirectory(target, label, sourceRoot);
    } else if (entry.isFile() && sourceExtension.test(entry.name)) {
      const source = await readFile(target, "utf8");
      const sourceLabel = `${label}/${path.relative(sourceRoot, target)}`;
      assertAllowedEnvironmentReferences(source, sourceLabel);
      assertNoRoamJsDefaultImports(source, sourceLabel);
    } else if (!entry.isFile()) {
      throw new Error(`${label} source contains a non-file entry: ${entry.name}`);
    }
  }
};

export const validatePrototypes = async ({
  prototypesRoot = defaultPrototypesRoot,
  templateSourceRoot = path.join(root, "packages", "extension-base", "template", "src"),
} = {}) => {
  await validateSourceDirectory(
    templateSourceRoot,
    "packages/extension-base/template",
    templateSourceRoot,
  );
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

    await validateSourceDirectory(sourceDirectory, prototype, sourceDirectory);
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
