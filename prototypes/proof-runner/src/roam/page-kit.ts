import type { Action } from "../core/action";
import {
  ACTION_KINDS,
  nextStepId,
  validateKit,
  type Fixture,
  type Kit,
  type KitTarget,
  type Need,
  type Step,
  type SurfaceArea,
  type TestCase,
} from "../core/kit";

// A kit written as Roam blocks, so the page that holds it reads like a manual
// test script and runs as one. The root block starts with {{proof}}; its
// children are the kit:
//
//   {{proof}} Warn when sharing with Stored Relations off
//     kit:: eng-2348
//     build:: eng-2348-stored-relations-warning     the branch whose build to load
//     pr:: 1506
//     claim:: ...   given:: ...   baseline:: dg-baseline@1   needs:: supabase
//     prepare                                       one child per fixture: its why,
//       the extension has a database session          with the fixture as a json
//         ```json {"id": ..., "phase": ..., ...}```   code block under it
//     case:: Discover shared nodes warns
//       id:: import-warns
//       open import the way a user would            a step: its why, with the
//         use:: discover.open                        action under it (collapsed)
//       expect:: the warning shows                   what a person checks
//       expect js:: `proof.waitFor(...)`             what the runner checks
//       area:: s-node-search                         the surface area it checks
//       decision:: rejected                          proposed, approved or rejected
//       reason:: covered by the import case          (with decided by:: and decided at::)
//     surface                                       areas next to the change
//       Node search dialog                            one child per area: its name,
//         id:: s-node-search                          with id::, why:: and files::
//         why:: it reads the same node index
//         files:: `src/a.ts`, `src/b.ts`
//
// An action is `use:: recipe` (with `with:: {json}`), `kind:: value` for any
// action kind, or a code block: ```javascript for js, ```json for any action.
// Values may sit in `inline code` so Roam leaves brackets and underscores
// alone. Blocks the parser doesn't know are left out of the kit, so a page can
// carry notes; a `runs` block holds the run log.

export type BlockNode = {
  uid?: string;
  string: string;
  open?: boolean;
  children?: BlockNode[];
};

export type PageKit = {
  kit: Kit;
  // The branch whose build the loader fetches, and the PR it belongs to.
  build: string | null;
  pr: number | null;
  rootUid: string | null;
  // Block uids by case id and by "caseId/stepId", so the runner can mark the
  // block a case or step came from.
  blocks: { cases: Record<string, string>; steps: Record<string, string> };
};

export const PROOF_ROOT = /^\{\{(?:\[\[)?proof(?:\]\])?\}\}/i;

export const isProofRoot = (text: string): boolean =>
  PROOF_ROOT.test(text.trim());

const KIT_KEYS = [
  "kit",
  "title",
  "ticket",
  "build",
  "pr",
  "claim",
  "given",
  "baseline",
  "needs",
] as const;
const CASE_KEYS = [
  "id",
  "proves",
  "checks",
  "intent",
  "caption",
  "toast",
  "note",
  "expect",
  "expect js",
  "area",
  "decision",
  "decided by",
  "decided at",
  "reason",
] as const;
// Containers: blocks whose children the parser reads, or skips on purpose.
const KIT_SECTIONS = ["prepare", "target", "needs", "surface", "runs"];
const ACTION_ALIASES: Record<string, string> = {
  palette: "command_palette",
  "command palette": "command_palette",
  "wait for": "wait_for",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// "key:: value" → { key, value }, with the key lower-cased.
export const attribute = (
  text: string,
): { key: string; value: string } | null => {
  const match = /^([^:`\n]{1,40})::(.*)$/s.exec(text.trim());
  if (!match) return null;
  return { key: match[1].trim().toLowerCase(), value: match[2].trim() };
};

// `{3} rather than three literal backticks, which would end the roam/js
// code block the runner itself is installed in.
const CODE_BLOCK = /^`{3}([\w-]*)[ \t]*\n?([\s\S]*?)\n?`{3}\s*$/;

export const codeBlock = (
  text: string,
): { lang: string; code: string } | null => {
  const match = CODE_BLOCK.exec(text.trim());
  return match ? { lang: match[1].toLowerCase(), code: match[2] } : null;
};

// `value` → value. Roam doesn't parse links or formatting inside inline code.
export const unquote = (value: string): string => {
  const match = /^`([^`]*)`$/.exec(value.trim());
  return match ? match[1] : value.trim();
};

const parseJson = (raw: string, where: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${where}: not valid JSON (${String(error)}).`);
  }
};

const childrenOf = (node: BlockNode): BlockNode[] => node.children ?? [];

const codeChild = (
  node: BlockNode,
): { lang: string; code: string } | null => {
  for (const child of childrenOf(node)) {
    const code = codeBlock(child.string);
    if (code) return code;
  }
  return null;
};

const actionFromAttribute = (
  key: string,
  raw: string,
  where: string,
): Action | null => {
  const kind = ACTION_ALIASES[key] ?? key.replace(/ /g, "_");
  if (!(ACTION_KINDS as readonly string[]).includes(kind)) return null;
  const value = unquote(raw);
  if (kind === "pause" || (kind === "scroll" && /^-?\d/.test(value))) {
    return { [kind]: Number(value) } as Action;
  }
  if (value.startsWith("{")) {
    return { [kind]: parseJson(value, where) } as Action;
  }
  return { [kind]: value } as Action;
};

// A step block's why and the action under it, as a raw step for validateKit.
const readStep = (node: BlockNode, where: string): Record<string, unknown> => {
  const step: Record<string, unknown> = { why: node.string.trim() };
  for (const child of childrenOf(node)) {
    const code = codeBlock(child.string);
    if (code) {
      if (code.lang === "javascript" || code.lang === "js") {
        step.do = { js: code.code };
      } else {
        const value = parseJson(code.code, `${where} code block`);
        if (isRecord(value) && (value.do !== undefined || value.use !== undefined)) {
          Object.assign(step, value);
        } else {
          step.do = value;
        }
      }
      continue;
    }
    const attr = attribute(child.string);
    if (!attr) continue;
    if (attr.key === "id") step.id = unquote(attr.value);
    else if (attr.key === "use") step.use = unquote(attr.value);
    else if (attr.key === "with") {
      step.with = parseJson(unquote(attr.value), `${where} with`);
    } else {
      const action = actionFromAttribute(attr.key, attr.value, where);
      if (!action) {
        throw new Error(
          `${where}: "${attr.key}::" is not an action. Use use::, a kind (${ACTION_KINDS.join(", ")}), or a code block.`,
        );
      }
      if (Object.values(action)[0] === "" && codeChild(child)) {
        const code = codeChild(child) as { lang: string; code: string };
        step.do = { [Object.keys(action)[0]]: code.code };
      } else {
        step.do = action;
      }
    }
  }
  return step;
};

// One step block read on its own, as a raw step for the machine, e.g. a step
// fixed on the page during a run. Its id stays the machine's to give.
export const stepFromBlock = (node: BlockNode): Record<string, unknown> => {
  const { id: _id, ...step } = readStep(node, `step "${node.string.trim()}"`);
  return step;
};

// What a block and everything under it say, to tell whether it was edited.
export const blockText = (node: BlockNode): string =>
  JSON.stringify([node.string, childrenOf(node).map(blockText)]);

// Where a run's cases and steps sit on the page, taken when it starts, and
// what each step block said then, so Retry can tell a step fixed since. Steps
// are by position: the run only swaps a failed step for its fix, one for one.
export type RunBlocks = {
  cases: Record<string, string>;
  steps: Record<string, Array<string | null>>;
  text: Record<string, string>;
};

export const runBlocksFor = (page: PageKit, tree: BlockNode, kit: Kit): RunBlocks => {
  const nodes = new Map<string, BlockNode>();
  const index = (node: BlockNode): void => {
    if (node.uid) nodes.set(node.uid, node);
    for (const child of node.children ?? []) index(child);
  };
  index(tree);
  const blocks: RunBlocks = { cases: {}, steps: {}, text: {} };
  for (const testCase of kit.cases) {
    const caseUid = page.blocks.cases[testCase.id];
    if (caseUid) blocks.cases[testCase.id] = caseUid;
    blocks.steps[testCase.id] = testCase.steps.map((step) => {
      const uid = page.blocks.steps[`${testCase.id}/${step.id}`] ?? null;
      const node = uid ? nodes.get(uid) : undefined;
      if (uid && node) blocks.text[uid] = blockText(node);
      return uid;
    });
  }
  return blocks;
};

const readCase = (
  node: BlockNode,
  title: string,
  where: string,
): { raw: Record<string, unknown>; stepUids: (string | undefined)[] } => {
  const raw: Record<string, unknown> = { title };
  const steps: Record<string, unknown>[] = [];
  const stepUids: (string | undefined)[] = [];
  const notes: string[] = [];
  const expect: Record<string, string> = {};
  const decision: Record<string, string> = {};
  childrenOf(node).forEach((child, index) => {
    const attr = attribute(child.string);
    if (attr && (CASE_KEYS as readonly string[]).includes(attr.key)) {
      if (attr.key === "decision") {
        decision.status = unquote(attr.value).toLowerCase();
      } else if (attr.key === "decided by") {
        decision.by = attr.value;
      } else if (attr.key === "decided at") {
        decision.at = unquote(attr.value);
      } else if (attr.key === "reason") {
        decision.reason = attr.value;
      } else if (attr.key === "area") {
        raw.surface = unquote(attr.value);
      } else if (attr.key === "expect js") {
        const code = codeChild(child);
        expect.js = attr.value ? unquote(attr.value) : (code?.code ?? "");
      } else if (attr.key === "expect") {
        expect.text = attr.value;
      } else if (attr.key === "note") {
        notes.push(attr.value);
      } else if (attr.key === "id") {
        raw.id = unquote(attr.value);
      } else {
        raw[attr.key] = attr.value;
      }
      return;
    }
    // A typo like expects:: would leave the case with no check, and a case
    // with no check passes, so an attribute the parser doesn't know is an error.
    if (attr) {
      throw new Error(
        `${where}: "${attr.key}::" isn't a case field. Known: ${CASE_KEYS.join(", ")}.`,
      );
    }
    if (codeBlock(child.string) || !child.string.trim()) return;
    steps.push(readStep(child, `${where} step ${index + 1}`));
    stepUids.push(child.uid);
  });
  if (steps.length) raw.steps = steps;
  if (expect.js || expect.text) raw.expect = expect;
  if (notes.length) raw.notes = notes;
  if (Object.keys(decision).length) raw.decision = decision;
  return { raw, stepUids };
};

const readFixtures = (node: BlockNode): Record<string, unknown>[] =>
  childrenOf(node).flatMap((child, index) => {
    const where = `prepare ${index + 1}`;
    const own = codeBlock(child.string);
    const code = own ?? codeChild(child);
    if (!code) return [];
    const value = parseJson(code.code, where);
    if (!isRecord(value)) throw new Error(`${where}: a fixture is a JSON object.`);
    if (!own && value.why === undefined && child.string.trim()) {
      return [{ ...value, why: child.string.trim() }];
    }
    return [value];
  });

// Each child is an area: its name, with id::, why:: and files:: under it.
const readSurface = (node: BlockNode): Record<string, unknown>[] =>
  childrenOf(node).flatMap((child) => {
    const name = child.string.trim();
    if (!name) return [];
    const area: Record<string, unknown> = { area: name };
    for (const grandchild of childrenOf(child)) {
      const attr = attribute(grandchild.string);
      if (!attr) continue;
      if (attr.key === "id") area.id = unquote(attr.value);
      else if (attr.key === "why") area.why = attr.value;
      else if (attr.key === "files") {
        area.files = attr.value
          .split(",")
          .map((file) => unquote(file))
          .filter(Boolean);
      }
    }
    return [area];
  });

const readNeeds = (value: string, node: BlockNode): Need[] => {
  const listed = value
    ? value
        .split(",")
        .map((item) => unquote(item))
        .filter(Boolean)
    : [];
  const custom = childrenOf(node).flatMap((child) => {
    const code = codeBlock(child.string);
    return code ? [parseJson(code.code, "needs") as Need] : [];
  });
  return [...listed, ...custom];
};

// What the loader needs before the extension starts, read without
// validating the whole kit, so a half-written case doesn't stop the build
// from loading.
export const rootConfig = (
  root: BlockNode,
): { build: string | null; pr: number | null; kit: string | null } => {
  const config = { build: null as string | null, pr: null as number | null, kit: null as string | null };
  for (const child of childrenOf(root)) {
    const attr = attribute(child.string);
    if (!attr) continue;
    if (attr.key === "build") config.build = unquote(attr.value) || null;
    else if (attr.key === "kit") config.kit = unquote(attr.value) || null;
    else if (attr.key === "pr") {
      const number = Number(unquote(attr.value).replace(/^#/, ""));
      if (Number.isInteger(number) && number > 0) config.pr = number;
    }
  }
  return config;
};

// The kit a {{proof}} block holds. Throws with the block it can't read, or
// with validateKit's message, which names the case and step.
export const pageKit = (root: BlockNode): PageKit => {
  if (!isProofRoot(root.string)) {
    throw new Error("A proof page's root block starts with {{proof}}.");
  }
  const raw: Record<string, unknown> = {};
  const cases: Record<string, unknown>[] = [];
  const caseUids: (string | undefined)[] = [];
  const stepUids: (string | undefined)[][] = [];
  let build: string | null = null;
  let pr: number | null = null;
  let target: KitTarget | undefined;
  const heading = root.string.trim().replace(PROOF_ROOT, "").trim();

  for (const child of childrenOf(root)) {
    const attr = attribute(child.string);
    const section = child.string.trim().replace(/::$/, "").toLowerCase();
    if (attr?.key === "case") {
      const at = `case "${attr.value}"`;
      const read = readCase(child, attr.value, at);
      cases.push(read.raw);
      caseUids.push(child.uid);
      stepUids.push(read.stepUids);
      continue;
    }
    if (attr && (KIT_KEYS as readonly string[]).includes(attr.key)) {
      if (attr.key === "kit") raw.name = unquote(attr.value);
      else if (attr.key === "build") build = unquote(attr.value) || null;
      else if (attr.key === "pr") {
        const number = Number(unquote(attr.value).replace(/^#/, ""));
        if (!Number.isInteger(number) || number <= 0) {
          throw new Error(`pr:: "${attr.value}" is not a PR number.`);
        }
        pr = number;
      } else if (attr.key === "needs") raw.needs = readNeeds(attr.value, child);
      else raw[attr.key] = attr.value;
      continue;
    }
    if (KIT_SECTIONS.includes(section) || (attr && KIT_SECTIONS.includes(attr.key))) {
      const key = attr ? attr.key : section;
      if (key === "prepare") raw.prepare = readFixtures(child);
      else if (key === "surface") raw.surface = readSurface(child);
      else if (key === "needs") raw.needs = readNeeds("", child);
      else if (key === "target") {
        const code = codeChild(child) ?? (attr?.value ? codeBlock(attr.value) : null);
        if (code) target = parseJson(code.code, "target") as KitTarget;
      }
      continue;
    }
    if (attr) {
      throw new Error(
        `"${attr.key}::" isn't a kit field. Known: ${[...KIT_KEYS, "case", ...KIT_SECTIONS].join(", ")}.`,
      );
    }
  }
  if (raw.name === undefined && heading) raw.name = heading;
  if (target || pr) raw.target = { ...(target ?? {}), ...(pr ? { pr } : {}) };
  raw.cases = cases;

  const kit = validateKit(raw);
  const blocks: PageKit["blocks"] = { cases: {}, steps: {} };
  kit.cases.forEach((testCase, caseIndex) => {
    const caseUid = caseUids[caseIndex];
    if (caseUid) blocks.cases[testCase.id] = caseUid;
    testCase.steps.forEach((step, stepIndex) => {
      const stepUid = stepUids[caseIndex]?.[stepIndex];
      if (stepUid) blocks.steps[`${testCase.id}/${step.id}`] = stepUid;
    });
  });
  return {
    kit,
    build,
    pr: kit.target?.pr ?? pr,
    rootUid: root.uid ?? null,
    blocks,
  };
};

// Writing a kit out as blocks.

const INLINE_LIMIT = 240;

const fitsInline = (value: string): boolean =>
  !value.includes("`") && !value.includes("\n") && value.length <= INLINE_LIMIT;

const inline = (value: string): string => `\`${value}\``;

const block = (string: string, children?: BlockNode[], open?: boolean): BlockNode => ({
  string,
  ...(children && children.length ? { children } : {}),
  ...(open === false ? { open: false } : {}),
});

const jsonBlock = (value: unknown): BlockNode =>
  block(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);

const jsBlock = (code: string): BlockNode => block(`\`\`\`javascript\n${code}\n\`\`\``);

const actionBlocks = (action: Action): BlockNode[] => {
  const kind = Object.keys(action)[0];
  const value = (action as Record<string, unknown>)[kind];
  if (typeof value === "number") return [block(`${kind}:: ${value}`)];
  if (typeof value === "string") {
    if (fitsInline(value)) return [block(`${kind}:: ${inline(value)}`)];
    if (kind === "js") return [jsBlock(value)];
    return [jsonBlock(action)];
  }
  const json = JSON.stringify(value);
  if (fitsInline(json)) return [block(`${kind}:: ${inline(json)}`)];
  return [jsonBlock(action)];
};

// A step as a block: its why, with its action folded under it.
export const stepBlockOf = (step: Pick<Step, "why" | "do" | "use" | "with">): BlockNode =>
  block(step.why, stepAction(step), false);

const stepAction = (step: Pick<Step, "do" | "use" | "with">): BlockNode[] => {
  const children: BlockNode[] = [];
  if (step.use) {
    const json =
      step.with && Object.keys(step.with).length ? JSON.stringify(step.with) : null;
    if (json && !fitsInline(json)) {
      children.push(jsonBlock({ use: step.use, with: step.with }));
    } else {
      children.push(block(`use:: ${step.use}`));
      if (json) children.push(block(`with:: ${inline(json)}`));
    }
  } else if (step.do) {
    children.push(...actionBlocks(step.do));
  }
  return children;
};

const stepBlock = (step: Step, index: number, previous: Step[]): BlockNode => {
  const id = step.id !== nextStepId(previous.slice(0, index)) ? [block(`id:: ${inline(step.id)}`)] : [];
  return block(step.why, [...id, ...stepAction(step)], false);
};

const caseBlock = (testCase: TestCase): BlockNode => {
  const children: BlockNode[] = [block(`id:: ${inline(testCase.id)}`)];
  for (const key of ["proves", "checks", "intent", "caption", "toast"] as const) {
    const value = testCase[key];
    if (value) children.push(block(`${key}:: ${value}`));
  }
  for (const note of testCase.notes ?? []) children.push(block(`note:: ${note}`));
  if (testCase.surface) children.push(block(`area:: ${inline(testCase.surface)}`));
  if (testCase.decision) {
    children.push(block(`decision:: ${testCase.decision.status}`));
    if (testCase.decision.by) children.push(block(`decided by:: ${testCase.decision.by}`));
    if (testCase.decision.at) children.push(block(`decided at:: ${inline(testCase.decision.at)}`));
    if (testCase.decision.reason) children.push(block(`reason:: ${testCase.decision.reason}`));
  }
  testCase.steps.forEach((step, index) => {
    children.push(stepBlock(step, index, testCase.steps));
  });
  if (testCase.expect?.text) children.push(block(`expect:: ${testCase.expect.text}`));
  if (testCase.expect?.js) {
    const js = testCase.expect.js;
    children.push(
      fitsInline(js)
        ? block(`expect js:: ${inline(js)}`)
        : block("expect js::", [jsBlock(js)], false),
    );
  }
  return block(`case:: ${testCase.title}`, children);
};

const surfaceBlock = (area: SurfaceArea): BlockNode =>
  block(area.area, [
    block(`id:: ${inline(area.id)}`),
    block(`why:: ${area.why}`),
    ...(area.files?.length ? [block(`files:: ${area.files.map(inline).join(", ")}`)] : []),
  ]);

const fixtureBlock = (fixture: Fixture): BlockNode => {
  const { why, ...rest } = fixture;
  return block(why, [jsonBlock(rest)], false);
};

// The blocks for a kit, rooted at a {{proof}} block. build names the branch
// whose build the page loads.
export const kitBlocks = (
  kit: Kit,
  { build }: { build?: string | null } = {},
): BlockNode => {
  const children: BlockNode[] = [block(`kit:: ${kit.name}`)];
  if (kit.title) children.push(block(`title:: ${kit.title}`));
  if (kit.ticket) children.push(block(`ticket:: ${kit.ticket}`));
  if (build) children.push(block(`build:: ${build}`));
  if (kit.target?.pr) children.push(block(`pr:: ${kit.target.pr}`));
  if (kit.claim) children.push(block(`claim:: ${kit.claim}`));
  if (kit.given) children.push(block(`given:: ${kit.given}`));
  if (kit.baseline) children.push(block(`baseline:: ${kit.baseline}`));
  if (kit.needs?.length) {
    const listed = kit.needs.filter((need): need is string => typeof need === "string");
    const custom = kit.needs.filter((need) => typeof need !== "string");
    children.push(
      custom.length
        ? block(`needs:: ${listed.join(", ")}`, custom.map(jsonBlock), false)
        : block(`needs:: ${listed.join(", ")}`),
    );
  }
  if (kit.prepare?.length) {
    children.push(block("prepare", kit.prepare.map(fixtureBlock), false));
  }
  if (kit.target) {
    const { pr: _pr, ...rest } = kit.target;
    if (Object.keys(rest).length) children.push(block("target", [jsonBlock(rest)], false));
  }
  if (kit.surface?.length) children.push(block("surface", kit.surface.map(surfaceBlock)));
  for (const testCase of kit.cases) children.push(caseBlock(testCase));
  return block(`{{proof}} ${kit.title ?? kit.name}`, children);
};
