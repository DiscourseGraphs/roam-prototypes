import type { Action } from "./action";
import { validatePublishSpec, type PublishSpec } from "./publish";

// A proof kit is everything one PR's proof needs, written out ahead: what must
// be running, the data to prepare (each piece with a check, so prepared data
// is skipped), the cases, and the captions for the video. It is JSON because
// a live rehearsal writes it back.

export type StepSource = "kit" | "model" | "you";

// A step either does one action or uses a recipe from proof/recipes.
export type Step = {
  id: string;
  why: string;
  do?: Action;
  use?: string;
  with?: Record<string, unknown>;
  source?: StepSource;
  approved?: boolean;
};

export type Verdict = "pass" | "fail" | "skip";

export type Expectation = { js?: string; text?: string };

export type CaseResult = {
  verdict: Verdict;
  at: string;
  session: string;
  note?: string;
};

export type TestCase = {
  id: string;
  title: string;
  // What this case proves, in plain words, e.g. which Done When it covers.
  proves?: string;
  // What its expect.js checks, in plain words, for the live panel.
  checks?: string;
  intent?: string;
  // The narration line for this case in a take. One to three plain sentences.
  caption?: string;
  // A short top-right flash at the start of the case in a take.
  toast?: string;
  steps: Step[];
  expect?: Expectation;
  notes?: string[];
  last?: CaseResult;
};

export type KitTarget = {
  // roam (the default) records Chromium on a Roam graph; obsidian attaches
  // over CDP to an Obsidian you started with remote debugging on the vault.
  app?: "roam" | "obsidian";
  cdp?: string;
  vault?: string;
  slot?: "1" | "2" | "3";
  url?: string;
  dist?: string;
  pr?: number;
  viewport?: { width: number; height: number };
  dpr?: number;
};

// "supabase", "embed-stub" and "env:NAME" are built in. A custom need runs a
// shell check and prints its fix when the check fails.
export type Need =
  | string
  | { id: string; why: string; check: string; fix: string };

export type FixturePhase = "before-load" | "in-session" | "outside";

export type RestProbe = { path: string; expect: "rows" | "none" };
export type RestWrite = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

export type Probe = { js: string } | { command: string } | { rest: RestProbe };

export type Apply =
  | { js: string }
  | { steps: Step[] }
  | { command: string }
  | { rest: RestWrite }
  | { sql: string }
  | { publish: PublishSpec };

export type Fixture = {
  id: string;
  why: string;
  // before-load: flags and node types, which the extension reads once at load.
  // in-session: pages and settings, after the extension loads.
  // outside: database rows and anything else done from the shell.
  phase: FixturePhase;
  // Without a check the fixture always runs (settings Roam resets each load).
  check?: Probe;
  apply: Apply;
  // How long to let Roam sync a before-load write before the session closes.
  settleMs?: number;
};

export type Kit = {
  name: string;
  title?: string;
  // The one sentence the kit proves, and the state its setup leaves, both in
  // plain words. The live panel leads with them.
  claim?: string;
  given?: string;
  baseline?: string;
  target?: KitTarget;
  needs?: Need[];
  prepare?: Fixture[];
  cases: TestCase[];
};

export type Baseline = {
  name: string;
  version: number;
  why?: string;
  prepare: Fixture[];
  smoke: TestCase[];
};

export const ACTION_KINDS = [
  "click",
  "type",
  "fill",
  "press",
  "hover",
  "scroll",
  "pause",
  "wait_for",
  "open",
  "js",
  "screenshot",
  "drag",
  "command_palette",
  "when",
] as const;

export const SCREENSHOT_NAME = /^[\w.-]{1,80}$/;
export const RECIPE_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export const BUILT_IN_NEED = /^(supabase|embed-stub|env:[A-Z][A-Z0-9_]*)$/;
export const BASELINE_REF = /^[a-z0-9-]+@\d+$/;

const STEP_SOURCES: StepSource[] = ["kit", "model", "you"];
const MOUSE_BUTTONS = ["left", "right", "middle"];
const PHASES: FixturePhase[] = ["before-load", "in-session", "outside"];
const REST_METHODS = ["POST", "PATCH", "DELETE"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): boolean =>
  isRecord(value) && isNumber(value.x) && isNumber(value.y);

const optional = (value: unknown, check: (v: unknown) => boolean): boolean =>
  value === undefined || check(value);

const isAccepted = (kind: string, arg: unknown): boolean => {
  switch (kind) {
    case "click":
      return (
        isText(arg) ||
        (isRecord(arg) &&
          isText(arg.selector) &&
          optional(arg.button, (v) => MOUSE_BUTTONS.includes(v as string)) &&
          optional(arg.count, isNumber) &&
          optional(arg.position, isPoint))
      );
    case "type":
      return (
        isRecord(arg) &&
        isText(arg.into) &&
        typeof arg.text === "string" &&
        optional(arg.delay_ms, isNumber)
      );
    case "fill":
      return isRecord(arg) && isText(arg.into) && typeof arg.text === "string";
    case "press":
      return (
        isText(arg) ||
        (isRecord(arg) && isText(arg.key) && optional(arg.selector, isText))
      );
    case "hover":
    case "wait_for":
    case "open":
    case "js":
      return isText(arg);
    case "scroll":
      return (
        isNumber(arg) ||
        (isRecord(arg) && optional(arg.y, isNumber) && optional(arg.to, isText))
      );
    case "pause":
      return isNumber(arg) && arg >= 0 && arg <= 60;
    case "screenshot":
      return typeof arg === "string" && SCREENSHOT_NAME.test(arg);
    case "drag":
      return (
        isRecord(arg) &&
        isText(arg.from) &&
        isText(arg.to) &&
        optional(arg.hover, isText) &&
        optional(arg.hoverAt, (v) => v === "center" || v === "end") &&
        optional(arg.toPosition, isPoint)
      );
    case "command_palette":
      return (
        isText(arg) ||
        (isRecord(arg) &&
          isText(arg.label) &&
          optional(arg.type_delay_ms, isNumber))
      );
    case "when":
      return (
        isRecord(arg) &&
        isText(arg.js) &&
        Array.isArray(arg.do) &&
        arg.do.length > 0 &&
        arg.do.every((inner, index) => {
          try {
            validateAction(inner, `when.do[${index}]`);
            return true;
          } catch {
            return false;
          }
        })
      );
    default:
      return false;
  }
};

const EXPECTED_SHAPE: Record<string, string> = {
  click: "a selector or { selector, button?, count?, position? }",
  type: "{ into, text, delay_ms? }",
  fill: "{ into, text }",
  press: "a key or { selector?, key }",
  hover: "a selector",
  wait_for: "a selector",
  open: "a URL or path",
  js: "a JS expression",
  scroll: "a number or { y?, to? }",
  pause: "seconds from 0 to 60",
  screenshot: "a file name with no slashes",
  drag: "{ from, to, hover?, hoverAt?, toPosition? }",
  command_palette: "a label or { label, type_delay_ms? }",
  when: "{ js, do: [actions] }, each action valid on its own",
};

// The js an action would run in the page, or null when it runs none. A when
// action runs its condition and any js among its actions, so js written by
// the brain or by you needs an Allow whichever form it takes.
export const actionJs = (action: Action): string | null => {
  if ("js" in action) return action.js;
  if ("when" in action) {
    const inner = action.when.do
      .map(actionJs)
      .filter((js): js is string => js !== null);
    return [action.when.js, ...inner].join("\n");
  }
  return null;
};

export const validateAction = (value: unknown, where: string): Action => {
  if (!isRecord(value)) {
    throw new Error(`${where}: an action must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw new Error(
      `${where}: an action has exactly one key, got ${keys.join(", ") || "none"}.`,
    );
  }
  const kind = keys[0];
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `${where}: unknown action "${kind}". Known: ${ACTION_KINDS.join(", ")}.`,
    );
  }
  if (!isAccepted(kind, value[kind])) {
    throw new Error(`${where}: ${kind} expects ${EXPECTED_SHAPE[kind]}.`);
  }
  return value as Action;
};

export const nextStepId = (steps: Step[]): string => {
  const used = new Set(steps.map((step) => step.id));
  let index = steps.length + 1;
  while (used.has(`s${index}`)) index += 1;
  return `s${index}`;
};

export const validateStep = (
  value: unknown,
  where: string,
  existing: Step[],
  sourceOverride?: StepSource,
): Step => {
  if (!isRecord(value)) {
    throw new Error(`${where}: a step must be an object.`);
  }
  const usesRecipe = value.use !== undefined;
  if (usesRecipe && value.do !== undefined) {
    throw new Error(`${where}: a step has do or use, not both.`);
  }
  if (usesRecipe) {
    if (typeof value.use !== "string" || !RECIPE_NAME.test(value.use)) {
      throw new Error(`${where}: use names a recipe, like "settings.stored-relations".`);
    }
    if (value.with !== undefined && !isRecord(value.with)) {
      throw new Error(`${where}: with must be an object of recipe parameters.`);
    }
  }
  const action = usesRecipe ? undefined : validateAction(value.do, `${where}.do`);
  if (!isText(value.why)) {
    throw new Error(`${where}: every step needs a one-line "why".`);
  }
  const source = sourceOverride ?? value.source ?? "kit";
  if (!STEP_SOURCES.includes(source as StepSource)) {
    throw new Error(`${where}: source must be kit, model or you.`);
  }
  const id =
    isText(value.id) && !existing.some((step) => step.id === value.id)
      ? value.id
      : nextStepId(existing);
  const step: Step = { id, why: value.why.trim(), source: source as StepSource };
  if (action) step.do = action;
  if (usesRecipe) {
    step.use = value.use as string;
    if (isRecord(value.with)) step.with = value.with;
  }
  if (value.approved === true && sourceOverride === undefined) {
    step.approved = true;
  }
  return step;
};

export const validateSteps = (
  value: unknown,
  where: string,
  existing: Step[] = [],
  sourceOverride?: StepSource,
): Step[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${where}: steps must be an array.`);
  }
  const steps: Step[] = [];
  value.forEach((raw, index) => {
    steps.push(
      validateStep(
        raw,
        `${where}[${index}]`,
        [...existing, ...steps],
        sourceOverride,
      ),
    );
  });
  return steps;
};

const validateExpectation = (
  value: unknown,
  where: string,
): Expectation | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${where}: expect must be an object with js and/or text.`);
  }
  const expectation: Expectation = {};
  if (value.js !== undefined) {
    if (!isText(value.js)) throw new Error(`${where}.js must be a string.`);
    expectation.js = value.js;
  }
  if (value.text !== undefined) {
    if (!isText(value.text)) throw new Error(`${where}.text must be a string.`);
    expectation.text = value.text;
  }
  return expectation.js || expectation.text ? expectation : undefined;
};

export const validateCase = (
  value: unknown,
  where: string,
  takenIds: Set<string>,
  fallbackId: string,
  sourceOverride?: StepSource,
): TestCase => {
  if (!isRecord(value)) {
    throw new Error(`${where}: a case must be an object.`);
  }
  const id = isText(value.id) ? value.id : fallbackId;
  if (takenIds.has(id)) {
    throw new Error(`${where}: duplicate case id "${id}".`);
  }
  if (!isText(value.title)) {
    throw new Error(`${where}: a case needs a "title".`);
  }
  const steps =
    value.steps === undefined
      ? []
      : validateSteps(value.steps, `${where}.steps`, [], sourceOverride);
  const expectsJs = isRecord(value.expect) && isText(value.expect.js);
  if (steps.length === 0 && !isText(value.intent) && !expectsJs) {
    throw new Error(
      `${where}: a case needs steps, an "intent" the brain can work from, or an expect.js check.`,
    );
  }
  const testCase: TestCase = { id, title: value.title.trim(), steps };
  if (isText(value.intent)) testCase.intent = value.intent.trim();
  if (isText(value.proves)) testCase.proves = value.proves.trim();
  if (isText(value.checks)) testCase.checks = value.checks.trim();
  if (isText(value.caption)) testCase.caption = value.caption.trim();
  if (isText(value.toast)) testCase.toast = value.toast.trim();
  const expectation = validateExpectation(value.expect, `${where}.expect`);
  if (expectation) testCase.expect = expectation;
  if (Array.isArray(value.notes)) {
    testCase.notes = value.notes.filter(isText);
  }
  if (isRecord(value.last) && typeof value.last.verdict === "string") {
    testCase.last = value.last as CaseResult;
  }
  return testCase;
};

const validateCases = (
  value: unknown,
  where: string,
  idPrefix: string,
): TestCase[] => {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array.`);
  const takenIds = new Set<string>();
  return value.map((raw, index) => {
    const testCase = validateCase(
      raw,
      `${where}[${index}]`,
      takenIds,
      `${idPrefix}${index + 1}`,
    );
    takenIds.add(testCase.id);
    return testCase;
  });
};

const validateTarget = (value: unknown): KitTarget | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("target must be an object.");
  const target: KitTarget = {};
  if (value.app !== undefined) {
    if (value.app !== "roam" && value.app !== "obsidian") {
      throw new Error("target.app must be roam or obsidian.");
    }
    target.app = value.app;
  }
  if (isText(value.cdp)) target.cdp = value.cdp;
  if (isText(value.vault)) target.vault = value.vault;
  if (value.slot !== undefined) {
    if (!["1", "2", "3"].includes(String(value.slot))) {
      throw new Error("target.slot must be 1, 2 or 3.");
    }
    target.slot = String(value.slot) as KitTarget["slot"];
  }
  if (isText(value.url)) target.url = value.url;
  if (isText(value.dist)) target.dist = value.dist;
  if (value.pr !== undefined) {
    if (!isNumber(value.pr) || value.pr <= 0) {
      throw new Error("target.pr must be a PR number.");
    }
    target.pr = value.pr;
  }
  if (value.viewport !== undefined) {
    const viewport = value.viewport;
    if (
      !isRecord(viewport) ||
      !isNumber(viewport.width) ||
      !isNumber(viewport.height)
    ) {
      throw new Error("target.viewport must be { width, height }.");
    }
    target.viewport = { width: viewport.width, height: viewport.height };
  }
  if (value.dpr !== undefined) {
    if (!isNumber(value.dpr) || value.dpr <= 0) {
      throw new Error("target.dpr must be a positive number.");
    }
    target.dpr = value.dpr;
  }
  return target;
};

const validateNeeds = (value: unknown): Need[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("needs must be an array.");
  return value.map((need, index) => {
    const where = `needs[${index}]`;
    if (typeof need === "string") {
      if (!BUILT_IN_NEED.test(need)) {
        throw new Error(
          `${where}: "${need}" isn't a built-in need. Use supabase, embed-stub, env:NAME, or { id, why, check, fix }.`,
        );
      }
      return need;
    }
    if (
      !isRecord(need) ||
      !isText(need.id) ||
      !isText(need.why) ||
      !isText(need.check) ||
      !isText(need.fix)
    ) {
      throw new Error(`${where}: a custom need is { id, why, check, fix }.`);
    }
    return { id: need.id, why: need.why, check: need.check, fix: need.fix };
  });
};

const validateProbe = (
  value: unknown,
  phase: FixturePhase,
  where: string,
): Probe => {
  if (!isRecord(value)) throw new Error(`${where}: check must be an object.`);
  if (phase === "outside") {
    if (isText(value.command)) return { command: value.command };
    if (isRecord(value.rest)) {
      const rest = value.rest;
      if (
        !isText(rest.path) ||
        (rest.expect !== "rows" && rest.expect !== "none")
      ) {
        throw new Error(
          `${where}: rest check is { path, expect: "rows" | "none" }.`,
        );
      }
      return { rest: { path: rest.path, expect: rest.expect } };
    }
    throw new Error(`${where}: an outside check is { command } or { rest }.`);
  }
  if (isText(value.js)) return { js: value.js };
  throw new Error(`${where}: a ${phase} check is { js }.`);
};

const validateApply = (
  value: unknown,
  phase: FixturePhase,
  where: string,
): Apply => {
  if (!isRecord(value)) throw new Error(`${where}: apply must be an object.`);
  if (phase === "outside") {
    if (isText(value.command)) return { command: value.command };
    if (isText(value.sql)) return { sql: value.sql };
    if (value.publish !== undefined) {
      return { publish: validatePublishSpec(value.publish, `${where}.publish`) };
    }
    if (isRecord(value.rest)) {
      const rest = value.rest;
      if (!isText(rest.path) || !REST_METHODS.includes(rest.method as string)) {
        throw new Error(`${where}: rest apply is { method, path, body? }.`);
      }
      const write: RestWrite = {
        method: rest.method as RestWrite["method"],
        path: rest.path,
      };
      if (rest.body !== undefined) write.body = rest.body;
      return { rest: write };
    }
    throw new Error(
      `${where}: an outside apply is { command }, { sql }, { rest } or { publish }.`,
    );
  }
  if (isText(value.js)) return { js: value.js };
  if (phase === "in-session" && value.steps !== undefined) {
    return { steps: validateSteps(value.steps, `${where}.steps`) };
  }
  throw new Error(
    phase === "in-session"
      ? `${where}: an in-session apply is { js } or { steps }.`
      : `${where}: a before-load apply is { js }.`,
  );
};

export const validateFixtures = (value: unknown, where: string): Fixture[] => {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array.`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const at = `${where}[${index}]`;
    if (!isRecord(raw)) throw new Error(`${at}: a fixture must be an object.`);
    if (!isText(raw.id)) throw new Error(`${at}: a fixture needs an "id".`);
    if (ids.has(raw.id))
      throw new Error(`${at}: duplicate fixture id "${raw.id}".`);
    ids.add(raw.id);
    if (!isText(raw.why)) throw new Error(`${at}: a fixture needs a "why".`);
    if (!PHASES.includes(raw.phase as FixturePhase)) {
      throw new Error(
        `${at}: phase must be before-load, in-session or outside.`,
      );
    }
    const phase = raw.phase as FixturePhase;
    const fixture: Fixture = {
      id: raw.id,
      why: raw.why.trim(),
      phase,
      apply: validateApply(raw.apply, phase, `${at}.apply`),
    };
    if (raw.check !== undefined) {
      fixture.check = validateProbe(raw.check, phase, `${at}.check`);
    }
    if (raw.settleMs !== undefined) {
      if (
        !isNumber(raw.settleMs) ||
        raw.settleMs < 0 ||
        raw.settleMs > 60_000
      ) {
        throw new Error(`${at}: settleMs must be between 0 and 60000.`);
      }
      fixture.settleMs = raw.settleMs;
    }
    return fixture;
  });
};

export const validateKit = (value: unknown): Kit => {
  if (!isRecord(value)) throw new Error("A kit must be a JSON object.");
  if (!isText(value.name)) throw new Error('A kit needs a "name".');
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    throw new Error('A kit needs at least one case in "cases".');
  }
  const kit: Kit = {
    name: value.name.trim(),
    cases: validateCases(value.cases, "cases", "c"),
  };
  if (isText(value.title)) kit.title = value.title.trim();
  if (isText(value.claim)) kit.claim = value.claim.trim();
  if (isText(value.given)) kit.given = value.given.trim();
  if (value.baseline !== undefined) {
    if (
      typeof value.baseline !== "string" ||
      !BASELINE_REF.test(value.baseline)
    ) {
      throw new Error('baseline must look like "dg-baseline@1".');
    }
    kit.baseline = value.baseline;
  }
  const target = validateTarget(value.target);
  if (target) kit.target = target;
  const needs = validateNeeds(value.needs);
  if (needs) kit.needs = needs;
  if (value.prepare !== undefined) {
    kit.prepare = validateFixtures(value.prepare, "prepare");
  }
  if (kit.target?.app === "obsidian") {
    if (!kit.target.vault) throw new Error("An Obsidian kit needs target.vault.");
    if (kit.baseline) throw new Error("Baselines are for Roam; an Obsidian kit has none.");
    if (kit.prepare?.some((fixture) => fixture.phase === "before-load")) {
      throw new Error("Obsidian is already running, so its kits have no before-load fixtures.");
    }
  }
  return kit;
};

export const validateBaseline = (value: unknown): Baseline => {
  if (!isRecord(value)) throw new Error("A baseline must be a JSON object.");
  if (!isText(value.name)) throw new Error('A baseline needs a "name".');
  if (!isNumber(value.version))
    throw new Error('A baseline needs a "version".');
  const baseline: Baseline = {
    name: value.name.trim(),
    version: value.version,
    prepare: validateFixtures(value.prepare ?? [], "prepare"),
    smoke: validateCases(value.smoke ?? [], "smoke", "smoke-"),
  };
  if (isText(value.why)) baseline.why = value.why.trim();
  return baseline;
};
