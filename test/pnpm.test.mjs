import assert from "node:assert/strict";
import test from "node:test";
import { resolvePnpmInvocation } from "../scripts/pnpm.mjs";

test("uses pnpm's executing CLI only when npm_execpath belongs to pnpm", () => {
  assert.deepEqual(
    resolvePnpmInvocation({
      env: { npm_execpath: "/tools/pnpm.cjs" },
      nodeExecutable: "/tools/node",
      platform: "linux",
    }),
    {
      command: "/tools/node",
      prefixArguments: ["/tools/pnpm.cjs"],
    },
  );

  assert.deepEqual(
    resolvePnpmInvocation({
      env: { npm_execpath: "/tools/npm-cli.js" },
      nodeExecutable: "/tools/node",
      platform: "linux",
    }),
    {
      command: "pnpm",
      prefixArguments: [],
    },
  );
});

test("resolves the pnpm command shim on Windows when invoked directly", () => {
  assert.deepEqual(
    resolvePnpmInvocation({
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      prefixArguments: ["/d", "/c", "pnpm"],
    },
  );
});
