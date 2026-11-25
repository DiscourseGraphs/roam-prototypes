import { afterEach, expect, it, vi } from "vitest";
import { act } from "react-dom/test-utils";
import ds from "datascript";
import { installFakeRoam } from "./fixtures";
import {
  openDiscussions,
  startDiscussions,
  stopDiscussions,
} from "~/discussions";
import {
  findDiscussionSources,
  Q_INLINE_COMMENTS,
  Q_REPLY_COMMENTS,
} from "~/discussion-data";

// DataScript's JS API transacts string attributes. Translate attribute tokens
// only; the joins, predicates, pull shapes and inputs are production code.
const attributes = (query) =>
  query.replace(/:(block|node|create|user)\/([\w-]+)/g, '"$1/$2"');
// Roam returns keyword-prefixed keys when it crosses the JS boundary.
function roamKeys(value) {
  if (Array.isArray(value)) return value.map(roamKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [":" + key, roamKeys(v)]),
  );
}
function archive() {
  const ref = { ":db/valueType": ":db.type/ref" };
  const many = { ...ref, ":db/cardinality": ":db.cardinality/many" };
  const schema = {
    "block/uid": { ":db/unique": ":db.unique/identity" },
    "block/page": ref,
    "block/children": many,
    "block/parents": many,
    "block/refs": many,
    "create/user": ref,
    "user/display-page": ref,
  };
  const entities = [
    { ":db/id": 1, "block/uid": "archive", "node/title": "Synthetic archive" },
  ];
  function block(uid, parent, string = uid, extra = {}) {
    const id = entities.length + 1;
    const owner = entities[parent - 1];
    (owner["block/children"] ||= []).push(id);
    entities.push({
      ":db/id": id,
      "block/uid": uid,
      "block/string": string,
      "block/page": 1,
      "block/parents": [...(owner["block/parents"] || []), parent],
      "block/order": owner["block/children"].length - 1,
      ...extra,
    });
    return id;
  }
  const meeting = block("meeting", 1);
  const agenda = block("agenda", meeting);
  const selected = block("selected", agenda);
  for (let i = 2; i < 127; i++) block("meeting-" + i, meeting);
  const sources = [
    selected,
    ...Array.from({ length: 5 }, (_, i) => block("other-" + i, 1)),
  ];
  const comments = block("comments", 1, "[[roam/comments]]");
  const author = block("author", block("date", comments), "[[Test author]]");
  function container(id) {
    return block(
      "ref-" + id,
      author,
      "((" + entities[id - 1]["block/uid"] + "))",
      { "block/refs": [id] },
    );
  }
  const containers = sources.map(container);
  const topic = block("target-thread", containers[0], "Meeting topic");
  block("reply", container(topic), "Meeting reply");
  for (let i = 1; i <= 6; i++) block("topic-" + i, containers[Math.min(i, 5)]);
  block("prose", author, "A prose reference", { "block/refs": [selected] });
  while (entities.length < 27672) block("filler-" + entities.length, 1);
  return ds.db_with(ds.empty_db(schema), entities);
}

afterEach(() => {
  act(stopDiscussions);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("renders seven archive topics, one focused meeting topic, and reads only the clicked source and its replies inline", async () => {
  const db = archive();
  const api = installFakeRoam();
  const reads = [];
  api.data.async.q = async (query, ...inputs) => {
    reads.push({ query, inputs });
    return roamKeys(ds.q(attributes(query), db, ...inputs));
  };
  const pulls = [];
  api.data.async.pull = async (pattern, [attr, uid]) => {
    pulls.push(uid);
    return roamKeys(ds.pull(db, attributes(pattern), [attr.slice(1), uid]));
  };
  let route = "archive";
  api.ui.mainWindow = { getOpenPageOrBlockUid: () => route };
  vi.stubGlobal("CSS", { escape: (uid) => uid });
  document.body.innerHTML =
    '<main class="roam-body-main"><div class="roam-article"><div class="rm-block-main" data-block-uid="selected"><div class="rm-block-text" id="block-selected">Selected source</div></div></div></main>';
  expect(ds.q('[:find (count ?b) . :where [?b "block/page" 1]]', db)).toBe(
    27671,
  );
  expect(
    ds.q(
      '[:find (count ?b) . :where [?m "block/uid" "meeting"] [?b "block/parents" ?m]]',
      db,
    ),
  ).toBe(127);
  await act(async () => {
    startDiscussions();
    await openDiscussions();
  });
  const topics = () => [
    ...document.querySelectorAll(".rmi-discussion-rail [data-thread-uid]"),
  ];
  expect(topics()).toHaveLength(7);
  route = "meeting";
  await act(async () => {
    window.dispatchEvent(new Event("hashchange"));
  });
  expect(topics().map((el) => el.dataset.threadUid)).toEqual(["target-thread"]);
  expect(
    document.querySelector('[aria-label="Outline discussions"]'),
  ).toBeTruthy();
  expect(reads.some((r) => r.query.includes("?term"))).toBe(false);
  const context = {
    pageUid: "archive",
    outlineUid: route,
    title: "Synthetic archive",
  };
  expect(
    (await findDiscussionSources(context, "selected")).map((s) => s.uid),
  ).toEqual(["selected"]);
  expect(await findDiscussionSources(context, "filler")).toEqual([]);
  expect(
    (await findDiscussionSources(context, "")).some((s) => s.uid === "meeting"),
  ).toBe(true);
  expect(
    (await findDiscussionSources({ ...context, sourceUid: "selected" }, ""))[0]
      .uid,
  ).toBe("selected");
  expect(
    (
      await findDiscussionSources(
        { pageUid: "archive", title: "Archive" },
        "filler",
      )
    ).length,
  ).toBe(50);
  expect(await findDiscussionSources(context, "[.*")).toEqual([]);
  await act(async () => {
    document.querySelector('[aria-label="Refresh discussions"]').click();
  });
  expect(topics()).toHaveLength(1);
  await act(async () => {
    document.querySelector('[aria-label="Close discussions"]').click();
  });
  reads.length = 0;
  pulls.length = 0;
  await act(async () => {
    document.querySelector(".rmi-discussion-badge button").click();
  });
  expect(
    document.querySelector(".rmi-discussion-inline").textContent,
  ).toContain("Meeting reply");
  expect(pulls).toEqual([]);
  expect(reads).toEqual([
    { query: Q_INLINE_COMMENTS, inputs: ["selected"] },
    { query: Q_REPLY_COMMENTS, inputs: [["target-thread"]] },
  ]);
}, 30000);
