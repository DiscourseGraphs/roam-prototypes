import type { Action } from "../core/action";
import type { Step } from "../core/kit";
import type { CaseRecord, MachineState, PauseCause, PlanCase } from "../core/machine";

// What the caption bar says, worked out from the run's state in the tester's
// words: what kind of step runs now, why a step didn't work, when the run
// will need the person, how each verdict was reached, and the text a tester
// copies into the PR. No DOM here, so tests run it in Node.

export type StepKind = "doing" | "waiting" | "look" | "behind";

// Kit lines keep page names in backticks, so the kit page in Roam doesn't
// turn a name like [[EVD]] - … into links; the bar and the card show them as
// plain text. What a tester copies keeps them: they read as code on GitHub.
export const plainText = (text: string): string => text.replace(/`([^`\n]*)`/g, "$1");

// When the run pauses for the person, from most often to least. Each one also
// pauses for everything after it in this list, and every one waits for a call
// by eye, a case done by hand and code to allow.
export type PauseSetting = "step" | "case" | "failure" | "needed";

export const PAUSES: Array<{ value: PauseSetting; label: string; hint: string; line: string }> = [
  { value: "step", label: "Every step", hint: "Next step runs one.", line: "paused every step" },
  { value: "case", label: "After each case", hint: "Look around before the next case.", line: "paused after each case" },
  { value: "failure", label: "On failure", hint: "The broken screen stays until you answer.", line: "paused on failure" },
  { value: "needed", label: "Only when needed", hint: "Failures are recorded and the run goes on. Your calls still wait.", line: "paused only when needed" },
];

export const PACES = [0.5, 1, 2, 4];

// How the run shows where each step acts: a ring around the target, or a
// drawn cursor that moves there and clicks.
export type PointerSetting = "ring" | "cursor";

export const POINTERS: Array<{ value: PointerSetting; label: string }> = [
  { value: "ring", label: "Ring" },
  { value: "cursor", label: "Cursor" },
];

export const isPointerSetting = (value: unknown): value is PointerSetting => value === "ring" || value === "cursor";

export const isPauseSetting = (value: unknown): value is PauseSetting => PAUSES.some((item) => item.value === value);

export const pauseLabel = (value: PauseSetting): string => PAUSES.find((item) => item.value === value)?.label ?? "On failure";

export const paceLabel = (pace: number): string => (pace === 0.5 ? "½×" : pace === 0.25 ? "¼×" : `${pace}×`);

// How a run was played, for its line on the page and the copied result.
export const runWords = (pause: PauseSetting, pace: number): string =>
  `${PAUSES.find((item) => item.value === pause)?.line ?? "paused on failure"} · ${paceLabel(pace)}`;

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
  if (need === "by-hand") {
    const text = item.checks ? `Then it checks: ${plainText(item.checks)}` : item.judge ? `Passes if ${plainText(item.judge)}` : "";
    return { label: "You'll do this one by hand.", text };
  }
  if (need === "judge") return { label: "You'll judge:", text: plainText(item.judge ?? "") };
  if (item.checks) return { label: "Passes if", text: plainText(item.checks) };
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
  match = /Timed out after (\d+) ms waiting for (.+?)\.?$/m.exec(text);
  if (match) {
    const what = match[2].trim();
    return {
      kind: "not-found",
      plain: `The run looked for ${what} for ${seconds(match[1])} and didn't find it.`,
      looksFor: what,
    };
  }
  if (/failed to fetch|networkerror|ECONNREFUSED|55321|PGRST|supabase/i.test(text)) {
    return { kind: "database", plain: "The proof database didn't answer.", looksFor: null };
  }
  if (/\b(ReferenceError|TypeError|SyntaxError|RangeError)\b|is not defined|is not a function|Cannot read propert|Unexpected (?:token|identifier|end of input|string|number)|Invalid or unexpected token|missing \) after/.test(text)) {
    return { kind: "kit-code", plain: `The kit's code hit an error: ${firstLine(text)}`, looksFor: null };
  }
  return { kind: "other", plain: firstLine(text), looksFor: null };
};

// Whether this case has passed before, from the page's run lines. A case
// that never passed points at the kit; one that passed and fails now means
// something changed since: the PR, DG or the graph.
export type CaseHistory = { passed: { when: string; commit: string | null } | null };

export const historyLine = (history: CaseHistory | null | undefined, what: "step" | "check"): string => {
  const passed = history?.passed;
  if (!passed) return `This case hasn't passed in any recorded run, so suspect the kit's ${what} first.`;
  return `This case passed in the run of ${passed.when}${passed.commit ? `, on build ${passed.commit}` : ""}. Something changed since then.`;
};

// A hold whose line only names a place ("Pause on the result") says what to
// look at instead: the case's Passes if.
const BARE_HOLD = /^(?:(?:pause|hold)(?:\s+(?:on|at|over)\s+(?:the|a|this)\s+[^:,.]{1,25})?|look|wait)\.?$/i;

export const holdLine = (why: string, item: Pick<PlanCase, "judge" | "hasCheck" | "checks"> | undefined): string => {
  if (!item) return plainText(why);
  if (item.judge && item.hasCheck) return `Look for: ${plainText(item.judge)}`;
  if (item.checks && BARE_HOLD.test(why.trim())) return `Look at: ${plainText(item.checks)}`;
  return plainText(why);
};

// Why the run paused, short enough to sit beside what runs next.
export const pauseWords = (cause: PauseCause | null): string => {
  if (cause === "page") return "You clicked the page; your click didn't reach Roam.";
  if (cause === "flag") return "You flagged this case, so the run is paused. Resume when you're ready.";
  if (cause === "between-cases") return "Paused between cases. Look around, then Resume.";
  if (cause === "agent") return "Your agent paused the run.";
  return "You paused the run.";
};

// How a verdict was reached, as the result lists it.
export const howWords = (verdict: string | null, record: CaseRecord | null): string => {
  if (!verdict) return "didn't run";
  if (!record) return verdict === "pass" ? "passed" : verdict === "fail" ? "failed" : "couldn't be tested";
  switch (record.how) {
    case "checked":
      return "checked by code";
    case "judged":
      return record.byHand ? "done by hand, your call" : "your call";
    case "marked":
      return verdict === "pass" ? "passed by you" : "failed by you";
    case "skipped":
      return "couldn't be tested";
    case "unchecked":
      return record.byHand ? "done by hand, nothing checked" : "ran, nothing checked";
  }
};

// How a case ended, or that the person left it out of the run.
export const endWords = (item: Pick<PlanCase, "leftOut" | "record">, verdict: string | null): string =>
  item.leftOut && !verdict ? "left out by you" : howWords(verdict, item.record ?? null);

export const verdictWord = (verdict: string | null): string =>
  verdict === "pass" ? "Passed" : verdict === "fail" ? "Failed" : verdict === "skip" ? "Couldn't be tested" : "Didn't run";

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
    if (item.leftOut) continue;
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

// A pass the person gave or helped along: they passed it after a failure,
// did a step themselves, or fixed one during the run.
export const passedWithHelp = (record: CaseRecord | null | undefined): boolean =>
  Boolean(record && record.verdict === "pass" && (record.how === "marked" || (record.handSteps?.length ?? 0) > 0 || record.fixedSteps.length > 0));

// The cases whose kit needs fixing: the person passed one after a step or a
// check failed, couldn't test one, or did a step themselves. A failure the
// person agreed with is the PR's, not the kit's, so it isn't here.
export type KitFix = { caseId: string; index: number; title: string; lines: string[] };

const FORCED_STEP = /^Step (\d+), "([\s\S]*?)", failed: ([\s\S]*)$/;
const SKIPPED_STEP = /^Skipped after step (\d+), "([\s\S]*?)", failed: ([\s\S]*)$/;

const sentence = (text: string): string => {
  const line = firstLine(text, 300);
  return /[.!?…]$/.test(line) ? line : `${line}.`;
};

// What went wrong, in plain words. A check's own timeout says the check
// looked; another message is the check's own words.
const stepWords = (error: string): string => sentence(trouble(error).plain);
const checkWords = (message: string): string => {
  const found = trouble(message);
  return found.kind === "not-found" ? sentence(found.plain.replace(/^The run looked for/, "The check looked for")) : `The check failed: ${sentence(message)}`;
};

export const kitFixes = (plan: PlanCase[], results: Record<string, string>, who = "You"): KitFix[] => {
  const fixes: KitFix[] = [];
  // The copied report, for whoever fixes the kit, also keeps each error as it was.
  const raw = who !== "You";
  plan.forEach((item, index) => {
    const verdict = results[item.id] ?? item.verdict;
    const record = item.record;
    if (!verdict || !record || verdict === "fail") return;
    const lines: string[] = [];
    const exact = (error: string, plain: string): void => {
      if (raw && !plain.includes(sentence(error))) lines.push(`Error: ${firstLine(error, 300)}`);
    };
    for (const step of record.handSteps ?? []) {
      const plain = stepWords(step.error);
      lines.push(`Step ${step.index + 1}, "${step.why}", didn't work: ${plain} ${who} did it.`);
      exact(step.error, plain);
    }
    for (const why of record.fixedSteps) lines.push(`${who} fixed the step "${why}" during the run.`);
    if (record.how === "marked" && verdict === "pass") {
      const step = record.note ? FORCED_STEP.exec(record.note) : null;
      const plain = step ? stepWords(step[3]) : record.note ? checkWords(record.note) : "The check failed.";
      lines.push(step ? `Step ${step[1]}, "${step[2]}", didn't work: ${plain} ${who} passed the case.` : `${plain} ${who} passed the case.`);
      if (step) exact(step[3], plain);
      else if (record.note) exact(record.note, plain);
    }
    if (verdict === "skip") {
      const step = record.note ? SKIPPED_STEP.exec(record.note) : null;
      const check = record.note?.startsWith("The check failed: ") ? record.note.slice("The check failed: ".length) : null;
      const plain = step ? stepWords(step[3]) : check ? checkWords(check) : record.note ? sentence(record.note) : "";
      lines.push(step ? `Step ${step[1]}, "${step[2]}", didn't work: ${plain} It couldn't be tested.` : `${plain ? `${plain} ` : ""}It couldn't be tested.`);
      if (step) exact(step[3], plain);
      else if (check) exact(check, plain);
    }
    if (!lines.length) return;
    if (record.touched) lines.push(`${who} used the page before Try again.`);
    if (record.yourNote) lines.push(`${who === "You" ? "You" : who} said: "${firstLine(record.yourNote, 300)}"`);
    if (verdict === "pass" && record.how === "checked") lines.push("Then the check passed.");
    fixes.push({ caseId: item.id, index, title: item.title, lines });
  });
  return fixes;
};

// What a tester copies for whoever fixes the kit.
export const kitReport = (state: Pick<MachineState, "plan" | "results">, facts: RunFacts): string => {
  const fixes = kitFixes(state.plan, state.results, "The tester");
  const where = [`Run of ${facts.when}`, facts.pr ? `PR #${facts.pr}` : null, facts.build ? `build ${facts.build}` : null, facts.how].filter(Boolean).join(" · ");
  const lines = [`${facts.page ?? "This kit"} needs ${fixes.length} fix${fixes.length === 1 ? "" : "es"}`, where];
  for (const fix of fixes) {
    lines.push("", `Case ${fix.index + 1}. ${fix.title}`);
    for (const line of fix.lines) lines.push(`  ${line}`);
  }
  return lines.join("\n");
};

// The comment a tester pastes on the PR.
export const resultMarkdown = (state: Pick<MachineState, "plan" | "results">, facts: RunFacts, notTested: number): string => {
  const plan = state.plan;
  const count = (verdict: string): number => plan.filter((item) => state.results[item.id] === verdict).length;
  const failed = count("fail");
  const skipped = count("skip");
  const leftOut = plan.filter((item) => item.leftOut && !state.results[item.id]);
  const headline = [
    `${count("pass")} of ${plan.length} passed`,
    failed ? `${failed} failed` : "none failed",
    skipped ? `${skipped} couldn't be tested` : "",
    leftOut.length ? `${leftOut.length} left out` : "",
  ]
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
      const helped = plan.filter((item) => bullet.caseIds.includes(item.id) && state.results[item.id] === "pass" && passedWithHelp(item.record)).length;
      const left = leftOut.filter((item) => bullet.caseIds.includes(item.id)).length;
      const tail =
        verdict === "fail"
          ? `${size}, failed`
          : verdict === "skip"
            ? `${size}, couldn't be tested`
            : verdict
              ? `${size}${helped ? `, ${helped} passed by the tester` : ""}`
              : left
                ? `${size}, ${left} left out`
                : `${size}, not run`;
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
    lines.push("", "Couldn't be tested");
    for (const item of skips) lines.push(`- Case ${plan.indexOf(item) + 1}: ${item.title}.${item.note ? ` ${firstLine(item.note, 300)}` : ""}`);
  }
  if (leftOut.length) {
    lines.push("", "Left out by the tester");
    for (const item of leftOut) lines.push(`- Case ${plan.indexOf(item) + 1}: ${item.title}.`);
  }
  const fixes = kitFixes(plan, state.results).length;
  if (fixes) lines.push("", `The kit needs ${fixes} fix${fixes === 1 ? "" : "es"}, listed on ${facts.page ?? "the proof page"} under runs.`);
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
