import { describe, expect, it } from "vitest";
import { parseArgs } from "~/args";
import { dailyNoteTime, displayText, headerKind, withDone } from "~/text";

describe("headerKind", () => {
  const ANCHOR = "yuAIplpov";
  it.each([
    "next actions",
    "**next actions**",
    "Next Actions:",
    "Actions",
    "Action items",
    "Action items/for next time",
    "next steps",
    "Next step:",
    "## next actions",
    "next actions by Friday",
    "next actions this week",
  ])("treats %j as a header", (s) => {
    expect(headerKind(s, ANCHOR)).toBe("wording");
  });

  it.each([
    "next steps for cybrarian position",
    "actions speak louder",
    "{{[[TODO]]}} next actions",
    "we discussed next actions at length",
  ])("does not treat %j as a header", (s) => {
    expect(headerKind(s, ANCHOR)).toBeNull();
  });

  it("prefers the anchor ref over wording, even on novel wording", () => {
    expect(headerKind("To do before we meet again [ℹ](((yuAIplpov)))", ANCHOR)).toBe("anchor");
  });
});

describe("withDone", () => {
  it("flips both marker spellings, both ways", () => {
    expect(withDone("{{[[TODO]]}} a", true)).toBe("{{[[DONE]]}} a");
    expect(withDone("{{TODO}} a", true)).toBe("{{DONE}} a");
    expect(withDone("{{[[DONE]]}} a", false)).toBe("{{[[TODO]]}} a");
    expect(withDone("next: {{[[DONE]]}} a", false)).toBe("next: {{[[TODO]]}} a");
  });
});

describe("displayText", () => {
  const blocks: Record<string, string> = {
    aaaaaaaaa: "{{[[DONE]]}} ((bbbbbbbbb))",
    bbbbbbbbb: "the question [[with a link]]",
    loopxxxxx: "((loopxxxxx)) again",
  };
  const lookup = (u: string) => blocks[u];

  it("resolves refs inside refs, and strips markup from the result", () => {
    expect(displayText("((aaaaaaaaa)) -- ongoing", lookup, 4)).toBe("the question with a link -- ongoing");
  });

  it("drops a ref whose target is unknown", () => {
    expect(displayText("see ((zzzzzzzzz)) here", lookup, 4)).toBe("see here");
  });

  it("terminates on a reference cycle", () => {
    expect(displayText("((loopxxxxx))", lookup, 4)).toContain("again");
  });

  it("removes embeds, images, and alias targets", () => {
    expect(
      displayText("{{[[TODO]]}} read [the doc](https://x.y) ![](https://img) {{[[embed]]: ((aaaaaaaaa))}}", lookup, 4),
    ).toBe("read the doc");
  });
});

describe("dailyNoteTime", () => {
  it("reads MM-DD-YYYY as local midnight", () => {
    expect(dailyNoteTime("09-22-2026")).toBe(new Date(2026, 8, 22).getTime());
    expect(dailyNoteTime("not-a-date")).toBe(0);
  });
});

describe("parseArgs", () => {
  it("finds the host block wherever Roam puts it, and reads flags and the window", () => {
    expect(parseArgs(["debug", { "block-uid": "abc" }, "365", "Meeting"])).toEqual({
      hostUid: "abc",
      lookbackDays: 365,
      debug: true,
      forcedMode: "meeting",
    });
    expect(parseArgs([]).lookbackDays).toBe(120);
    expect(parseArgs([0]).lookbackDays).toBe(120);
  });
});
