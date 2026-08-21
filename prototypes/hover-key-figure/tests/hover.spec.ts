// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIP_CLASS, getRefTitle, initHover, type HoverController } from "~/hover";

const TITLE = "[[RES]] - the finding - [[@src]]";

const makeRef = (title: string): HTMLElement => {
  // Roam's structure for a [[bracket]] reference: the data-link-title lives
  // on an ancestor of span.rm-page-ref.
  const outer = document.createElement("span");
  outer.setAttribute("data-link-title", title);
  const ref = document.createElement("span");
  ref.className = "rm-page-ref rm-page-ref--link";
  ref.textContent = title;
  outer.appendChild(ref);
  document.body.appendChild(outer);
  return ref;
};

const hover = (el: Element, x = 0, y = 0) => {
  el.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }),
  );
  el.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }),
  );
};

describe("getRefTitle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads data-tag from tag references", () => {
    const ref = document.createElement("span");
    ref.className = "rm-page-ref rm-page-ref--tag";
    ref.setAttribute("data-tag", TITLE);
    document.body.appendChild(ref);
    expect(getRefTitle(ref)).toBe(TITLE);
  });

  it("reads data-link-title from an ancestor for bracket references", () => {
    const ref = makeRef(TITLE);
    expect(getRefTitle(ref)).toBe(TITLE);
  });

  it("returns empty for unadorned spans", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    expect(getRefTitle(el)).toBe("");
  });
});

describe("initHover", () => {
  let controller: HoverController;
  const onOpen = vi.fn();
  const prefetch = vi.fn(async () => null);

  beforeEach(() => {
    vi.useFakeTimers();
    onOpen.mockClear();
    prefetch.mockClear();
    controller = initHover({
      isEligibleTitle: (t) => t.startsWith("[[RES]]"),
      hoverDelayMs: () => 150,
      prefetch,
      onOpen,
    });
  });

  afterEach(() => {
    controller.destroy();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows the chip after the hover delay, and prefetches", async () => {
    const ref = makeRef(TITLE);
    hover(ref);
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(false);
    vi.advanceTimersByTime(160);
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(true);
    expect(prefetch).toHaveBeenCalledWith(TITLE);
  });

  const stubRect = (el: Element, rect: Partial<DOMRect>) =>
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ x: 0, y: 0, toJSON: () => "", ...rect }) as DOMRect,
      configurable: true,
    });

  it("places the chip below the link's whole line block, at the pointer's x", () => {
    // A three-line wrapped link: the union rect spans top 180 → bottom 250.
    // The pointer is on the first line (y=190); the chip must clear ALL
    // lines, not sit between them. jsdom viewport is 1024x768.
    const ref = makeRef(TITLE);
    stubRect(ref, { left: 100, right: 500, top: 180, bottom: 250, width: 400, height: 70 });
    hover(ref, 300, 190);
    vi.advanceTimersByTime(160);
    expect(controller.chip.style.left).toBe("300px");
    expect(controller.chip.style.top).toBe(`${250 + 4}px`);
  });

  it("clamps the chip's x to the link's horizontal extent", () => {
    const ref = makeRef(TITLE);
    stubRect(ref, { left: 100, right: 500, top: 180, bottom: 250, width: 400, height: 70 });
    hover(ref, 900, 190); // pointer x reported outside the link's span
    vi.advanceTimersByTime(160);
    expect(controller.chip.style.left).toBe("500px");
  });

  it("flips above the block when the viewport runs out below", () => {
    const ref = makeRef(TITLE);
    // bottom at 760 leaves no room below in a 768px-tall jsdom viewport;
    // chip height falls back to 22 when offsetHeight is 0 (jsdom).
    stubRect(ref, { left: 100, right: 500, top: 700, bottom: 760, width: 400, height: 60 });
    hover(ref, 300, 710);
    vi.advanceTimersByTime(160);
    expect(controller.chip.style.top).toBe(`${700 - 22 - 4}px`);
  });

  it("marks the chip empty when prefetch resolves to no figure", async () => {
    const ref = makeRef(TITLE);
    hover(ref);
    vi.advanceTimersByTime(160);
    await vi.waitFor(() =>
      expect(controller.chip.classList.contains(`${CHIP_CLASS}--empty`)).toBe(true),
    );
  });

  it("ignores ineligible references", () => {
    const ref = makeRef("Ordinary page");
    hover(ref);
    vi.advanceTimersByTime(500);
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(false);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("hides the chip after the pointer leaves, with a grace period", () => {
    const ref = makeRef(TITLE);
    hover(ref);
    vi.advanceTimersByTime(160);
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(true);
    hover(document.body);
    vi.advanceTimersByTime(200); // inside the grace window
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(true);
    vi.advanceTimersByTime(200); // past it
    expect(controller.chip.classList.contains(`${CHIP_CLASS}--visible`)).toBe(false);
  });

  it("reports the hovered title on chip click", () => {
    const ref = makeRef(TITLE);
    hover(ref);
    vi.advanceTimersByTime(160);
    controller.chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ title: TITLE }),
    );
  });

  it("removes its DOM and listeners on destroy", () => {
    const ref = makeRef(TITLE);
    controller.destroy();
    expect(document.querySelector(`.${CHIP_CLASS}`)).toBeNull();
    hover(ref);
    vi.advanceTimersByTime(500);
    expect(prefetch).not.toHaveBeenCalled();
  });
});
