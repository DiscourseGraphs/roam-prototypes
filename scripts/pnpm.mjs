import { spawnSync } from "node:child_process";
import path from "node:path";

const isPnpmCli = (candidate) =>
  /^pnpm(?:\.c?js)?$/i.test(path.basename(candidate || ""));

export const resolvePnpmInvocation = ({
  env = process.env,
  nodeExecutable = process.execPath,
  platform = process.platform,
} = {}) => {
  if (isPnpmCli(env.npm_execpath)) {
    return {
      command: nodeExecutable,
      prefixArguments: [env.npm_execpath],
    };
  }
  if (platform === "win32") {
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      prefixArguments: ["/d", "/c", "pnpm"],
    };
  }
  return {
    command: "pnpm",
    prefixArguments: [],
  };
};

export const runPnpmSync = (arguments_, options = {}) => {
  const env = options.env || process.env;
  const { command, prefixArguments } = resolvePnpmInvocation({ env });
  return spawnSync(command, [...prefixArguments, ...arguments_], {
    ...options,
    env,
    shell: false,
  });
};
