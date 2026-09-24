/* Which page titles get the chip. Pure. */
import type { DiscourseNodeType } from "~/graph";

/* The house convention for discourse-node title prefixes: `[[RES]] - …`.
 *
 * Always active, IN ADDITION to the graph's configured formats, because the
 * formats are strict in ways a presenter should not trip over: an EVD titled
 * `[[EVD]] - … clustering.  -` (trailing dash, no Source yet) fails the
 * `[[EVD]] - {content} - {Source}` regex — the plugin itself does not
 * recognize that page as a node — but its figure is exactly what the
 * presenter wants to show. This chip is read-only, so tolerating near-miss
 * titles costs nothing; the plugin's own features remain as strict as ever. */
export const FALLBACK_TITLE_REGEX = /^\[\[[A-Z]{2,6}\]\] - /;

export const isEligibleTitle = (
  title: string,
  types: DiscourseNodeType[],
  extraRegex: RegExp | null,
): boolean => {
  if (!title) return false;
  if (extraRegex?.test(title)) return true;
  if (types.some((t) => t.regex.test(title))) return true;
  return FALLBACK_TITLE_REGEX.test(title);
};
