import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LOCAL_BUILDS_URL } from "../src/core/database.ts";
import { agentPrompt, parseProofLink } from "../src/roam/links.ts";
import * as database from "./database.ts";
import { helperPaths, resolvePlace, writeConfig } from "./config.ts";
import { installHandler, thisMachine, uninstallHandler } from "./handler.ts";
import { helperAnswers, serveHelper } from "./server.ts";

// The proof helper: what a developer's machine runs so a kit page's Connect
// this machine works. Set it up once; the page does the rest.
//
//   setup [--dg <discourse-graph checkout>] [--runtime docker|native] [--workdir <dir>]
//         remember where the checkout is and how Supabase runs here, and
//         register dg-proof:// links (Linux and macOS)
//   start [--port 8766] [--no-ensure]
//         what Connect runs: the embeddings stub and the proof database,
//         then the keys server the page asks; runs until stopped
//   stop  stop a running helper and what it started
//   status
//   open <dg-proof://…>
//         what a link runs: connect starts the helper; agent opens a
//         terminal with claude on the kit
//   uninstall
//         remove the link registration (the database's files stay)
//
// Run with Node 22 or later: node --experimental-strip-types cli.ts <command>,
// or `pnpm helper <command>` in roam-prototypes/prototypes/proof-runner.

const log = (line: string): void => console.log(`[proof-helper] ${line}`);

const flagsOf = (args: string[]): Record<string, string | boolean> => {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) flags[arg.slice(2)] = true;
    else {
      flags[arg.slice(2)] = next;
      index += 1;
    }
  }
  return flags;
};

const text = (value: string | boolean | undefined): string | undefined => (typeof value === "string" ? value : undefined);

const here = process.argv[1];

// What a link runs: this file, with the flags Node was started with (tsx's
// loader, or type stripping), so it runs the same way from a click.
const launchCommand = (): string[] => [process.execPath, ...process.execArgv, here];

const placeFrom = (flags: Record<string, string | boolean>, needCheckout = true) =>
  resolvePlace({ dg: text(flags.dg), runtime: text(flags.runtime), workdir: text(flags.workdir) }, path.dirname(here), { needCheckout });

const setup = async (flags: Record<string, string | boolean>): Promise<void> => {
  const place = await placeFrom(flags);
  const config = await writeConfig(place);
  log(`Saved ${config}: schema from ${place.checkout}, Supabase in ${place.runtime === "docker" ? "Docker" : "native processes"}, files in ${place.workdir}.`);
  await installHandler(thisMachine(launchCommand(), helperPaths().app));
  log("dg-proof:// links are registered. Open a kit page and press Connect this machine; the browser asks once before opening the link.");
};

const commandExists = (name: string): boolean => spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;

// A terminal with claude on the kit, in the checkout. The prompt goes in
// through the environment (or a file on macOS), never through a shell.
const openAgent = async (graph: string, uid: string, checkout: string): Promise<void> => {
  const prompt = agentPrompt(graph, uid);
  const title = `proof agent · ${graph}`;
  const shell = process.env.SHELL ?? "/bin/sh";
  const run = 'claude "$PROOF_AGENT_PROMPT"; exec "$SHELL"';
  if (process.platform === "darwin") {
    const file = path.join(os.tmpdir(), `dg-proof-agent-${uid}.txt`);
    await fs.writeFile(file, prompt);
    const line = `cd ${JSON.stringify(checkout)} && claude "$(cat ${JSON.stringify(file)})"`;
    spawn("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(line)}`, "-e", 'tell application "Terminal" to activate'], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  const terminal = commandExists("kitty")
    ? ["kitty", "--directory", checkout, "--title", title, shell, "-ic", run]
    : commandExists("x-terminal-emulator")
      ? ["x-terminal-emulator", "-e", shell, "-ic", run]
      : null;
  if (!terminal) {
    log("No terminal found to open the agent in; the page put the prompt on the clipboard.");
    return;
  }
  spawn(terminal[0], terminal.slice(1), { cwd: checkout, detached: true, stdio: "ignore", env: { ...process.env, PROOF_AGENT_PROMPT: prompt } }).unref();
};

const open = async (link: string | undefined): Promise<void> => {
  if (!link) throw new Error("open needs a dg-proof:// link.");
  const parsed = parseProofLink(link);
  log(`open ${link}`);
  const place = await placeFrom({});
  if (parsed.kind === "connect") {
    if (await helperAnswers()) {
      log("The helper is already running.");
      return;
    }
    await serveHelper({ place, ensure: true, log });
    return;
  }
  await openAgent(parsed.graph, parsed.uid, place.checkout);
};

const main = async (): Promise<void> => {
  const [command = "help", ...args] = process.argv.slice(2);
  const flags = flagsOf(args);
  if (command === "setup") await setup(flags);
  else if (command === "start") {
    const ensure = flags["no-ensure"] !== true;
    await serveHelper({
      place: await placeFrom(flags, ensure),
      port: text(flags.port) ? Number(flags.port) : undefined,
      ensure,
      log,
    });
  } else if (command === "stop") {
    await fetch(`${LOCAL_BUILDS_URL}/stop`, { method: "POST" }).catch(() => undefined);
    log("Asked the helper to stop.");
  } else if (command === "status") {
    const place = await placeFrom(flags, false);
    const { answering, state } = await database.status(place);
    log(`Helper: ${(await helperAnswers()) ? "running" : "not running"}. Proof database: ${answering ? "answering" : "not answering"}.`);
    if (state) log(`Schema from ${state.source}, seeded ${state.seededAt}.`);
  } else if (command === "open") await open(args[0]);
  else if (command === "uninstall") {
    await uninstallHandler(thisMachine(launchCommand(), helperPaths().app));
    log("dg-proof:// links are no longer registered; the database's files stay.");
  } else {
    console.log("proof helper: setup [--dg <checkout>] [--runtime docker|native] [--workdir <dir>] | start [--port <n>] [--no-ensure] | stop | status | open <link> | uninstall");
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
