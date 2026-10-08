import type { Action } from "./action";
import { RECIPE_NAME, validateAction, type Step } from "./kit";

// Recipes are named step sequences kept in proof/recipes/*.json, so a kit
// says { "use": "settings.stored-relations", "with": { "on": false } } and
// the steps live in one place. A recipe can use other recipes. Parameters
// fill {{with.NAME}} (as text, for selectors and labels) and
// {{json with.NAME}} (JSON-encoded, the only form allowed inside js, so a
// value can't break out of its string).

export type RecipeParam = {
  type: "string" | "boolean" | "number";
  default?: string | boolean | number;
};

export type RecipeStep =
  | { do: Action; why: string }
  | { use: string; with?: Record<string, unknown>; why?: string };

export type Recipe = {
  name: string;
  why: string;
  params: Record<string, RecipeParam>;
  steps: RecipeStep[];
};

export type RecipeBook = Map<string, Recipe>;


const PARAM_TOKEN = /\{\{(json )?with\.([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const RAW_PARAM_IN_JS = /\{\{with\.[a-zA-Z]/;
const MAX_DEPTH = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const checkJsParams = (value: unknown, where: string): void => {
  if (typeof value === "string") return;
  if (!isRecord(value)) return;
  if (typeof value.js === "string" && RAW_PARAM_IN_JS.test(value.js)) {
    throw new Error(
      `${where}: inside js, write {{json with.NAME}} so the value stays a JS literal.`,
    );
  }
  if (isRecord(value.when)) {
    checkJsParams({ js: value.when.js }, where);
    if (Array.isArray(value.when.do)) {
      value.when.do.forEach((inner) => checkJsParams(inner, where));
    }
  }
};

export const parseRecipes = (
  raw: unknown,
  source: string,
  book: RecipeBook = new Map(),
): RecipeBook => {
  if (!isRecord(raw)) throw new Error(`${source}: recipes must be a JSON object.`);
  for (const [name, value] of Object.entries(raw)) {
    const where = `${source}: ${name}`;
    if (!RECIPE_NAME.test(name)) {
      throw new Error(`${where}: recipe names look like "settings.stored-relations".`);
    }
    if (book.has(name)) throw new Error(`${where}: defined twice.`);
    if (!isRecord(value) || typeof value.why !== "string" || !Array.isArray(value.steps)) {
      throw new Error(`${where}: a recipe is { why, params?, steps }.`);
    }
    const params: Record<string, RecipeParam> = {};
    for (const [param, spec] of Object.entries(isRecord(value.params) ? value.params : {})) {
      if (!isRecord(spec) || !["string", "boolean", "number"].includes(String(spec.type))) {
        throw new Error(`${where}: param ${param} needs a type of string, boolean or number.`);
      }
      params[param] = spec as RecipeParam;
    }
    const steps = value.steps.map((step, index): RecipeStep => {
      const at = `${where} step ${index + 1}`;
      if (!isRecord(step)) throw new Error(`${at}: a step must be an object.`);
      if (typeof step.use === "string") {
        return {
          use: step.use,
          with: isRecord(step.with) ? step.with : undefined,
          why: typeof step.why === "string" ? step.why : undefined,
        };
      }
      if (!isRecord(step.do) || typeof step.why !== "string") {
        throw new Error(`${at}: a step is { do, why } or { use, with?, why? }.`);
      }
      checkJsParams(step.do, at);
      return { do: validateAction(step.do, at), why: step.why };
    });
    book.set(name, { name, why: value.why, params, steps });
  }
  return book;
};


const resolveArgs = (
  recipe: Recipe,
  given: Record<string, unknown>,
): Record<string, unknown> => {
  const args: Record<string, unknown> = {};
  for (const name of Object.keys(given)) {
    if (!(name in recipe.params)) {
      throw new Error(`Recipe ${recipe.name} has no parameter "${name}".`);
    }
  }
  for (const [name, spec] of Object.entries(recipe.params)) {
    const value = given[name] !== undefined ? given[name] : spec.default;
    if (value === undefined) {
      throw new Error(`Recipe ${recipe.name} needs "${name}".`);
    }
    if (typeof value !== spec.type) {
      throw new Error(`Recipe ${recipe.name}: "${name}" must be a ${spec.type}.`);
    }
    args[name] = value;
  }
  return args;
};

const fillParams = <T>(value: T, args: Record<string, unknown>): T => {
  if (typeof value === "string") {
    return value.replace(PARAM_TOKEN, (_match, json: string | undefined, name: string) => {
      if (!(name in args)) throw new Error(`No value for {{with.${name}}}.`);
      return json ? JSON.stringify(args[name]) : String(args[name]);
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item) => fillParams(item, args)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fillParams(item, args)]),
    ) as T;
  }
  return value;
};

// The actions a recipe stands for, with its parameters filled in.
export const expandRecipe = (
  book: RecipeBook,
  name: string,
  given: Record<string, unknown> = {},
  depth = 0,
): Action[] => {
  if (depth > MAX_DEPTH) {
    throw new Error(`Recipe ${name} nests more than ${MAX_DEPTH} deep; is it calling itself?`);
  }
  const recipe = book.get(name);
  if (!recipe) {
    throw new Error(
      `Unknown recipe "${name}". Known: ${[...book.keys()].sort().join(", ") || "none"}.`,
    );
  }
  const args = resolveArgs(recipe, given);
  const actions: Action[] = [];
  for (const step of recipe.steps) {
    if ("use" in step) {
      actions.push(
        ...expandRecipe(book, step.use, fillParams(step.with ?? {}, args), depth + 1),
      );
    } else {
      actions.push(fillParams(step.do, args));
    }
  }
  return actions;
};

export const describeRecipe = (book: RecipeBook, name: string): string =>
  book.get(name)?.why ?? name;

// Turns any step into the actions it runs: a plain step is its own action,
// a recipe step is the recipe's actions.
export const makeExpander =
  (book: RecipeBook) =>
  (step: Step): Action[] => {
    if (step.do) return [step.do];
    if (step.use) return expandRecipe(book, step.use, step.with ?? {});
    throw new Error(`Step ${step.id} has neither do nor use.`);
  };
