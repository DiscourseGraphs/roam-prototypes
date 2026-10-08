import type { Verdict } from "../core/kit";
import type { CaseRecord } from "../core/machine";
import type { CaseHistory } from "./words";

export const ICON: Record<Verdict, string> = { pass: "✓", fail: "✗", skip: "⏭" };

const firstLine = (text: string, limit = 300): string => text.split("\n")[0].slice(0, limit);

const quoted = (text: string): string => `"${firstLine(text, 120)}"`;

export const howText = (record: CaseRecord): string => {
  if (record.how === "checked") return record.verdict === "pass" ? "checked by the runner" : "the runner's check failed";
  if (record.how === "judged") return record.verdict === "pass" ? "passed on your call" : "failed on your call";
  if (record.how === "marked") return record.verdict === "pass" ? "passed by you" : "failed by you during the case";
  if (record.how === "skipped") return "couldn't be tested";
  return "no check, every step ran";
};

export const outcomeText = (record: CaseRecord): string => {
  const parts = [howText(record)];
  if (record.note && record.how !== "unchecked") parts.push(firstLine(record.note));
  if (record.yourNote) parts.push(`you: ${firstLine(record.yourNote)}`);
  if (record.byHand) parts.push("done by hand");
  for (const step of record.handSteps ?? []) parts.push(`step ${step.index + 1} done by you: ${quoted(step.why)}`);
  if (record.touched) parts.push("you used the page before trying again");
  for (const why of record.skippedSteps) parts.push(`step skipped: ${quoted(why)}`);
  for (const why of record.fixedSteps) parts.push(`step fixed during the run: ${quoted(why)}`);
  for (const why of record.deniedSteps) parts.push(`code not allowed: ${quoted(why)}`);
  if (record.retries) parts.push(`retried ${record.retries} time${record.retries === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

// left: the tester left the case out, and said why (or didn't).
export const logLine = (title: string, record: CaseRecord | null, earlier: boolean, left?: { why: string | null }): string =>
  record
    ? `${ICON[record.verdict]} ${title} · ${outcomeText(record)}${earlier ? " · from the earlier run" : ""}`
    : `○ ${title} · ${left ? `left out by the tester${left.why ? `: ${firstLine(left.why)}` : ""}` : "not run"}`;

export type LastResult = { icon: string; verdict: Verdict | null; detail: string };

const VERDICTS: Record<string, Verdict | null> = { "✓": "pass", "✗": "fail", "⏭": "skip", "○": null };

export const parseLogLine = (line: string, title: string): LastResult | null => {
  const match = /^(✓|✗|⏭|○) ([\s\S]*)$/.exec(line.trim());
  if (!match || !match[2].startsWith(title)) return null;
  const rest = match[2].slice(title.length);
  if (rest && !rest.startsWith(" · ") && !rest.startsWith(": ")) return null;
  return { icon: match[1], verdict: VERDICTS[match[1]], detail: rest.replace(/^( · |: )/, "") };
};

// A run's line under the {{proof}} block's runs, read back: what passed, on
// which build, how long it took and when. Lines written before a field
// existed read as null or 0 for it.
export type RunSummary = {
  passed: number;
  total: number;
  failed: number;
  skipped: number;
  // Cases the tester left out of the run.
  left: number;
  stopped: boolean;
  branch: string | null;
  commit: string | null;
  minutes: number | null;
  when: string | null;
  terminal: boolean;
};

export const parseRunSummary = (line: string): RunSummary | null => {
  const text = line.trim();
  const head = /^[✓✗] (\d+)\/(\d+) passed/.exec(text);
  if (!head) return null;
  const parts = text.split(" · ");
  const count = (pattern: RegExp): number => {
    for (const part of parts) {
      const match = pattern.exec(part);
      if (match) return Number(match[1]);
    }
    return 0;
  };
  const build = parts.map((part) => /^build (.+?)(?: @ ([0-9a-f]{7,40}))?$/.exec(part)).find(Boolean) ?? null;
  const took = parts.find((part) => part.startsWith("took "));
  const minutes = took ? (took === "took under a minute" ? 0 : Number(/^took (\d+) min$/.exec(took)?.[1] ?? NaN)) : null;
  return {
    passed: Number(head[1]),
    total: Number(head[2]),
    failed: count(/^(\d+) failed$/),
    skipped: count(/^(\d+) couldn't (?:run|be tested)$/),
    left: count(/^(\d+) left out$/),
    stopped: parts.includes("stopped"),
    branch: build?.[1] ?? null,
    commit: build?.[2] ?? null,
    minutes: minutes === null || Number.isNaN(minutes) ? null : minutes,
    when: parts.find((part) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(part)) ?? null,
    terminal: parts.includes("from the terminal"),
  };
};

export type RunLogBlock = { string: string; children?: Array<{ string: string }> };

// The newest recorded run in which this case passed. A verdict carried from
// an earlier run doesn't count: that earlier run's own line has it.
export const caseHistory = (runs: RunLogBlock[], title: string): CaseHistory => {
  for (const run of runs) {
    for (const child of run.children ?? []) {
      const result = parseLogLine(child.string, title);
      if (result?.verdict === "pass" && !result.detail.endsWith("from the earlier run")) {
        const summary = parseRunSummary(run.string);
        return { passed: { when: summary?.when ?? "an earlier run", commit: summary?.commit ?? null } };
      }
    }
  }
  return { passed: null };
};
