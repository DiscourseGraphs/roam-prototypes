import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAllowedEnvironmentReferences,
  assertPrototypeName,
} from "./artifact-utils.mjs";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unresolvedToken = /__[A-Z][A-Z0-9_]*__/g;

const usage = `Usage:
  pnpm create:prototype -- --name <slug> --title <title> --description <description>

Options:
  --spec <markdown-file>  Copy an optional SPEC.md
  --adopt-existing       Scaffold a README/SPEC-only placeholder
  --skip-install         Do not run pnpm install --ignore-scripts
  --dry-run              Print planned files without writing
  --help                 Show this help`;

const toPortablePath = (value) => value.split(path.sep).join("/");

const relativeImportPath = ({ from, to }) => {
  const relative = toPortablePath(path.relative(from, to));
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const pathExists = async (target) => {
  try {
    return await stat(target);
  } catch {
    return null;
  }
};

const readTemplateFiles = async (directory, base = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readTemplateFiles(target, base)));
    } else if (entry.isFile()) {
      files.push({
        relativePath: path.relative(base, target),
        content: await readFile(target, "utf8"),
      });
    } else {
      throw new Error(`Template contains a non-file entry: ${target}`);
    }
  }
  return files;
};

export const renderTemplate = (content, replacements, label = "template") => {
  let rendered = content;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(token, value);
  }
  const remaining = rendered.match(unresolvedToken);
  if (remaining) {
    throw new Error(`${label} contains unresolved token ${remaining[0]}`);
  }
  return rendered;
};

const validateExistingPlaceholder = async (directory) => {
  const allowed = new Set(["README.md", "SPEC.md"]);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !allowed.has(entry.name)) {
      throw new Error(
        `Cannot adopt ${directory}: only README.md and SPEC.md are allowed`,
      );
    }
  }
  return new Set(entries.map((entry) => entry.name));
};

const installWorkspace = (repoRoot) => {
  const pnpmCli = process.env.npm_execpath || path.join(
    path.dirname(process.execPath),
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  );
  const result = spawnSync(process.execPath, [pnpmCli, "install", "--ignore-scripts"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm install failed with exit code ${result.status}`);
  }
};

export const createPrototype = async ({
  name,
  title,
  description,
  specPath,
  adoptExisting = false,
  skipInstall = false,
  dryRun = false,
  repoRoot = scriptRoot,
  prototypesRoot = path.join(repoRoot, "prototypes"),
  templateRoot = path.join(repoRoot, "packages", "extension-base", "template"),
  createdDate = new Date().toISOString().slice(0, 10),
} = {}) => {
  assertPrototypeName(name || "");
  if (!title?.trim()) throw new Error("Prototype title is required");
  if (!description?.trim()) throw new Error("Prototype description is required");
  if (description.trim().length > 250) {
    throw new Error("Prototype description must be 250 characters or fewer");
  }

  const resolvedPrototypesRoot = path.resolve(prototypesRoot);
  const destination = path.resolve(resolvedPrototypesRoot, name);
  const relativeDestination = path.relative(resolvedPrototypesRoot, destination);
  if (
    !relativeDestination ||
    relativeDestination.startsWith("..") ||
    path.isAbsolute(relativeDestination)
  ) {
    throw new Error("Prototype destination escaped the prototypes directory");
  }

  const existingStats = await pathExists(destination);
  let preservedFiles = new Set();
  if (existingStats) {
    if (!existingStats.isDirectory()) {
      throw new Error(`Prototype destination is not a directory: ${destination}`);
    }
    if (!adoptExisting) {
      throw new Error(`Prototype already exists: ${name}`);
    }
    preservedFiles = await validateExistingPlaceholder(destination);
  } else if (adoptExisting) {
    throw new Error(`Cannot adopt missing prototype: ${name}`);
  }

  if (specPath && preservedFiles.has("SPEC.md")) {
    throw new Error(`${name} already has SPEC.md; refusing to overwrite it`);
  }

  const extensionBase = path.join(repoRoot, "packages", "extension-base");
  const replacements = {
    __PROTOTYPE_NAME__: name,
    __PROTOTYPE_TITLE__: title.trim(),
    __PROTOTYPE_DESCRIPTION__: description.trim(),
    __PROTOTYPE_DESCRIPTION_JSON__: JSON.stringify(description.trim()),
    __LOAD_MESSAGE_JSON__: JSON.stringify(`Successfully loaded ${title.trim()}`),
    __CREATED_DATE__: createdDate,
    __EXTENSION_BASE_PACKAGE__: relativeImportPath({
      from: destination,
      to: path.join(extensionBase, "package.json"),
    }),
    __EXTENSION_BASE_TSCONFIG__: relativeImportPath({
      from: destination,
      to: path.join(extensionBase, "tsconfig.json"),
    }),
    __EXTENSION_BASE_TAILWIND__: relativeImportPath({
      from: destination,
      to: path.join(extensionBase, "tailwind.config.cjs"),
    }),
  };

  const templateFiles = await readTemplateFiles(templateRoot);
  const plannedFiles = [];
  for (const file of templateFiles) {
    if (preservedFiles.has(file.relativePath)) continue;
    const content = renderTemplate(file.content, replacements, file.relativePath);
    if (/\.[cm]?[jt]sx?$/.test(file.relativePath)) {
      assertAllowedEnvironmentReferences(content, file.relativePath);
    }
    plannedFiles.push({ ...file, content });
  }

  if (specPath) {
    const resolvedSpec = path.resolve(specPath);
    const specStats = await pathExists(resolvedSpec);
    if (!specStats?.isFile()) throw new Error(`SPEC source is not a file: ${specPath}`);
    plannedFiles.push({
      relativePath: "SPEC.md",
      content: await readFile(resolvedSpec, "utf8"),
    });
  }

  const output = {
    name,
    destination,
    files: plannedFiles.map((file) => file.relativePath),
    stableUrl: `https://discoursegraphs.com/releases/prototypes/${name}/`,
    previewUrl: `https://discoursegraphs.com/releases/prototypes/previews/<branch-slug>/${name}/`,
    dryRun,
  };

  if (dryRun) return output;

  const createdDirectory = !existingStats;
  const writtenFiles = [];
  try {
    if (createdDirectory) await mkdir(destination, { recursive: true });
    for (const file of plannedFiles) {
      const target = path.join(destination, file.relativePath);
      const relativeTarget = path.relative(destination, target);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw new Error(`Template path escaped prototype directory: ${file.relativePath}`);
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
      writtenFiles.push(target);
    }
    if (!skipInstall) installWorkspace(repoRoot);
  } catch (error) {
    if (createdDirectory) {
      await rm(destination, { recursive: true, force: true });
    } else {
      await Promise.all(writtenFiles.map((target) => rm(target, { force: true })));
      const generatedDirectories = new Set(
        plannedFiles
          .map(({ relativePath }) => relativePath.split(path.sep))
          .filter((parts) => parts.length > 1)
          .map(([directory]) => directory),
      );
      await Promise.all(
        [...generatedDirectories].map((directory) =>
          rm(path.join(destination, directory), { recursive: true, force: true }),
        ),
      );
    }
    throw error;
  }

  return output;
};

export const parseArguments = (argv) => {
  const valueFlags = new Set(["--name", "--title", "--description", "--spec"]);
  const booleanFlags = new Set([
    "--adopt-existing",
    "--skip-install",
    "--dry-run",
    "--help",
  ]);
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (valueFlags.has(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      const key = flag === "--spec"
        ? "specPath"
        : flag.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      result[key] = value;
      index += 1;
    } else if (booleanFlags.has(flag)) {
      result[flag.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = true;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return result;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      console.log(usage);
      process.exit(0);
    }
    const output = await createPrototype(args);
    console.log(`${output.dryRun ? "Would create" : "Created"} ${output.name}:`);
    output.files.forEach((file) => console.log(`  - ${file}`));
    console.log(`Stable: ${output.stableUrl}`);
    console.log(`Preview: ${output.previewUrl}`);
    if (!output.dryRun) {
      console.log(`Next: pnpm --dir prototypes/${output.name} test`);
      console.log(`      pnpm --dir prototypes/${output.name} build`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(`\n${usage}`);
    process.exit(1);
  }
}
