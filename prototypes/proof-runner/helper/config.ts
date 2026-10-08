import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Place, Runtime } from "./database.ts";

// Where the helper keeps its files on this machine, and what setup decided:
// the discourse-graph checkout, Docker or native, and the working folder.

const appDir = (): string =>
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library/Application Support/dg-proof")
    : process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "dg-proof")
      : path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"), "dg-proof");

export const helperPaths = () => {
  const app = appDir();
  const config =
    process.env.DG_PROOF_CONFIG ??
    (process.platform === "linux"
      ? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "dg-proof", "config.json")
      : path.join(app, "config.json"));
  return { app, config, workdir: path.join(app, "db"), log: path.join(app, "handler.log") };
};

const CONFIG_FILE = "packages/database/supabase/config.toml";

export const isCheckout = (dir: string): boolean => existsSync(path.join(dir, CONFIG_FILE));

// A discourse-graph checkout next to one of the folders the helper sits in,
// the usual layout of side-by-side clones.
export const findCheckout = (from: string): string | null => {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const sibling = path.join(dir, "discourse-graph");
    if (isCheckout(sibling)) return sibling;
    if (path.dirname(dir) === dir) return null;
  }
};

export const dockerAnswers = (): boolean => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

export const readConfig = async (): Promise<Place | null> => {
  try {
    return JSON.parse(await fs.readFile(helperPaths().config, "utf8")) as Place;
  } catch {
    return null;
  }
};

export const writeConfig = async (place: Place): Promise<string> => {
  const file = helperPaths().config;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(place, null, 2)}\n`);
  return file;
};

// The place from flags, then setup's config, then what this machine has. A
// helper that only answers (no database to start) needs no checkout.
export const resolvePlace = async (
  flags: { dg?: string; runtime?: string; workdir?: string },
  from: string,
  { needCheckout = true }: { needCheckout?: boolean } = {},
): Promise<Place> => {
  const saved = await readConfig();
  const checkout = flags.dg ?? saved?.checkout ?? findCheckout(from) ?? (needCheckout ? null : "");
  if (checkout === null || (needCheckout && !isCheckout(checkout))) {
    throw new Error(
      `${checkout ? `${checkout} isn't a discourse-graph checkout` : "No discourse-graph checkout found next to this one"}: pass --dg <path to your discourse-graph checkout>.`,
    );
  }
  // Supabase's native stack runs on Linux and macOS; Windows runs it in Docker.
  const windows = process.platform === "win32";
  const runtime = (flags.runtime ?? saved?.runtime ?? (windows || dockerAnswers() ? "docker" : "native")) as Runtime;
  if (runtime !== "docker" && runtime !== "native") throw new Error("--runtime is docker or native.");
  if (windows && runtime === "native") throw new Error("On Windows the proof database runs in Docker (Docker Desktop); leave out --runtime.");
  return {
    checkout: checkout && path.resolve(checkout),
    runtime,
    workdir: path.resolve(flags.workdir ?? saved?.workdir ?? helperPaths().workdir),
  };
};
