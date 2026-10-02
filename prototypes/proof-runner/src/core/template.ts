// Values a kit can reference in any string:
//   {{env.NAME}}  from the process env, e.g. keys exported from .env.local
//   {{kit}}       the kit's name
//   {{run}}       an id for this run, for titles that must be unique
//   {{ns}}        the kit's namespace, a prefix for data the kit creates
// Strings are filled only when they run, so keys never land in a kit, a
// proposed kit or a generated storyboard on disk.

export type TemplateContext = {
  env: Record<string, string | undefined>;
  kit: string;
  run: string;
};

const TOKEN = /\{\{(env\.[A-Z][A-Z0-9_]*|kit|run|ns)\}\}/g;

export const namespaceFor = (kit: string): string => `pk-${kit}`;

export const fill = (value: string, context: TemplateContext): string =>
  value.replace(TOKEN, (_match, token: string) => {
    if (token === "kit") return context.kit;
    if (token === "run") return context.run;
    if (token === "ns") return namespaceFor(context.kit);
    const name = token.slice("env.".length);
    const resolved = context.env[name];
    if (resolved === undefined || resolved === "") {
      throw new Error(
        `{{env.${name}}} is not set. Export it before running the kit.`,
      );
    }
    return resolved;
  });

export const fillDeep = <T>(value: T, context: TemplateContext): T => {
  if (typeof value === "string") return fill(value, context) as T;
  if (Array.isArray(value)) {
    return value.map((item) => fillDeep(item, context)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        fillDeep(item, context),
      ]),
    ) as T;
  }
  return value;
};

export const envRefs = (value: unknown): string[] => {
  const found = new Set<string>();
  const walk = (item: unknown): void => {
    if (typeof item === "string") {
      for (const match of item.matchAll(TOKEN)) {
        if (match[1].startsWith("env.")) found.add(match[1].slice(4));
      }
    } else if (Array.isArray(item)) {
      item.forEach(walk);
    } else if (item && typeof item === "object") {
      Object.values(item).forEach(walk);
    }
  };
  walk(value);
  return [...found].sort();
};
