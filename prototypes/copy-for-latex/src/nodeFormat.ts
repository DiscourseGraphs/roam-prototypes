/* Discourse-node title grammar. Pure.
 *
 * A node type declares a format such as `[[EVD]] - {content} - {Source}` on
 * its `discourse-graph/nodes/{Type}` page. These two functions turn that into
 * a matcher and pull the pieces back out.
 */

export type NodeFormat = { regex: RegExp; names: string[] };

/* Mirrors the plugin's getDiscourseNodeFormatExpression: escape only these
 * five characters, lazy captures, anchored, dotall. Agreeing with the plugin
 * about where content ends matters more than being cleverer than it. */
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

export type ParsedNode = { content: string; source: string };

export const parseNodeTitle = (title: string, format: string): ParsedNode => {
  const empty: ParsedNode = { content: "", source: "" };
  if (!format) return empty;
  const { regex, names } = formatToRegex(format);
  const match = regex.exec(title || "");
  if (!match) return empty;
  const at = (name: string) => {
    const i = names.indexOf(name);
    return i < 0 ? "" : (match[i + 1] || "").trim();
  };
  return { content: at("content"), source: at("source") };
};
