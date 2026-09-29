/* The render arguments a widget was invoked with:
 *
 *   {{roam/render: ((code-uid))}}             defaults
 *   {{roam/render: ((code-uid)) 365}}         look back 365 days
 *   {{roam/render: ((code-uid)) page debug}}  page mode inside a meeting, diagnostics
 */
import { LOOKBACK_DAYS } from "~/config";

export type WidgetArgs = {
  hostUid: string | null;
  lookbackDays: number;
  debug: boolean;
  /* Show page mode even inside a meeting. (Meeting mode needs a meeting, so
   * there is nothing to force the other way; `meeting` overrides `page`.) */
  forcePage: boolean;
};

/* Roam passes the host block as an object somewhere in the list: first on
 * some graphs, not on others. So scan for it rather than trusting an index. */
export const parseArgs = (argv: readonly unknown[]): WidgetArgs => {
  let hostUid: string | null = null;
  let lookback: number | null = null;
  const flags: string[] = [];
  for (const a of argv) {
    if (a && typeof a === "object" && typeof (a as Record<string, unknown>)["block-uid"] === "string")
      hostUid = (a as Record<string, string>)["block-uid"];
    else if (typeof a === "number") lookback = a;
    else if (typeof a === "string") {
      // A bare number is the lookback window; anything else is a flag.
      if (/^\d+$/.test(a.trim())) lookback = parseInt(a.trim(), 10);
      else flags.push(a.toLowerCase());
    }
  }
  return {
    hostUid,
    lookbackDays: lookback !== null && lookback > 0 ? lookback : LOOKBACK_DAYS,
    debug: flags.includes("debug"),
    forcePage: flags.includes("page") && !flags.includes("meeting"),
  };
};
