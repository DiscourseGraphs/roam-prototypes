/* Discourse-node title grammar. Pure.
 *
 * A node type declares a format such as `[[EVD]] - {content} - {Source}` on
 * its `discourse-graph/nodes/{Type}` page; this turns that into a matcher.
 *
 * Ported from prototypes/copy-for-latex/src/nodeFormat.ts, which mirrors the
 * plugin's getDiscourseNodeFormatExpression: escape only these five
 * characters, lazy captures, anchored, dotall. Agreeing with the plugin about
 * what counts as a node title matters more than being cleverer than it.
 */

export type NodeFormat = { regex: RegExp; names: string[] };

export const formatToRegex = (format: string): NodeFormat => {
  const names: string[] = [];
  const placeholder = /\{([a-zA-Z]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = placeholder.exec(format))) names.push((m[1] as string).toLowerCase());
  const source = format
    .replace(/(\[|\]|\?|\.|\+)/g, "\\$1")
    .replace(/\{[a-zA-Z]+\}/g, "(.*?)");
  return { regex: new RegExp(`^${source}$`, "s"), names };
};
