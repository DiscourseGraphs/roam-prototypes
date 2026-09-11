/* Result shaping and the query surface. Nothing here talks to Roam. */
import { describe, expect, it, vi } from "vitest";
import { pick, pullWatchEntity, registerSlashCommand, shape, watchReferencesTo } from "~/roam";
import { row } from "./fixtures";

describe("pick", () => {
  it("reads a namespaced key", () => {
    expect(pick({ ":block/uid": "u1" }, "block/uid")).toBe("u1");
  });
  it("falls back to the bare attribute name", () => {
    expect(pick({ uid: "u1" }, "block/uid")).toBe("u1");
  });
  /* The trap: on some surfaces the short key does not come back undefined but
   * resolves to an internal object. Namespaced must win. */
  it("prefers the namespaced key when both exist", () => {
    expect(pick({ ":block/uid": "u1", uid: { garbage: true } }, "block/uid")).toBe("u1");
  });
  it("returns undefined for a missing entity", () => {
    expect(pick(null, "block/uid")).toBeUndefined();
    expect(pick(undefined, "block/uid")).toBeUndefined();
  });
});

describe("shape", () => {
  it("flattens a pulled block, using the direct parent as context", () => {
    const m = shape(row("b1", "{{[[TODO]]}} [[+Me]] hi", 42, "Joel", { addressed: "+Me" }));
    expect(m).toEqual({
      uid: "b1",
      string: "{{[[TODO]]}} [[+Me]] hi",
      time: 42,
      todo: true,
      authorUid: "uid-them",
      author: "Joel",
      page: "Sync / Roam Product",
      parent: "next actions",
    });
  });
  it("reads a mention (no TODO reference) as not a todo", () => {
    expect(shape(row("b1", "[[+Me]] fyi", 1, "Joel", { todo: false })).todo).toBe(false);
  });
  it("uses the page title as context when the block is top-level", () => {
    const m = shape([{ ":block/uid": "b1", ":block/_children": [{ ":node/title": "Sync" }] }]);
    expect(m.parent).toBe("Sync");
  });
  it("tolerates a block with no author", () => {
    const m = shape([{ ":block/uid": "b1" }]);
    expect(m.author).toBeNull();
    expect(m.authorUid).toBeNull();
  });
});

describe("pull watch", () => {
  it("quotes the page title as an EDN string", () => {
    expect(pullWatchEntity('+Ann "Quotey" O\'Neil')).toBe('[:node/title "+Ann \\"Quotey\\" O\'Neil"]');
  });
  it("registers and disposes with the same pattern, entity, and callback", () => {
    const add = vi.fn();
    const remove = vi.fn();
    (window as unknown as Record<string, unknown>).roamAlphaAPI = {
      data: { addPullWatch: add, removePullWatch: remove },
    };
    const cb = () => {};
    const dispose = watchReferencesTo("+Me", cb);
    expect(add).toHaveBeenCalledWith("[{:block/_refs [:block/uid]}]", '[:node/title "+Me"]', cb);
    dispose();
    expect(remove).toHaveBeenCalledWith("[{:block/_refs [:block/uid]}]", '[:node/title "+Me"]', cb);
  });
});

describe("registerSlashCommand", () => {
  it("returns null when the (undocumented) API is missing", () => {
    (window as unknown as Record<string, unknown>).roamAlphaAPI = { ui: {} };
    expect(registerSlashCommand("x", () => "")).toBeNull();
  });
  it("removes by label on dispose", () => {
    const removeCommand = vi.fn();
    (window as unknown as Record<string, unknown>).roamAlphaAPI = {
      ui: { slashCommand: { addCommand: vi.fn(), removeCommand } },
    };
    registerSlashCommand("Send message", () => "")?.();
    expect(removeCommand).toHaveBeenCalledWith({ label: "Send message" });
  });
});
