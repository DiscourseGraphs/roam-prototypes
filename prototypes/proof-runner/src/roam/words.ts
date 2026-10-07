import type { Action } from "../core/action";
import type { Step } from "../core/kit";
import type { CaseRecord, MachineState, PauseCause, PlanCase } from "../core/machine";

// What the caption bar says, worked out from the run's state in the tester's
// words: what kind of step runs now, why a step didn't work, when the run
// will need the person, how each verdict was reached, and the text a tester
// copies into the PR. No DOM here, so tests run it in Node.

export type StepKind = "doing" | "waiting" | "look" | "behind";

export const KIND_WORDS: Record<StepKind, string> = {
  doing: "Doing",
  waiting: "Waiting for",
  look: "Look at",
  behind: "Behind the scenes",
};

const kindOfAction = (action: Action | undefined): StepKind => {
  if (!action) return "doing";
  if ("pause" in action) return "look";
  if ("wait_for" in action) return "waiting";
  if ("js" in action || "screenshot" in action) return "behind";
  return "doing";
};

// A recipe always does something on screen; a plain step says by its action.
export const kindOfStep = (step: Pick<Step, "do" | "use">): StepKind => (step.use ? "doing" : kindOfAction(step.do));

// What a person does in a case, if anything: decide it by eye, or do it by hand.
export type PersonNeed = "judge" | "by-hand";

export const needOf = (item: Pick<PlanCase, "judge" | "hasCheck" | "intent" | "steps">): PersonNeed | null => {
  if (item.steps.length === 0 && item.intent) return "by-hand";
  if (item.judge && !item.hasCheck) return "judge";
  return null;
};

// The line under the case title: what the case must show, or what it asks of you.
export const purposeLine = (item: PlanCase | undefined, setup: boolean): { label: string; text: string } => {
  if (setup || !item) return { label: "", text: "Getting the graph ready. You don't need to watch this part." };
  const need = needOf(item);
  if (need === "by-hand") return { label: "You'll do this one by hand.", text: item.checks ? `Then it checks: ${item.checks}` : "" };
  if (need === "judge") return { label: "You'll judge:", text: item.judge ?? "" };
  if (item.checks) return { label: "Passes if", text: item.checks };
  if (item.hasCheck) return { label: "Passes if", text: "its check holds." };
  return { label: "", text: "Nothing is checked at the end: it passes if every step runs." };
};

// Why a step didn't work, in plain words, from the executor's error.
export type TroubleKind = "not-found" | "hidden" | "covered" | "disabled" | "moving" | "palette" | "kit-code" | "database" | "other";
export type Trouble = { kind: TroubleKind; plain: string; looksFor: string | null };

const TEXT_IN_SELECTOR = /(?::has-text|:text-is|:text)\(\s*(["'])(.*?)\1\s*\)|\btext=\s*(["']?)([^"'>]+)\3/;

// The words a selector looks for, when it names any: `button:has-text("Publish")` → Publish.
export const selectorWords = (selector: string): string | null => {
  const match = TEXT_IN_SELECTOR.exec(selector);
  const words = (match?.[2] ?? match?.[4] ?? "").trim();
  return words || null;
};

const seconds = (ms: string): string => {
  const value = Math.round(Number(ms) / 1000);
  return `${value} second${value === 1 ? "" : "s"}`;
};

const quoted = (words: string | null, otherwise: string): string => (words ? `“${words}”` : otherwise);

const firstLine = (text: string, limit = 220): string => {
  const line = text.split("\n")[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

export const trouble = (error: string): Trouble => {
  const text = error.trim();
  let match = /^Timeout (\d+)ms exceeded clicking ([\s\S]+?): (.+?) intercepts pointer events\.?$/.exec(text);
  if (match) {
    const words = selectorWords(match[2]);
    return {
      kind: "covered",
      plain: `Something on the screen covers ${quoted(words, "what this step clicks")}: ${match[3]}.`,
      looksFor: words,
    };
  }
  match = /^Timeout (\d+)ms exceeded clicking ([\s\S]+?): the element is disabled\.?$/.exec(text);
  if (match) {
    const words = selectorWords(match[2]);
    return { kind: "disabled", plain: `${words ? `“${words}”` : "What this step clicks"} is on the screen but turned off.`, looksFor: words };
  }
  match = /^Timeout (\d+)ms exceeded clicking ([\s\S]+?): the element is still moving\.?$/.exec(text);
  if (match) {
    const words = selectorWords(match[2]);
    return { kind: "moving", plain: `${words ? `“${words}”` : "What this step clicks"} kept moving, so the run couldn't click it.`, looksFor: words };
  }
  match = /^Timeout (\d+)ms exceeded waiting for a command palette entry matching "([^"]+)"/.exec(text);
  if (match) {
    return { kind: "palette", plain: `The command “${match[2]}” isn't in the command palette.`, looksFor: match[2] };
  }
  match = /^Timeout (\d+)ms exceeded waiting for ([\s\S]+?) to be visible \(it is attached but hidden\)\.?$/.exec(text);
  if (match) {
    const words = selectorWords(match[2]);
    return {
      kind: "hidden",
      plain: `The run found ${quoted(words, "what this step needs")}, but it stayed hidden for ${seconds(match[1])}.`,
      looksFor: words,
    };
  }
  match = /^Timeout (\d+)ms exceeded waiting for ([\s\S]+?)\.?$/.exec(text);
  if (match) {
    const words = selectorWords(match[2]);
    return {
      kind: "not-found",
      plain: `The run looked for ${quoted(words, "what this step needs")} for ${seconds(match[1])} and didn't find it.`,
      looksFor: words,
    };
  }
  if (/failed to fetch|networkerror|ECONNREFUSED|55321|PGRST|supabase/i.test(text)) {
    return { kind: "database", plain: "The proof database didn't answer.", looksFor: null };
  }
  if (/\b(ReferenceError|TypeError|SyntaxError|RangeError)\b|is not defined|is not a function|Cannot read propert/.test(text)) {
    return { kind: "kit-code", plain: `The kit's code hit an error: ${firstLine(text)}`, looksFor: null };
  }
  return { kind: "other", plain: firstLine(text), looksFor: null };
};

// What the bar suggests after the person answers "Can you see it?".
export const seeAnswer = (seen: boolean): string =>
  seen
    ? "Then the step is out of date, not the PR. Skip this case: the result lists it as couldn't run, with your note."
    : "Then the PR may have removed or broken it. Fail this case and say what you see.";

// Why the run paused, short enough to sit beside what runs next.
export const pauseWords = (cause: PauseCause | null): string => {
  if (cause === "page") return "You clicked the page; your click didn't reach Roam.";
  if (cause === "between-cases") return "Paused between cases. Look around, then Resume.";
  if (cause === "agent") return "Your agent paused the run.";
  return "You paused the run.";
};

// How a verdict was reached, as the result lists it.
export const howWords = (verdict: string | null, record: CaseRecord | null): string => {
  if (!verdict) return "didn't run";
  if (!record) return verdict === "pass" ? "passed" : verdict === "fail" ? "failed" : "couldn't run";
  switch (record.how) {
    case "checked":
      return "checked by code";
    case "judged":
      return record.byHand ? "done by hand, your call" : "your call";
    case "marked":
      return "failed by you";
    case "skipped":
      return "couldn't run";
    case "unchecked":
      return record.byHand ? "done by hand, nothing checked" : "ran, nothing checked";
  }
};

export const verdictWord = (verdict: string | null): string =>
  verdict === "pass" ? "Passed" : verdict === "fail" ? "Failed" : verdict === "skip" ? "Couldn't run" : "Didn't run";

export const duration = (ms: number): string => {
  if (ms < 45_000) return "under a minute";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `about ${minutes} min`;
};

export const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// When the run next needs the person, and about how long is left, from the
// steps still to run and how long a step takes here.
export type Forecast = { next: { index: number; need: PersonNeed; inMs: number } | null; leftMs: number };

export const forecast = (
  state: Pick<MachineState, "plan" | "caseIndex" | "stepIndex" | "stepCount">,
  msPerStep: number,
): Forecast => {
  const plan = state.plan;
  let leftMs = 0;
  let next: Forecast["next"] = null;
  const inCase = state.caseIndex >= 0 && state.caseIndex < plan.length;
  if (state.caseIndex < 0) leftMs += Math.max(0, state.stepCount - state.stepIndex) * msPerStep;
  if (inCase) {
    const item = plan[state.caseIndex];
    leftMs += Math.max(0, state.stepCount - state.stepIndex) * msPerStep;
    const need = needOf(item);
    if (need === "judge" && !item.verdict) next = { index: state.caseIndex, need, inMs: leftMs };
  }
  for (let index = Math.max(0, state.caseIndex + (inCase ? 1 : 0)); index < plan.length; index += 1) {
    const item = plan[index];
    const need = needOf(item);
    if (need && !next) next = { index, need, inMs: leftMs };
    leftMs += Math.max(1, item.steps.length) * msPerStep;
  }
  return { next, leftMs };
};

export const forecastWords = (value: Forecast, caseIndex: number): { you: string; left: string; soon: boolean } => {
  const left = `${duration(value.leftMs).replace(/^about /, "")} left`;
  if (!value.next) return { you: "Won't need you", left, soon: false };
  if (value.next.index === caseIndex || value.next.inMs < 20_000) return { you: "Your turn is next", left, soon: true };
  return { you: `Your turn in ${duration(value.next.inMs).replace(/^about /, "")}`, left, soon: true };
};

// The ticket's Done When bullets, from what each case says it proves:
// "Done When 2: …" or "Done When 5, 6 and 7: …". A bullet's text comes from
// the case that covers it alone, when one does.
export type DoneWhen = { number: number; text: string; caseIds: string[] };

const DONE_WHEN = /^\s*done when\s+(\d[\d\s,&]*(?:\s*and\s*\d+)?)\s*[:.\-–]?\s*([\s\S]*)$/i;

export const doneWhen = (plan: Array<Pick<PlanCase, "id" | "proves">>): { bullets: DoneWhen[]; other: string[] } => {
  const byNumber = new Map<number, { text: string; alone: boolean; caseIds: string[] }>();
  const other: string[] = [];
  for (const item of plan) {
    const match = item.proves ? DONE_WHEN.exec(item.proves) : null;
    if (!match) {
      other.push(item.id);
      continue;
    }
    const numbers = [...match[1].matchAll(/\d+/g)].map((found) => Number(found[0]));
    const text = match[2].trim();
    for (const number of numbers) {
      const entry = byNumber.get(number) ?? { text: "", alone: false, caseIds: [] };
      const alone = numbers.length === 1;
      if (text && (!entry.text || (alone && !entry.alone))) {
        entry.text = text;
        entry.alone = alone;
      }
      if (!entry.caseIds.includes(item.id)) entry.caseIds.push(item.id);
      byNumber.set(number, entry);
    }
  }
  const bullets = [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, entry]) => ({ number, text: entry.text, caseIds: entry.caseIds }));
  return { bullets, other };
};

// A bullet holds when every case under it passed.
export const bulletVerdict = (bullet: DoneWhen, results: Record<string, string>): "pass" | "fail" | "skip" | null => {
  const verdicts = bullet.caseIds.map((id) => results[id] ?? null);
  if (verdicts.some((value) => value === "fail")) return "fail";
  if (verdicts.some((value) => value === null)) return null;
  if (verdicts.some((value) => value === "skip")) return "skip";
  return "pass";
};

export type RunFacts = {
  title: string;
  pr: number | null;
  ticket: string | null;
  page: string | null;
  build: string | null;
  latest: boolean | null;
  when: string;
  how: string;
  steps: Record<string, string[]>;
};

const BOX: Record<string, string> = { pass: "[x]", fail: "[ ]", skip: "[ ]" };

// The comment a tester pastes on the PR.
export const resultMarkdown = (state: Pick<MachineState, "plan" | "results">, facts: RunFacts, notTested: number): string => {
  const plan = state.plan;
  const count = (verdict: string): number => plan.filter((item) => state.results[item.id] === verdict).length;
  const failed = count("fail");
  const skipped = count("skip");
  const headline = [`${count("pass")} of ${plan.length} passed`, failed ? `${failed} failed` : "", skipped ? `${skipped} couldn't run` : ""]
    .filter(Boolean)
    .join(", ");
  const lines = [`**Proof run: ${headline}**`];
  const where = [facts.pr ? `PR #${facts.pr}` : null, facts.build ? `build ${facts.build}${facts.latest ? " (the PR's latest)" : facts.latest === false ? " (behind the PR's head)" : ""}` : null]
    .filter(Boolean)
    .join(" ");
  lines.push([where, facts.when, facts.how].filter(Boolean).join(" · "));
  const { bullets, other } = doneWhen(plan);
  if (bullets.length) {
    lines.push("", `Done When${facts.ticket ? ` (${facts.ticket})` : ""}`);
    for (const bullet of bullets) {
      const verdict = bulletVerdict(bullet, state.results);
      const size = `${bullet.caseIds.length} case${bullet.caseIds.length === 1 ? "" : "s"}`;
      const tail = verdict === "fail" ? `${size}, failed` : verdict === "skip" ? `${size}, couldn't run` : verdict ? size : `${size}, not run`;
      lines.push(`- ${verdict ? BOX[verdict] : "[ ]"} ${bullet.number}. ${bullet.text || "(no text in the kit)"} (${tail})`);
    }
  }
  const failures = plan.filter((item) => state.results[item.id] === "fail");
  if (failures.length) {
    lines.push("", "Failed");
    for (const item of failures) {
      const index = plan.indexOf(item) + 1;
      lines.push(`- Case ${index}: ${item.title}.${item.note ? ` ${firstLine(item.note, 300)}` : ""}`);
    }
  }
  const skips = plan.filter((item) => state.results[item.id] === "skip");
  if (skips.length) {
    lines.push("", "Couldn't run");
    for (const item of skips) lines.push(`- Case ${plan.indexOf(item) + 1}: ${item.title}.${item.note ? ` ${firstLine(item.note, 300)}` : ""}`);
  }
  const others = plan.filter((item) => other.includes(item.id));
  if (bullets.length && others.length) {
    const passed = others.filter((item) => state.results[item.id] === "pass").length;
    lines.push("", `Other cases: ${passed} of ${others.length} passed.`);
  }
  if (notTested) lines.push(`Not tested: ${notTested}, with reasons on ${facts.page ?? "the proof page"}.`);
  return lines.join("\n");
};

// One failed case as a bug report: Problem, Expected, Observed, Steps, Evidence.
export const bugReport = (item: PlanCase, index: number, facts: RunFacts): string => {
  const steps = (facts.steps[item.id] ?? item.steps.map((step) => step.why)).map((why, at) => `${at + 1}. ${why}`);
  const how = item.record ? howWords("fail", item.record) : "failed";
  return [
    `Problem: ${item.title} doesn't hold.`,
    `Expected: ${item.checks ?? item.judge ?? "every step runs and the case passes"}`,
    `Observed: ${item.note ? firstLine(item.note, 500).replace(/[.\s]+$/, "") : "The case failed"} (${how}).`,
    `Steps (${facts.page ?? "the proof page"}, case ${index + 1}):`,
    ...(steps.length ? steps : ["(done by hand)"]),
    `Evidence: run of ${facts.when}${facts.pr ? ` on PR #${facts.pr}` : ""}${facts.build ? ` build ${facts.build}${facts.latest ? " (the PR's latest)" : ""}` : ""}, ${facts.how}.`,
  ].join("\n");
};
