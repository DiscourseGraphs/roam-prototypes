/* What lands on the clipboard, for each of the two copy items. */
import { assembleLatex, unwrapLinks, type LatexPayload } from "~/latex";
import { parseNodeTitle } from "~/nodeFormat";
import { findNodeTypeForTitle, resolveBlockRefs } from "~/graph";

export const latexForTitle = async (title: string): Promise<LatexPayload> => {
  const nodeType = findNodeTypeForTitle(title);
  if (!nodeType) return { latex: "", warning: `"${title}" is not a discourse node.` };
  const resolved = await resolveBlockRefs(title);
  const { content, source } = parseNodeTitle(resolved, nodeType.format);
  return assembleLatex(content, source, title);
};

/* Built from the node's parsed parts rather than its raw title, so the type
 * marker is dropped and the citekey arrives unbracketed. */
export const labelForTitle = (title: string): string => {
  const nodeType = findNodeTypeForTitle(title);
  if (!nodeType) return unwrapLinks(title);
  const { content, source } = parseNodeTitle(title, nodeType.format);
  const label = unwrapLinks(content);
  const src = unwrapLinks(source);
  return src ? `${label} - ${src}` : label;
};
