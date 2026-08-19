import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PREVIEW_COMMENT_MARKER,
  renderPreviewComment,
  upsertPreviewComment,
} from "../scripts/comment-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("serializes publishing runs without interrupting an active upload", async () => {
  const workflow = await readFile(
    path.join(root, ".github", "workflows", "publish.yml"),
    "utf8",
  );

  assert.match(
    workflow,
    /group: publish-prototypes-\$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.number \|\| github\.event\.workflow_run\.head_branch \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
});

test("publishes manually dispatched CI runs only from main", async () => {
  const workflow = await readFile(
    path.join(root, ".github", "workflows", "publish.yml"),
    "utf8",
  );

  assert.match(workflow, /github\.event\.workflow_run\.event == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
});

test("renders resolved Roam preview URLs without link labels", () => {
  const body = renderPreviewComment({
    branch: "agent/stock-prototype",
    prototypes: ["stock-prototype"],
    runUrl: "https://github.com/DiscourseGraphs/roam-prototypes/actions/runs/123",
  });

  assert.match(body, new RegExp(PREVIEW_COMMENT_MARKER));
  assert.match(
    body,
    /- https:\/\/discoursegraphs\.com\/releases\/prototypes\/previews\/agent--stock-prototype\/stock-prototype\//,
  );
  assert.doesNotMatch(body, /Load `stock-prototype` in Roam/);
  assert.match(body, /Load Developer Extensions from URL/);
  assert.match(body, /actions\/runs\/123/);
});

test("explains when a branch has no installable prototypes", () => {
  const body = renderPreviewComment({ branch: "agent/docs", prototypes: [] });
  assert.match(body, /does not contain an installable prototype yet/);
});

test("creates the marked preview comment when none exists", async () => {
  const calls = [];
  const result = await upsertPreviewComment({
    repository: "DiscourseGraphs/roam-prototypes",
    pullRequestNumber: 12,
    body: `${PREVIEW_COMMENT_MARKER}\nPreview`,
    request: async (method, pathname, body) => {
      calls.push({ method, pathname, body });
      return method === "GET" ? [] : { id: 1 };
    },
  });

  assert.equal(result, "created");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].pathname, "/repos/DiscourseGraphs/roam-prototypes/issues/12/comments");
});

test("updates the existing bot preview comment", async () => {
  const calls = [];
  const result = await upsertPreviewComment({
    repository: "DiscourseGraphs/roam-prototypes",
    pullRequestNumber: 12,
    body: `${PREVIEW_COMMENT_MARKER}\nUpdated preview`,
    request: async (method, pathname, body) => {
      calls.push({ method, pathname, body });
      if (method === "GET") {
        return [
          {
            id: 42,
            body: PREVIEW_COMMENT_MARKER,
            user: { login: "github-actions[bot]" },
          },
        ];
      }
      return { id: 42 };
    },
  });

  assert.equal(result, "updated");
  assert.equal(calls[1].method, "PATCH");
  assert.equal(
    calls[1].pathname,
    "/repos/DiscourseGraphs/roam-prototypes/issues/comments/42",
  );
});
