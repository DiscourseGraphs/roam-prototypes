import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPrototypeName,
  branchToSlug,
  releasePath,
  validateArtifactDirectory,
} from "./artifact-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const value = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const artifacts = path.resolve(root, value("--artifacts", "packaged-artifacts"));
const relativeArtifacts = path.relative(root, artifacts);
if (
  !relativeArtifacts ||
  relativeArtifacts.startsWith("..") ||
  path.isAbsolute(relativeArtifacts)
) {
  throw new Error("Artifact input must be a child of the repository root");
}

const mode = value("--mode", process.env.PUBLISH_MODE);
const branch = value("--branch", process.env.PUBLISH_BRANCH || "main");
const dryRun = process.argv.includes("--dry-run");
if (!new Set(["stable", "preview"]).has(mode)) {
  throw new Error("--mode must be stable or preview");
}

const manifest = JSON.parse(await readFile(path.join(artifacts, "manifest.json"), "utf8"));
if (
  manifest.schemaVersion !== 1 ||
  !Array.isArray(manifest.prototypes) ||
  !manifest.prototypes.every((name) => typeof name === "string")
) {
  throw new Error("Invalid artifact manifest");
}

const prototypes = [...new Set(manifest.prototypes)].sort();
if (prototypes.length !== manifest.prototypes.length) {
  throw new Error("Artifact manifest contains duplicate prototypes");
}

const rootEntries = (await readdir(artifacts, { withFileTypes: true })).map(
  (entry) => entry.name,
);
const expectedRootEntries = new Set(["manifest.json", ...prototypes]);
for (const entry of rootEntries) {
  if (!expectedRootEntries.has(entry)) {
    throw new Error(`Unexpected entry in artifact bundle: ${entry}`);
  }
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!dryRun && !token) throw new Error("BLOB_READ_WRITE_TOKEN is required");
const put = dryRun ? null : (await import("@vercel/blob")).put;

const publishedUrls = [];
for (const prototype of prototypes) {
  assertPrototypeName(prototype);
  const directory = path.join(artifacts, prototype);
  const files = await validateArtifactDirectory(directory, prototype);

  for (const [file, content] of files) {
    const pathname = releasePath({ mode, branch, prototype, file });
    const publicUrl = `https://discoursegraphs.com/${pathname}`;
    if (dryRun) {
      console.log(`[dry-run] ${prototype}/${file} -> ${publicUrl}`);
      continue;
    }

    const result = await put(pathname, content, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60 * 60 * 24,
      token,
    });
    console.log(`Published ${prototype}/${file} to ${result.url}`);
  }

  const base =
    mode === "stable"
      ? `https://discoursegraphs.com/releases/prototypes/${prototype}/`
      : `https://discoursegraphs.com/releases/prototypes/previews/${branchToSlug(branch)}/${prototype}/`;
  publishedUrls.push(base);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    `## ${mode === "stable" ? "Stable" : "Preview"} prototype publication`,
    "",
    publishedUrls.length
      ? publishedUrls.map((url) => `- ${url}`).join("\n")
      : "No installable prototypes were present.",
    "",
  ].join("\n");
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}

console.log(
  publishedUrls.length
    ? `Published ${publishedUrls.length} prototype(s).`
    : "No installable prototypes to publish.",
);

