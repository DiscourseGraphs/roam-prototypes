// The proof database: a local Supabase on its own ports, used by proof kits
// and nothing else. Builds made for kits are compiled against it, and every
// path in proof that touches a database (fixtures, helpers, the in-Roam
// runner) goes here. The hosted database (production) is never one of them.
export const PROOF_DB_HOST = "127.0.0.1:55321";
export const PROOF_DB_URL = `http://${PROOF_DB_HOST}`;

// Where `roam/cli.ts local` serves PRs' local builds and the proof
// database's keys to the in-Roam runner.
export const LOCAL_BUILDS_URL = "http://127.0.0.1:8766";

// The embeddings stub, which local builds also name on 127.0.0.1.
const EMBED_STUB_PORT = "3210";
export const EMBED_STUB_URL = `http://127.0.0.1:${EMBED_STUB_PORT}`;

// The database a build was compiled against, read from the bundle: the proof
// database, a hosted project, or another local stack (a dev one). DG's other
// local URLs (the website on localhost:3000 and friends) use "localhost",
// while Supabase's own status output, which builds bake, uses 127.0.0.1.
export const databaseUrlOf = (source: string): string | null => {
  if (source.includes(PROOF_DB_HOST)) return PROOF_DB_URL;
  const hosted = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(source)?.[0];
  if (hosted) return hosted;
  for (const match of source.matchAll(/http:\/\/127\.0\.0\.1:(\d+)/g)) {
    if (match[1] !== EMBED_STUB_PORT) return match[0];
  }
  return null;
};

export const isProofDatabase = (url: string | null): boolean => url === PROOF_DB_URL;

const HOSTED_DB = /https:\/\/[a-z0-9]+\.supabase\.co/g;
const PUBLISHABLE_KEY = /sb_publishable_[A-Za-z0-9_-]+/g;
// A legacy anon key: a JWT whose payload names the anon role.
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// DG's website root, which its API and error reports hang off; docs links
// and schema ids under it stay as they are.
const WEBSITE_API = /https:\/\/discoursegraphs\.com\/(?=api\b|["'`])/g;

const isAnonKey = (token: string): boolean => {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "="))) as { role?: string };
    return payload.role === "anon";
  } catch {
    return false;
  }
};

// What of the hosted stack a build still names: its database, a key that
// isn't the proof database's, DG's website API.
export const productionLeftIn = (source: string, publishableKey: string): string[] => {
  const left = new Set<string>();
  for (const match of source.matchAll(HOSTED_DB)) left.add(match[0]);
  for (const match of source.matchAll(PUBLISHABLE_KEY)) if (match[0] !== publishableKey) left.add("a hosted publishable key");
  for (const match of source.matchAll(JWT)) if (match[0] !== publishableKey && isAnonKey(match[0])) left.add("a hosted anon key");
  if (WEBSITE_API.test(source)) left.add("discoursegraphs.com's API");
  WEBSITE_API.lastIndex = 0;
  return [...left];
};

// A PR's CI build, compiled against the hosted database, pointed at the
// proof database before it runs: the Supabase URL and key go to the proof
// database, and DG's website API (embeddings, error reports) to the
// embeddings stub, which is what a local build bakes in. Throws when any of
// the hosted stack is left, so a build that could still reach production
// never runs.
export const pointAtProofDatabase = (source: string, publishableKey: string): string => {
  const pointed = source
    .replace(HOSTED_DB, PROOF_DB_URL)
    .replace(PUBLISHABLE_KEY, publishableKey)
    .replace(JWT, (token) => (isAnonKey(token) ? publishableKey : token))
    .replace(WEBSITE_API, `${EMBED_STUB_URL}/`);
  const left = productionLeftIn(pointed, publishableKey);
  if (left.length) {
    throw new Error(`This build still names ${left.join(", ")} after pointing it at the proof database, so it won't run.`);
  }
  if (!pointed.includes(PROOF_DB_HOST)) throw new Error("This build names no database to point at the proof database.");
  return pointed;
};

// The flags that make DG connect to its database when it loads.
export const CONNECTING_FLAGS = ["Suggestive mode overlay enabled", "Enable node sharing"];

const FLAG_SET = /proof\.flags\.set\(\s*(['"])(.+?)\1\s*,\s*(true|false)\s*\)/g;

// The connecting flags on once a kit's setup has run: what's on in the graph
// now, then each setup js that turns one on or off, in order.
export const connectingFlagsAfter = (on: readonly string[], setupJs: readonly string[]): string[] => {
  const flags = new Set(on.filter((name) => CONNECTING_FLAGS.includes(name)));
  for (const js of setupJs) {
    for (const match of js.matchAll(FLAG_SET)) {
      if (!CONNECTING_FLAGS.includes(match[2])) continue;
      if (match[3] === "true") flags.add(match[2]);
      else flags.delete(match[2]);
    }
  }
  return [...flags];
};
