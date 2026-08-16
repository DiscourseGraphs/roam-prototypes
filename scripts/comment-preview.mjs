import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPrototypeName, branchToSlug } from "./artifact-utils.mjs";

export const PREVIEW_COMMENT_MARKER = "<!-- roam-prototypes-preview -->";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const validateRepository = (repository) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format");
  }
  return repository;
};

const validatePullRequestNumber = (number) => {
  const parsed = Number(number);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("A positive pull request number is required");
  }
  return parsed;
};

export const previewUrls = ({ branch, prototypes }) => {
  const branchSlug = branchToSlug(branch);
  return [...prototypes].sort().map((prototype) => {
    assertPrototypeName(prototype);
    return {
      prototype,
      url: `https://discoursegraphs.com/releases/prototypes/previews/${branchSlug}/${prototype}/`,
    };
  });
};

export const renderPreviewComment = ({ branch, prototypes, runUrl }) => {
  const previews = previewUrls({ branch, prototypes });
  const publication = previews.length
    ? [
        "The preview deployment is ready. Paste a URL below into **Load Developer Extensions from URL** in Roam:",
        "",
        ...previews.map(
          ({ prototype, url }) => `- [Load \`${prototype}\` in Roam](${url})`,
        ),
      ].join("\n")
    : "CI passed, but this branch does not contain an installable prototype yet.";
  const details = runUrl ? `\n\n[View publishing details](${runUrl})` : "";

  return [
    PREVIEW_COMMENT_MARKER,
    "## Roam prototype previews",
    "",
    publication,
    details,
  ].join("\n");
};

export const upsertPreviewComment = async ({
  request,
  repository,
  pullRequestNumber,
  body,
}) => {
  const validatedRepository = validateRepository(repository);
  const number = validatePullRequestNumber(pullRequestNumber);
  let existing;

  for (let page = 1; !existing; page += 1) {
    const comments = await request(
      "GET",
      `/repos/${validatedRepository}/issues/${number}/comments?per_page=100&page=${page}`,
    );
    existing = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.includes(PREVIEW_COMMENT_MARKER),
    );
    if (comments.length < 100) break;
  }

  if (existing) {
    await request(
      "PATCH",
      `/repos/${validatedRepository}/issues/comments/${existing.id}`,
      { body },
    );
    return "updated";
  }

  await request("POST", `/repos/${validatedRepository}/issues/${number}/comments`, {
    body,
  });
  return "created";
};

const createGitHubRequest = ({ apiUrl, token }) => async (method, pathname, body) => {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${method} ${pathname} failed (${response.status}): ${detail}`);
  }
  return response.status === 204 ? null : response.json();
};

const resolvePullRequestNumber = async ({ request, repository, number, headSha }) => {
  if (number) return validatePullRequestNumber(number);
  if (!/^[a-f0-9]{40}$/i.test(headSha || "")) {
    throw new Error("Cannot resolve the pull request without a number or head SHA");
  }
  const pulls = await request(
    "GET",
    `/repos/${validateRepository(repository)}/commits/${headSha}/pulls`,
  );
  const openPulls = pulls.filter((pull) => pull.state === "open");
  if (openPulls.length !== 1) {
    throw new Error(`Expected one open pull request for ${headSha}, found ${openPulls.length}`);
  }
  return validatePullRequestNumber(openPulls[0].number);
};

const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const main = async () => {
  const artifacts = path.resolve(
    root,
    argumentValue("--artifacts", "packaged-artifacts"),
  );
  const relativeArtifacts = path.relative(root, artifacts);
  if (
    !relativeArtifacts ||
    relativeArtifacts.startsWith("..") ||
    path.isAbsolute(relativeArtifacts)
  ) {
    throw new Error("Artifact input must be a child of the repository root");
  }

  const manifest = JSON.parse(
    await readFile(path.join(artifacts, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.prototypes) ||
    !manifest.prototypes.every((prototype) => typeof prototype === "string")
  ) {
    throw new Error("Invalid artifact manifest");
  }

  const repository = validateRepository(process.env.GITHUB_REPOSITORY || "");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const request = createGitHubRequest({ apiUrl, token });
  const pullRequestNumber = await resolvePullRequestNumber({
    request,
    repository,
    number: argumentValue("--pr", ""),
    headSha: argumentValue("--head-sha", ""),
  });
  const branch = argumentValue("--branch", "");
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "";
  const body = renderPreviewComment({
    branch,
    prototypes: manifest.prototypes,
    runUrl,
  });
  const result = await upsertPreviewComment({
    request,
    repository,
    pullRequestNumber,
    body,
  });
  console.log(`${result === "created" ? "Created" : "Updated"} preview comment on PR #${pullRequestNumber}.`);
};

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await main();
