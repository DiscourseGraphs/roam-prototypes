import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const REQUIRED_ARTIFACTS = Object.freeze(["extension.js", "README.md"]);
export const OPTIONAL_ARTIFACTS = Object.freeze(["extension.css", "CHANGELOG.md"]);
export const ALLOWED_ARTIFACTS = Object.freeze([
  ...REQUIRED_ARTIFACTS,
  ...OPTIONAL_ARTIFACTS,
]);

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const PROTOTYPE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SECRET_PATTERNS = [
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    label: "Vercel Blob read-write token",
    pattern: /\bvercel_blob_rw_[A-Za-z0-9_=.-]{20,}\b/,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    label: "assigned credential",
    pattern:
      /\b(?:BLOB_READ_WRITE_TOKEN|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|API_SECRET|CLIENT_SECRET)\s*[:=]\s*["']?[^\s"'`]{12,}/i,
  },
];

export const assertPrototypeName = (name) => {
  if (!PROTOTYPE_NAME.test(name)) {
    throw new Error(`Invalid prototype directory name: ${name}`);
  }
  return name;
};

export const branchToSlug = (branch) => {
  const slug = branch
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll("/", "--")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");

  if (!slug) throw new Error(`Branch cannot be converted to a URL slug: ${branch}`);
  return slug;
};

export const releasePath = ({ mode, branch, prototype, file }) => {
  assertPrototypeName(prototype);
  if (!ALLOWED_ARTIFACTS.includes(file)) {
    throw new Error(`Artifact is not allowlisted: ${file}`);
  }
  if (mode === "stable") return `releases/prototypes/${prototype}/${file}`;
  if (mode === "preview") {
    return `releases/prototypes/previews/${branchToSlug(branch)}/${prototype}/${file}`;
  }
  throw new Error(`Unknown publish mode: ${mode}`);
};

export const assertPublicArtifactSafe = (content, label) => {
  if (content.byteLength === 0) throw new Error(`${label} is empty`);
  if (content.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error(`${label} exceeds the 10 MiB artifact limit`);
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  for (const candidate of SECRET_PATTERNS) {
    if (candidate.pattern.test(text)) {
      throw new Error(`${label} appears to contain a ${candidate.label}`);
    }
  }
  return text;
};

export const validateArtifactDirectory = async (directory, prototype) => {
  assertPrototypeName(prototype);
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();

  for (const entry of entries) {
    if (!entry.isFile() || !ALLOWED_ARTIFACTS.includes(entry.name)) {
      throw new Error(
        `${prototype} contains an unexpected public artifact: ${entry.name}`,
      );
    }
    const stats = await lstat(path.join(directory, entry.name));
    if (stats.isSymbolicLink()) {
      throw new Error(`${prototype}/${entry.name} must not be a symbolic link`);
    }
  }

  for (const required of REQUIRED_ARTIFACTS) {
    if (!names.includes(required)) {
      throw new Error(`${prototype} is missing required artifact ${required}`);
    }
  }

  const files = new Map();
  for (const name of names) {
    const content = await readFile(path.join(directory, name));
    assertPublicArtifactSafe(content, `${prototype}/${name}`);
    files.set(name, content);
  }
  return files;
};

