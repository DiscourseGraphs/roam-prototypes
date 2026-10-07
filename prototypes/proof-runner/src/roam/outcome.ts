import type { Verdict } from "../core/kit";
import type { CaseRecord } from "../core/machine";

export const ICON: Record<Verdict, string> = { pass: "✓", fail: "✗", skip: "⏭" };

const firstLine = (text: string, limit = 300): string => text.split("\n")[0].slice(0, limit);

const quoted = (text: string): string => `"${firstLine(text, 120)}"`;

export const howText = (record: CaseRecord): string => {
  if (record.how === "checked") return record.verdict === "pass" ? "checked by the runner" : "the runner's check failed";
  if (record.how === "judged") return record.verdict === "pass" ? "passed on your call" : "failed on your call";
  if (record.how === "marked") return "failed by you during the case";
  if (record.how === "skipped") return "skipped";
  return "no check, every step ran";
};

export const outcomeText = (record: CaseRecord): string => {
  const parts = [howText(record)];
  if (record.note && record.how !== "unchecked") parts.push(firstLine(record.note));
  if (record.yourNote) parts.push(`you: ${firstLine(record.yourNote)}`);
  if (record.byHand) parts.push("done by hand");
  for (const why of record.skippedSteps) parts.push(`step skipped: ${quoted(why)}`);
  for (const why of record.fixedSteps) parts.push(`step fixed during the run: ${quoted(why)}`);
  for (const why of record.deniedSteps) parts.push(`code not allowed: ${quoted(why)}`);
  if (record.retries) parts.push(`retried ${record.retries} time${record.retries === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

export const logLine = (title: string, record: CaseRecord | null, earlier: boolean): string =>
  record ? `${ICON[record.verdict]} ${title} · ${outcomeText(record)}${earlier ? " · from the earlier run" : ""}` : `○ ${title} · not run`;

export type LastResult = { icon: string; verdict: Verdict | null; detail: string };

const VERDICTS: Record<string, Verdict | null> = { "✓": "pass", "✗": "fail", "⏭": "skip", "○": null };

export const parseLogLine = (line: string, title: string): LastResult | null => {
  const match = /^(✓|✗|⏭|○) ([\s\S]*)$/.exec(line.trim());
  if (!match || !match[2].startsWith(title)) return null;
  const rest = match[2].slice(title.length);
  if (rest && !rest.startsWith(" · ") && !rest.startsWith(": ")) return null;
  return { icon: match[1], verdict: VERDICTS[match[1]], detail: rest.replace(/^( · |: )/, "") };
};
