/* Finding discourse nodes on screen, and keeping that answer current.
 *
 * Two surfaces carry a node: a reference inside a block's text, and the
 * heading of the node's own page. They need different handling.
 *
 * A reference is cheap. Roam puts the title on the element itself, so it can
 * be read synchronously during the contextmenu event.
 *
 * A heading is not. Its title has to come from the page uid, and every read
 * here is async, but preventDefault has to be called synchronously or the
 * native menu wins. So headings are resolved ahead of time by the observer
 * and the answer is parked on the element. The synchronous reconstruction
 * below covers the gap before the observer catches up.
 */
import { cachedTypeForTitle, titleForUid } from "~/graph";

export const MARK_ATTR = "data-cfl-node";
export const TITLE_ATTR = "data-cfl-title";
/* Which page the parked answer was computed for. Roam reuses the heading
 * element across navigations, so without this the menu would confidently
 * answer for the page you were on before. */
export const PAGE_UID_ATTR = "data-cfl-page-uid";

export const REF_SELECTOR = "span.rm-page-ref";
export const TITLE_SELECTOR = "h1.rm-title-display";
const TITLE_CONTAINER = ".rm-title-display-container";

export const titleForRef = (span: Element): string =>
  span.getAttribute("data-tag") ||
  span.parentElement?.getAttribute("data-link-title") ||
  "";

/* Rebuild a page title from its rendered heading.
 *
 * A discourse-node title contains page references ([[EVD]], [[@source]]) and
 * Roam draws their brackets as separate .rm-page-ref__brackets elements, so
 * textContent yields "EVD - content - @source", which no node format matches.
 *
 * roamjs-components ships elToTitle for this, but its only caller inspects
 * the heading's FIRST child node, truncating the title to "[[EVD]]". This
 * walks every child. */
export const elToTitle = (n: Node | null | undefined): string => {
  if (!n) return "";
  if (n.nodeType === 3) return n.nodeValue || "";
  if (n.nodeType !== 1) return "";
  const el = n as Element;
  if (el.classList?.contains("rm-page-ref__brackets")) return "";
  const inner = Array.from(el.childNodes || [])
    .map(elToTitle)
    .join("");
  return el.classList?.contains("rm-page-ref") ? `[[${inner}]]` : inner;
};

export const titleFromHeadingDom = (h1: Element): string =>
  Array.from(h1.childNodes || [])
    .map(elToTitle)
    .join("")
    .trim();

export const pageUidForHeading = (h1: Element): string =>
  h1.closest?.(TITLE_CONTAINER)?.getAttribute("data-page-uid") || "";

export const markRef = (span: Element): void => {
  if (span.hasAttribute(MARK_ATTR)) return;
  // A reference nested inside another one would otherwise answer for the
  // inner page while the user was aiming at the outer.
  if (span.parentElement?.closest(REF_SELECTOR)) return;
  // The [[EVD]] inside a node's own heading is not the node. The heading is
  // handled as a whole, by markHeading.
  if (span.closest(`${TITLE_SELECTOR}, ${TITLE_CONTAINER}`)) return;
  const title = titleForRef(span);
  if (!title) return;
  const type = cachedTypeForTitle(title);
  if (type) span.setAttribute(MARK_ATTR, type);
};

export const markHeading = async (h1: Element): Promise<void> => {
  const uid = pageUidForHeading(h1);
  if (!uid) return;
  // Claimed before the await so a burst of mutations for one heading does
  // not fan out into a burst of identical queries.
  if (h1.getAttribute(PAGE_UID_ATTR) === uid) return;
  h1.setAttribute(PAGE_UID_ATTR, uid);
  const title = await titleForUid(uid);
  if (pageUidForHeading(h1) !== uid) return; // navigated away mid-flight
  const type = title ? cachedTypeForTitle(title) : "";
  if (type) {
    h1.setAttribute(TITLE_ATTR, title);
    h1.setAttribute(MARK_ATTR, type);
  } else {
    h1.removeAttribute(TITLE_ATTR);
    h1.removeAttribute(MARK_ATTR);
  }
};

/* The title for whatever was right-clicked, synchronously. */
export const titleForTarget = (el: Element): string => {
  if (!el.matches?.(TITLE_SELECTOR)) return titleForRef(el);
  return el.getAttribute(TITLE_ATTR) || titleFromHeadingDom(el);
};

export const scan = (root: ParentNode): void => {
  root.querySelectorAll?.(REF_SELECTOR).forEach(markRef);
  root.querySelectorAll?.(TITLE_SELECTOR).forEach((h1) => void markHeading(h1));
};

export const startObserver = (): MutationObserver => {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Roam rewrites a heading's children in place when you navigate, which
      // adds no new heading element for the addedNodes branch below to catch.
      const heading = (record.target as Element)?.closest?.(TITLE_SELECTOR);
      if (heading) void markHeading(heading);
      record.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const el = n as Element;
        if (el.matches?.(REF_SELECTOR)) markRef(el);
        else scan(el);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan(document);
  return observer;
};
