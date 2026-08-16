import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_COMMENT_MARKER,
  renderPreviewComment,
  upsertPreviewComment,
} from "../scripts/comment-preview.mjs";

test("renders resolved Roam preview links", () => {
  const body = renderPreviewComment({
    branch: "agent/stock-prototype",
    prototypes: ["stock-prototype"],
    runUrl: "https://github.com/DiscourseGraphs/roam-prototypes/actions/runs/123",
  });

  assert.match(body, new RegExp(PREVIEW_COMMENT_MARKER));
  assert.match(
    body,
    /https:\/\/discoursegraphs\.com\/releases\/prototypes\/previews\/agent--stock-prototype\/stock-prototype\//,
  );
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
