/* Finding a discourse node on screen. Real jsdom, so closest/matches/classList
 * behave the way they do in Roam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARK_ATTR,
  PAGE_UID_ATTR,
  TITLE_ATTR,
  elToTitle,
  markHeading,
  markRef,
  titleForTarget,
  titleFromHeadingDom,
} from "~/dom";
import { setNodeTypes } from "~/graph";

const EVD = "[[EVD]] - {content} - {Source}";
const NODE_TITLE = "[[EVD]] - The tube pinched - [[@vasan2020mechanical]]";

const stubTitles = (byUid: Record<string, string>) => {
  const q = vi.fn(async (_query: string, uid: unknown) => {
    const title = byUid[uid as string];
    return title ? [[{ ":node/title": title }]] : [];
  });
  (window as unknown as Record<string, unknown>).roamAlphaAPI = { data: { async: { q } } };
  return q;
};

/* How Roam renders "[[EVD]]": the brackets are their own elements. */
const heading = (inner: string, pageUid?: string) => {
  document.body.innerHTML = `<div class="roam-article"><div class="rm-title-display-container"${
    pageUid ? ` data-page-uid="${pageUid}"` : ""
  }><h1 class="rm-title-display">${inner}</h1></div></div>`;
  return document.querySelector("h1.rm-title-display") as HTMLElement;
};

const ref = (label: string) =>
  `<span class="rm-page-ref__brackets">[[</span><span class="rm-page-ref rm-page-ref--link">${label}</span><span class="rm-page-ref__brackets">]]</span>`;

const FULL_TITLE_DOM = `${ref("EVD")} - The tube pinched - ${ref("@vasan2020mechanical")}`;

beforeEach(() => {
  setNodeTypes([{ type: "Evidence", format: EVD }]);
});
afterEach(() => {
  setNodeTypes([]);
  document.body.innerHTML = "";
});

describe("elToTitle", () => {
  /* Roam draws the brackets as separate elements. Read the text naively and
   * "[[EVD]] - x - [[@y]]" comes back as "EVD - x - @y", which no node format
   * matches, so the menu silently never appears. */
  it("restores brackets that are rendered as their own elements", () => {
    const h1 = heading(ref("EVD"));
    expect(elToTitle(h1)).toBe("[[EVD]]");
  });

  /* roamjs-components ships elToTitle, but its only caller inspects the
   * heading's FIRST child node, truncating this to "[[EVD]]". */
  it("walks every child, not just the first", () => {
    expect(titleFromHeadingDom(heading(FULL_TITLE_DOM))).toBe(NODE_TITLE);
  });

  it("leaves a plain title alone", () => {
    expect(titleFromHeadingDom(heading("Just a normal page"))).toBe("Just a normal page");
  });
});

describe("markHeading", () => {
  it("parks the title and type from the page uid", async () => {
    stubTitles({ "uid-1": NODE_TITLE });
    const h1 = heading(FULL_TITLE_DOM, "uid-1");
    await markHeading(h1);
    expect(h1.getAttribute(TITLE_ATTR)).toBe(NODE_TITLE);
    expect(h1.getAttribute(MARK_ATTR)).toBe("Evidence");
  });

  it("marks nothing on a page that is not a discourse node", async () => {
    stubTitles({ "uid-1": "Meeting notes" });
    const h1 = heading("Meeting notes", "uid-1");
    await markHeading(h1);
    expect(h1.getAttribute(MARK_ATTR)).toBeNull();
  });

  it("does nothing without a page uid to resolve from", async () => {
    const q = stubTitles({});
    await markHeading(heading(FULL_TITLE_DOM));
    expect(q).not.toHaveBeenCalled();
  });

  /* A burst of mutations for one heading must not fan out into a burst of
   * identical queries. */
  it("queries once for a heading, however many times it is asked", async () => {
    const q = stubTitles({ "uid-1": NODE_TITLE });
    const h1 = heading(FULL_TITLE_DOM, "uid-1");
    await Promise.all([markHeading(h1), markHeading(h1), markHeading(h1)]);
    expect(q).toHaveBeenCalledTimes(1);
  });

  /* Roam reuses the heading element across navigations. Without re-resolving,
   * the menu would confidently answer for the page you were on before. */
  it("re-resolves when the same element is reused for another page", async () => {
    stubTitles({ "uid-1": NODE_TITLE, "uid-2": "[[EVD]] - A second finding - @key2020" });
    const h1 = heading(FULL_TITLE_DOM, "uid-1");
    await markHeading(h1);
    expect(h1.getAttribute(TITLE_ATTR)).toBe(NODE_TITLE);

    (h1.closest(".rm-title-display-container") as HTMLElement).setAttribute(
      "data-page-uid",
      "uid-2",
    );
    await markHeading(h1);
    expect(h1.getAttribute(TITLE_ATTR)).toBe("[[EVD]] - A second finding - @key2020");
    expect(h1.getAttribute(PAGE_UID_ATTR)).toBe("uid-2");
  });

  it("clears a stale mark when the new page is not a node", async () => {
    stubTitles({ "uid-1": NODE_TITLE, "uid-2": "Meeting notes" });
    const h1 = heading(FULL_TITLE_DOM, "uid-1");
    await markHeading(h1);
    (h1.closest(".rm-title-display-container") as HTMLElement).setAttribute(
      "data-page-uid",
      "uid-2",
    );
    await markHeading(h1);
    expect(h1.getAttribute(MARK_ATTR)).toBeNull();
    expect(h1.getAttribute(TITLE_ATTR)).toBeNull();
  });
});

describe("markRef", () => {
  const refIn = (html: string) => {
    document.body.innerHTML = html;
    return document.querySelector("span.rm-page-ref") as HTMLElement;
  };

  it("marks a reference to a discourse node", () => {
    const span = refIn(`<span class="rm-page-ref" data-tag="${NODE_TITLE}">x</span>`);
    markRef(span);
    expect(span.getAttribute(MARK_ATTR)).toBe("Evidence");
  });

  it("leaves an ordinary page reference alone", () => {
    const span = refIn(`<span class="rm-page-ref" data-tag="Meeting notes">x</span>`);
    markRef(span);
    expect(span.getAttribute(MARK_ATTR)).toBeNull();
  });

  /* A reference nested inside another would answer for the inner page while
   * the user was aiming at the outer. */
  it("skips a reference nested inside another reference", () => {
    document.body.innerHTML = `<span class="rm-page-ref" data-tag="outer"><span class="rm-page-ref" id="inner" data-tag="${NODE_TITLE}">x</span></span>`;
    const inner = document.getElementById("inner") as HTMLElement;
    markRef(inner);
    expect(inner.getAttribute(MARK_ATTR)).toBeNull();
  });

  /* The [[EVD]] inside a node's own heading is not the node. */
  it("skips a reference inside a page heading, which markHeading owns", () => {
    document.body.innerHTML = `<h1 class="rm-title-display"><span class="rm-page-ref" data-tag="${NODE_TITLE}">x</span></h1>`;
    const span = document.querySelector("span.rm-page-ref") as HTMLElement;
    markRef(span);
    expect(span.getAttribute(MARK_ATTR)).toBeNull();
  });

  it("reads the title from the parent when the reference is bracketed", () => {
    document.body.innerHTML = `<span data-link-title="${NODE_TITLE}"><span class="rm-page-ref">x</span></span>`;
    const span = document.querySelector("span.rm-page-ref") as HTMLElement;
    markRef(span);
    expect(span.getAttribute(MARK_ATTR)).toBe("Evidence");
  });
});

describe("titleForTarget", () => {
  it("prefers the parked title on a heading", async () => {
    stubTitles({ "uid-1": NODE_TITLE });
    const h1 = heading("stale rendered text", "uid-1");
    await markHeading(h1);
    expect(titleForTarget(h1)).toBe(NODE_TITLE);
  });

  /* Covers the gap between the heading appearing and the observer resolving it. */
  it("falls back to the DOM before the observer has caught up", () => {
    expect(titleForTarget(heading(FULL_TITLE_DOM, "uid-1"))).toBe(NODE_TITLE);
  });

  it("reads a reference from its own attribute", () => {
    document.body.innerHTML = `<span class="rm-page-ref" data-tag="${NODE_TITLE}">x</span>`;
    const span = document.querySelector("span.rm-page-ref") as HTMLElement;
    expect(titleForTarget(span)).toBe(NODE_TITLE);
  });
});
