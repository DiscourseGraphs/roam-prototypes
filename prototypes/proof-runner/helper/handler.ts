import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// dg-proof:// links, registered once per machine so the panel's buttons can
// start the helper (and an agent). The link reaches a launcher script that
// runs the helper's `open` in the background, so the browser's click returns
// at once. Linux registers through xdg (a desktop entry); macOS through a
// small AppleScript app that receives the link as an event, since macOS
// doesn't hand links to plain scripts. The plans are data, so both are
// tested on any machine.

export type HandlerPlan = {
  files: Array<{ path: string; text: string; mode?: number }>;
  // Run in order after the files are written.
  commands: string[][];
  // What the uninstall removes.
  remove: string[];
};

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

// The script every link runs: the helper's open, detached and logged.
const launcherScript = (command: string[], log: string): string =>
  [
    "#!/bin/sh",
    "# Written by the proof helper's setup: answers dg-proof:// links.",
    `nohup ${command.map(quote).join(" ")} open "$1" >> ${quote(log)} 2>&1 < /dev/null &`,
    "",
  ].join("\n");

export const linuxHandler = ({ home, command, app }: { home: string; command: string[]; app: string }): HandlerPlan => {
  const launcher = path.join(app, "open.sh");
  const applications = path.join(home, ".local/share/applications");
  const desktop = path.join(applications, "dg-proof.desktop");
  return {
    files: [
      { path: launcher, text: launcherScript(command, path.join(app, "handler.log")), mode: 0o755 },
      {
        path: desktop,
        text: ["[Desktop Entry]", "Type=Application", "Name=Proof kits", `Exec=${launcher} %u`, "MimeType=x-scheme-handler/dg-proof;", "NoDisplay=true", "Terminal=false", ""].join("\n"),
      },
    ],
    commands: [
      ["xdg-mime", "default", "dg-proof.desktop", "x-scheme-handler/dg-proof"],
      ["update-desktop-database", applications],
    ],
    remove: [desktop, launcher],
  };
};

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export const macHandler = ({ home, command, app }: { home: string; command: string[]; app: string }): HandlerPlan => {
  const launcher = path.join(app, "open.sh");
  const source = path.join(app, "DG Proof.applescript");
  const bundle = path.join(home, "Applications", "DG Proof.app");
  const plist = path.join(bundle, "Contents", "Info.plist");
  const applescript = [
    "on open location theURL",
    `\tdo shell script quoted form of ${JSON.stringify(launcher)} & " " & quoted form of theURL`,
    "end open location",
    "",
  ].join("\n");
  return {
    files: [
      { path: launcher, text: launcherScript(command, path.join(app, "handler.log")), mode: 0o755 },
      { path: source, text: applescript },
    ],
    commands: [
      ["osacompile", "-o", bundle, source],
      ["plutil", "-replace", "CFBundleURLTypes", "-json", JSON.stringify([{ CFBundleURLName: "DG Proof", CFBundleURLSchemes: ["dg-proof"] }]), plist],
      ["plutil", "-replace", "LSUIElement", "-bool", "true", plist],
      [LSREGISTER, "-f", bundle],
    ],
    remove: [launcher, source, bundle],
  };
};

export const handlerFor = (platform: NodeJS.Platform, options: { home: string; command: string[]; app: string }): HandlerPlan => {
  if (platform === "linux") return linuxHandler(options);
  if (platform === "darwin") return macHandler(options);
  throw new Error(`dg-proof:// links can't be registered on ${platform} yet (Linux and macOS can).`);
};

// update-desktop-database isn't on every Linux desktop; xdg-mime's default
// is what links follow.
const OPTIONAL = new Set(["update-desktop-database"]);

export const installHandler = async (plan: HandlerPlan): Promise<void> => {
  for (const file of plan.files) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.text, { mode: file.mode });
  }
  for (const [command, ...args] of plan.commands) {
    try {
      execFileSync(command, args, { stdio: "inherit" });
    } catch (error) {
      if (!OPTIONAL.has(command)) throw error;
    }
  }
};

export const uninstallHandler = async (plan: HandlerPlan): Promise<void> => {
  for (const target of plan.remove) await fs.rm(target, { recursive: true, force: true });
};

export const thisMachine = (command: string[], app: string): HandlerPlan => handlerFor(process.platform, { home: os.homedir(), command, app });
