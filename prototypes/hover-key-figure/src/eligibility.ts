/* Which page titles get the chip. Pure. */
import type { DiscourseNodeType } from "~/graph";

/* Zero configured node types (plugin absent or unconfigured) falls back to
 * the house convention for discourse-node titles: `[[RES]] - …` etc. */
export const FALLBACK_TITLE_REGEX = /^\[\[[A-Z]{2,6}\]\] - /;

export const isEligibleTitle = (
  title: string,
  types: DiscourseNodeType[],
  extraRegex: RegExp | null,
): boolean => {
  if (!title) return false;
  if (extraRegex?.test(title)) return true;
  if (types.length) return types.some((t) => t.regex.test(title));
  return FALLBACK_TITLE_REGEX.test(title);
};
