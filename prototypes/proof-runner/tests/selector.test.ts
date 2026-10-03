import { beforeEach, describe, expect, it } from "vitest";
import { parseSelector, queryAll } from "../src/roam/selector";

// jsdom has no layout, so :visible (a non-empty box) is left to the
// real-browser tests in dg-demo-videos.

const label = (element: Element): string => element.id;

describe("the Playwright selector forms kits use", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="bp3-dialog" id="dialog" data-type="discourse-context-view">
        <div class="bp3-menu-item" id="claim-row">Claim <button id="only-claim">Only</button></div>
        <div class="bp3-menu-item" id="evidence-row">Evidence <button id="only-evidence">Only</button></div>
        <button id="next" title="Sort by title">Next (1)</button>
        <button id="cancel">Cancel</button>
        <input class="bp3-input" id="first-input"><input class="bp3-input" id="second-input">
        <p id="content">Content: three nodes</p>
        <script id="script">window.cancelable = true;</script>
      </div>`;
  });

  it("splits parts on >> and reads nth", () => {
    expect(parseSelector(".a >> nth=-1").map((part) => part.kind)).toEqual(["css", "nth"]);
  });

  it("matches :has-text, :text, >> nth, text= and child combinators", () => {
    const q = (selector: string): string[] => queryAll(selector).map(label);
    expect(q('.bp3-dialog .bp3-menu-item:has-text("claim") button:has-text("Only")')).toEqual(["only-claim"]);
    expect(q(".bp3-dialog input.bp3-input >> nth=0")).toEqual(["first-input"]);
    expect(q(".bp3-dialog input.bp3-input >> nth=-1")).toEqual(["second-input"]);
    expect(q('[data-type="discourse-context-view"] :text("Content:")')).toEqual(["content"]);
    expect(q('.bp3-dialog button[title^="Sort by"]')).toEqual(["next"]);
    expect(q(".bp3-dialog > button")).toEqual(["next", "cancel"]);
    expect(q('.bp3-dialog >> button:has-text("Only") >> nth=1')).toEqual(["only-evidence"]);
  });

  it("doesn't read script text, as Playwright doesn't", () => {
    expect(queryAll("text=Cancel").map(label)).toEqual(["cancel"]);
  });
});
