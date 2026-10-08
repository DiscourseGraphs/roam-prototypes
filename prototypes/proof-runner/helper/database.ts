import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROOF_DB_URL } from "../src/core/database.ts";

// The proof database: a local Supabase only proof kits use, apart from the
// stacks a developer works against and never the hosted one. It runs on its
// own ports (the API on 127.0.0.1:55321, Postgres on 55322) as project
// "dg-proof", in Docker the way discourse-graph's README runs Supabase, or as
// native processes (the CLI's experimental stack). Its schema is a
// discourse-graph checkout's migrations. Where it keeps its files, which
// checkout and which runtime make a Place; nothing here knows a machine.

export type Runtime = "docker" | "native";

export type Place = {
  // Where the project, the pinned CLI, the keys and the state live.
  workdir: string;
  // The discourse-graph checkout whose migrations make the schema.
  checkout: string;
  runtime: Runtime;
};

export const PROJECT_ID = "dg-proof";
// The CLI the proof database is tested on; the native stack is alpha.
export const SUPABASE_CLI_VERSION = "2.119.0";
const SOURCE = "packages/database/supabase";
// Kits use the API, auth, storage and Postgres. The rest stays off.
const EXCLUDED = ["analytics", "mail", "functions"];

type Result = { code: number; stdout: string; stderr: string };

const run = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; echo?: boolean; input?: string; shell?: boolean } = {},
): Promise<Result> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: options.shell,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (options.echo) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (options.echo) process.stderr.write(chunk);
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const log = (message: string): void => console.log(`[proof-db] ${message}`);

const files = (place: Place) => ({
  supabase: path.join(place.workdir, "supabase"),
  env: path.join(place.workdir, ".env"),
  state: path.join(place.workdir, "state.json"),
  // The CLI package's own launcher, run with Node: the same on every OS,
  // where node_modules/.bin holds shell or .cmd shims.
  cli: path.join(place.workdir, "node_modules", "supabase", "dist", "supabase.js"),
});

// The CLI maps every SUPABASE_* variable onto its config, so keys exported
// for another stack (or the hosted one) must not reach it.
const cliEnv = (place: Place): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("SUPABASE_")) env[name] = value;
  }
  if (place.runtime === "native") env.SUPABASE_EXPERIMENTAL_STACK = "1";
  return env;
};

const cli = async (place: Place, args: string[], echo = false): Promise<Result> => {
  const { cli: bin } = files(place);
  if (!existsSync(bin)) {
    log(`Installing the Supabase CLI ${SUPABASE_CLI_VERSION} into ${place.workdir} (once).`);
    await fs.mkdir(place.workdir, { recursive: true });
    const manifest = path.join(place.workdir, "package.json");
    if (!existsSync(manifest)) {
      await fs.writeFile(
        manifest,
        `${JSON.stringify({ name: "proof-db", private: true, devDependencies: { supabase: SUPABASE_CLI_VERSION } }, null, 2)}\n`,
      );
    }
    // npm is a .cmd on Windows, which Node only runs through a shell.
    const install = await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: place.workdir, shell: process.platform === "win32" });
    if (install.code !== 0) throw new Error(`npm install in ${place.workdir} failed:\n${install.stderr.slice(-1500)}`);
  }
  return run(process.execPath, [bin, ...args, "--workdir", place.workdir, "--agent", "no"], { env: cliEnv(place), echo });
};

const failed = (what: string, result: Result): Error =>
  new Error(`${what} failed (exit ${result.code}):\n${(result.stderr || result.stdout).trim().split("\n").slice(-12).join("\n")}`);

// The checkout's config.toml, moved onto the proof database's ports (543xx
// becomes 553xx) and its own project id, so it never meets a developer's own
// stack. For the native runtime it turns on the experimental stack and drops
// the Deno 1 pin the stack refuses (edge functions stay off anyway).
export const proofConfig = (toml: string, runtime: Runtime = "native"): string => {
  let experimental = false;
  const lines = toml.split("\n").flatMap((line): string[] => {
    if (/^\s*project_id\s*=/.test(line)) return [`project_id = "${PROJECT_ID}"`];
    if (/^\s*deno_version\s*=/.test(line)) return runtime === "native" ? [] : [line];
    if (/^\s*inspector_port\s*=/.test(line)) return ["inspector_port = 55383"];
    const port = /^(\s*(?:port|shadow_port)\s*=\s*)543(\d\d)\s*$/.exec(line);
    if (port) return [`${port[1]}553${port[2]}`];
    if (/^\s*stack\s*=/.test(line)) return [];
    if (/^\s*\[experimental\]\s*$/.test(line)) {
      experimental = true;
      return runtime === "native" ? [line, "stack = true"] : [line];
    }
    return [line];
  });
  if (!experimental && runtime === "native") lines.push("", "[experimental]", "stack = true");
  const config = lines.join("\n");
  if (!/\[api\][^[]*\nport = 55321\b/.test(config)) {
    throw new Error("The checkout's config.toml doesn't put the API on 54321, so the proof database can't move it to 55321.");
  }
  return config;
};

// Each migration's digest by version, to tell when an applied one changed.
export const migrationDigests = async (dir: string): Promise<Record<string, string>> => {
  const digests: Record<string, string> = {};
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    digests[name.split("_")[0]] = createHash("sha256").update(await fs.readFile(path.join(dir, name))).digest("hex");
  }
  return digests;
};

export type State = { source: string; migrations: Record<string, string>; seededAt: string };

const readState = async (place: Place): Promise<State | null> => {
  try {
    return JSON.parse(await fs.readFile(files(place).state, "utf8")) as State;
  } catch {
    return null;
  }
};

export const parseEnvLines = (text: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
};

// The keys and URLs of the running stack, named the way discourse-graph's
// packages/database/.env.local names them, so kits' {{env.X}} read the same.
const stackEnv = async (place: Place): Promise<Record<string, string>> => {
  const status = await cli(place, ["status", "--env"]);
  if (status.code !== 0) throw failed("supabase status", status);
  const raw = parseEnvLines(status.stdout);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    env[name === "API_URL" ? "SUPABASE_URL" : `SUPABASE_${name}`] = value;
  }
  if (env.SUPABASE_URL !== PROOF_DB_URL) {
    throw new Error(`The proof stack answers on ${env.SUPABASE_URL ?? "nothing"}, not ${PROOF_DB_URL}.`);
  }
  for (const name of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"]) {
    if (!env[name]) throw new Error(`supabase status gave no ${name}.`);
  }
  return env;
};

// The proof database's keys, from the .env up wrote.
export const databaseEnv = async (place: Place): Promise<Record<string, string>> => {
  const text = await fs.readFile(files(place).env, "utf8").catch(() => null);
  if (text === null) throw new Error(`The proof database in ${place.workdir} isn't set up yet.`);
  return parseEnvLines(text);
};

// psql from the native stack's own Postgres build; the machine needn't have one.
const psqlPath = (): string => {
  const root = path.join(os.homedir(), ".supabase/cache/stack/slim-services/postgres");
  const versions = existsSync(root) ? readdirSync(root).sort().reverse() : [];
  for (const version of versions) {
    const candidate = path.join(root, version, `${process.platform}-${process.arch === "x64" ? "amd64" : process.arch}`, "bin/psql");
    if (existsSync(candidate)) return candidate;
  }
  return "psql";
};

// A statement through psql: the native stack's own psql, or the one inside
// the Docker stack's database container.
export const sql = async (
  place: Place,
  statement: string,
  { rows = false }: { rows?: boolean } = {},
): Promise<{ code: number; output: string }> => {
  const flags = ["-X", "-v", "ON_ERROR_STOP=1", ...(rows ? ["-At"] : ["-q"])];
  const result =
    place.runtime === "docker"
      ? await run("docker", ["exec", "-i", `supabase_db_${PROJECT_ID}`, "psql", "-U", "postgres", "-d", "postgres", ...flags], {
          input: statement,
        })
      : await run(psqlPath(), [...flags, "-d", (await databaseEnv(place)).SUPABASE_DB_URL, "-c", statement], { env: cliEnv(place) });
  return { code: result.code, output: (result.stdout + result.stderr).slice(-4000) };
};

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

// What kits expect to find: the two source spaces publish fixtures write as
// (the dev graph and the Obsidian test vault), test-3-graph where kits run,
// each with its anonymous account, the two authors the published nodes name,
// and the eng-2329-demo group all three are in. Ids are fixed because kits
// name them. A graph a kit runs in that isn't here gets its space at sign-in.
type SeedSpace = { id: number; url: string; name: string; platform: "Roam" | "Obsidian" };

export const SEED = {
  spaces: [
    { id: 66566, url: "https://roamresearch.com/#/app/discourse-dev-graph", name: "discourse-dev-graph", platform: "Roam" },
    { id: 106039, url: "obsidian:defc3ac0ee76e0de", name: "Sid-Obsidian-test", platform: "Obsidian" },
    { id: 120237, url: "https://roamresearch.com/#/app/test-3-graph", name: "test-3-graph", platform: "Roam" },
  ] as SeedSpace[],
  // Each author belongs to the space it publishes from, as a real publish
  // leaves it: an importing graph reads relation authors through that access.
  authors: [
    { id: 3, platform: "Roam", localId: "proof-author-roam", name: "Proof author (Roam)", space: 66566 },
    { id: 106041, platform: "Obsidian", localId: "proof-author-obsidian", name: "Proof author (Obsidian)", space: 106039 },
  ],
  group: { name: "eng-2329-demo", admin: 120237 },
  // Generated ids start past every fixed one.
  firstFreeId: 200000,
};

export const anonEmail = (space: SeedSpace): string =>
  `${space.platform.toLowerCase()}-${space.id}-anon@database.discoursegraphs.com`;

export const groupEmail = (name: string): string => `${name}@groups.discoursegraphs.com`;

export const seedSql = (): string => {
  const lines = [
    "BEGIN;",
    `SELECT setval('public.entity_id_seq', GREATEST((SELECT last_value FROM public.entity_id_seq), ${SEED.firstFreeId}));`,
  ];
  for (const author of SEED.authors) {
    lines.push(
      `INSERT INTO "PlatformAccount" (id, platform, account_local_id, name, agent_type) VALUES (${author.id}, '${author.platform}', ${literal(author.localId)}, ${literal(author.name)}, 'person') ON CONFLICT (id) DO NOTHING;`,
    );
  }
  const group = `(SELECT id FROM auth.users WHERE email = ${literal(groupEmail(SEED.group.name))})`;
  for (const space of SEED.spaces) {
    const user = `(SELECT id FROM auth.users WHERE email = ${literal(anonEmail(space))})`;
    lines.push(
      `INSERT INTO "Space" (id, url, name, platform) VALUES (${space.id}, ${literal(space.url)}, ${literal(space.name)}, '${space.platform}') ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, name = EXCLUDED.name;`,
      `INSERT INTO "PlatformAccount" (platform, account_local_id, name, agent_type, dg_account) VALUES ('${space.platform}', ${literal(anonEmail(space))}, 'Anonymous of space ${space.id}', 'anonymous', ${user}) ON CONFLICT (account_local_id, platform) DO UPDATE SET dg_account = EXCLUDED.dg_account;`,
      `INSERT INTO "SpaceAccess" (account_uid, space_id, permissions) VALUES (${user}, ${space.id}, 'editor') ON CONFLICT (account_uid, space_id) DO NOTHING;`,
      `INSERT INTO group_membership (group_id, member_id, admin) VALUES (${group}, ${user}, ${space.id === SEED.group.admin}) ON CONFLICT (member_id, group_id) DO NOTHING;`,
      `INSERT INTO "SpaceAccess" (account_uid, space_id, permissions) VALUES (${group}, ${space.id}, 'partial') ON CONFLICT (account_uid, space_id) DO NOTHING;`,
    );
  }
  for (const author of SEED.authors) {
    lines.push(`INSERT INTO "LocalAccess" (account_id, space_id) VALUES (${author.id}, ${author.space}) ON CONFLICT DO NOTHING;`);
  }
  lines.push("COMMIT;");
  return lines.join("\n");
};

type AuthUser = { id: string; email?: string };

// Auth users go through the admin API (it writes the identities and token
// columns sign-in needs); the rows that point at them go through SQL. The
// anonymous accounts get a throwaway password: proof.supabase.signIn resets
// it to the one the graph or vault stores.
const seed = async (place: Place, env: Record<string, string>): Promise<void> => {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const listed = await fetch(`${PROOF_DB_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!listed.ok) throw new Error(`Listing auth users failed: ${listed.status} ${(await listed.text()).slice(0, 200)}`);
  const existing = new Set(((await listed.json()) as { users?: AuthUser[] }).users?.map((user) => user.email) ?? []);
  const wanted = [
    ...SEED.spaces.map((space) => ({ email: anonEmail(space), password: randomUUID(), email_confirm: true })),
    { email: groupEmail(SEED.group.name), password: randomUUID(), role: "anon", user_metadata: { group: true }, email_confirm: false },
  ];
  for (const user of wanted.filter((item) => !existing.has(item.email))) {
    const created = await fetch(`${PROOF_DB_URL}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify(user) });
    if (!created.ok) throw new Error(`Creating ${user.email} failed: ${created.status} ${(await created.text()).slice(0, 200)}`);
  }
  const result = await sql(place, seedSql());
  if (result.code !== 0) throw new Error(`Seeding failed: ${result.output.trim().slice(-600)}`);
};

const appliedVersions = async (place: Place): Promise<string[]> => {
  const result = await sql(place, "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version", { rows: true });
  if (result.code !== 0) throw new Error(`Reading the applied migrations failed: ${result.output.trim().slice(-400)}`);
  return result.output.split("\n").map((line) => line.trim()).filter(Boolean);
};

// What brings the database to the checkout's migrations: nothing, applying
// the new ones, or a reset when one it applied changed or isn't there.
export const schemaPlan = ({
  applied,
  wanted,
  before,
}: {
  applied: string[];
  wanted: Record<string, string>;
  before: Record<string, string> | null;
}): "current" | "apply" | "reset" => {
  if (applied.some((version) => !(version in wanted))) return "reset";
  if (before && applied.some((version) => version in before && before[version] !== wanted[version])) return "reset";
  return Object.keys(wanted).some((version) => !applied.includes(version)) ? "apply" : "current";
};

const writeProject = async (place: Place): Promise<string> => {
  const source = path.join(place.checkout, SOURCE);
  const config = await fs.readFile(path.join(source, "config.toml"), "utf8").catch(() => null);
  if (config === null) throw new Error(`No ${SOURCE}/config.toml in ${place.checkout}. Is that a discourse-graph checkout?`);
  const { supabase } = files(place);
  await fs.rm(supabase, { recursive: true, force: true });
  await fs.mkdir(supabase, { recursive: true });
  await fs.writeFile(path.join(supabase, "config.toml"), proofConfig(config, place.runtime));
  for (const dir of ["migrations", "schemas", "functions"]) {
    if (existsSync(path.join(source, dir))) await fs.cp(path.join(source, dir), path.join(supabase, dir), { recursive: true });
  }
  return path.join(supabase, "migrations");
};

const writeEnv = async (place: Place, env: Record<string, string>): Promise<void> => {
  const text = `${Object.entries(env)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
  await fs.writeFile(files(place).env, text, { mode: 0o600 });
};

// Starts the proof database, brings its schema to the checkout's migrations
// (a reset when an applied one changed), seeds what kits expect and writes
// its keys.
export const up = async (place: Place, { forceReset = false }: { forceReset?: boolean } = {}): Promise<void> => {
  const before = await readState(place);
  const migrations = await writeProject(place);
  const digests = await migrationDigests(migrations);
  log(`Starting the proof database (${place.runtime}, ${PROOF_DB_URL}) with ${place.checkout}'s schema.`);
  const runtime = place.runtime === "native" ? ["--runtime", "native"] : [];
  const start = await cli(place, ["start", ...runtime, "--exclude", EXCLUDED.join(","), "--output-format", "text"]);
  if (start.code !== 0) throw failed("supabase start", start);
  const env = await stackEnv(place);
  await writeEnv(place, env);
  const plan = forceReset
    ? "reset"
    : schemaPlan({ applied: await appliedVersions(place), wanted: digests, before: before?.migrations ?? null });
  if (plan === "apply") {
    log("Applying the checkout's new migrations.");
    const applied = await cli(place, ["migration", "up", "--local", "--include-all"]);
    if (applied.code !== 0) throw failed("supabase migration up", applied);
  } else if (plan === "reset") {
    log("Resetting the database to the checkout's migrations (its data goes).");
    const reset = await cli(place, ["db", "reset", "--local", "--no-seed"]);
    if (reset.code !== 0) throw failed("supabase db reset", reset);
  }
  await seed(place, env);
  await fs.writeFile(
    files(place).state,
    `${JSON.stringify({ source: place.checkout, migrations: digests, seededAt: new Date().toISOString() }, null, 2)}\n`,
  );
  log(`Ready: ${PROOF_DB_URL}, keys in ${files(place).env}, schema from ${place.checkout}.`);
};

export const stop = async (place: Place): Promise<void> => {
  const stopped = await cli(place, ["stop"], true);
  if (stopped.code !== 0) throw failed("supabase stop", stopped);
};

// Whether the proof database answers, and what it was built from.
export const status = async (place: Place): Promise<{ answering: boolean; state: State | null }> => {
  let answering = false;
  try {
    const response = await fetch(`${PROOF_DB_URL}/auth/v1/health`, { signal: AbortSignal.timeout(8000) });
    answering = response.ok;
  } catch {
    answering = false;
  }
  return { answering, state: await readState(place) };
};

// The CLI's own account of the stack, printed.
export const printStatus = async (place: Place): Promise<void> => {
  await cli(place, ["status", "--output-format", "text"], true);
};
