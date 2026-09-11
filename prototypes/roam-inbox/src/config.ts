/* Every knob in one place. What each one does is documented in README.md. */

// Injected by the shared esbuild CLI from package.json; "0.0.0" under vitest.
export const VERSION = process.env.VERSION || "0.0.0";

export const LOG = "[roam-inbox]";
export const logError = (what: string, error: unknown): void =>
  console.error(`${LOG} ${what}`, error);

// The slash-menu entry. Typing "/message" filters Roam's menu down to it.
export const LABEL = "Send message";

// `[[+Name]]` means "addressed to Name". `#[[Name]]` (what /task inserts)
// means "assigned work". Both are surfaced in the panel; only the first badges.
const ADDRESS_PREFIX = "+";
export const addressFor = (name: string): string => `${ADDRESS_PREFIX}${name}`;
// What /message inserts. Matches [[Convention/Inbox]] verbatim.
export const insertFor = (name: string): string => `{{[[TODO]]}} [[${addressFor(name)}]] `;
// What Reply pre-fills: a message back to the sender, so the thread notifies
// both ways instead of dead-ending in a nested bullet nobody queries.
export const replyStubFor = (author: string | null): string => (author ? insertFor(author) : "");

export const MEMBER_CACHE_MS = 2 * 60 * 1000;
export const MAX_FILTER_LEN = 30;
// The browse list (nothing typed yet) shows only users active within this
// window, most recent first. Typing a filter searches every graph member.
export const ACTIVE_WITHIN_DAYS = 60;
// Display pages that are not people. Activity filtering alone cannot catch
// these: MCP and API writes make tokens look active.
export const EXCLUDE_PATTERNS = [/^(Local )?API Token:/i, /^Anonymous(_\d+)?$/];

export const POLL_MS = 60 * 1000; // fallback if the pull watch does not fire
export const WATCH_DEBOUNCE_MS = 300;
export const MOUNT_RETRY_MS = 1000; // one retry if the topbar is not rendered yet
export const TOAST_MS = 9000;
export const TOAST_MAX = 3;
// Roam's own tooltips feel instant; the browser's native `title` waits ~1 s.
export const TIP_DELAY_MS = 80;
// Acknowledged message uids kept per browser. Measured traffic is about four
// messages per person per month, so this is decades.
export const SEEN_MAX = 2000;

export const STYLE_ID = "roam-inbox-style";
export const BADGE_ID = "roam-inbox-badge";

// Drawn inline rather than via Blueprint's `bp3-icon-inbox` class. Roam ships
// Blueprint's SVG icon components and not the per-icon font CSS, so
// `.bp3-icon-inbox::before` resolves to `content: none`: the class rendered an
// empty 16px box and the badge looked like a dot floating in the topbar.
// Verified live on sandbox-discourse-graphs: Icons16 is loaded but unmapped,
// and Roam's own search icon has an <svg> child. Drawing it here also
// survives Roam changing Blueprint versions. `currentColor` keeps it correct
// in dark theme.
export const INBOX_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" ' +
  'fill="none" stroke="currentColor" stroke-width="1.4" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2.2 9.6V3.9c0-.6.5-1.1 1.1-1.1h9.4c.6 0 1.1.5 1.1 1.1v5.7"/>' +
  '<path d="M2.2 9.6h3.1l1 1.7h3.4l1-1.7h3.1v2.5c0 .6-.5 1.1-1.1 1.1H3.3' +
  'c-.6 0-1.1-.5-1.1-1.1z"/>' +
  "</svg>";
