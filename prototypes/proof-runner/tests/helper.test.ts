// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The helper a tester's machine runs for the panel's Connect, run the way
// `pnpm helper` runs it: plain Node, stripping the TypeScript types.

const PROTOTYPE = path.resolve(__dirname, "..");

describe("the proof helper", () => {
  it("runs on plain Node, answers roamresearch.com only, and stops when asked", async () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), "proof-helper-"));
    const port = 18767;
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "helper/cli.ts", "start", "--no-ensure", "--port", String(port), "--workdir", path.join(scratch, "db")],
      { cwd: PROTOTYPE, stdio: "ignore", env: { ...process.env, DG_PROOF_CONFIG: path.join(scratch, "config.json") } },
    );
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    try {
      const url = `http://127.0.0.1:${port}`;
      let status: Response | null = null;
      for (let attempt = 0; attempt < 80 && !status; attempt += 1) {
        status = await fetch(`${url}/status`, { headers: { Origin: "https://roamresearch.com" } }).catch(() => null);
        if (!status) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(status?.status).toBe(200);
      expect(await status?.json()).toEqual({ database: null, env: null, starting: false, error: null });
      expect((await fetch(`${url}/status`, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
      expect((await fetch(`${url}/stop`, { method: "POST", headers: { Origin: "https://roamresearch.com" } })).status).toBe(204);
      expect(await exited).toBe(0);
    } finally {
      child.kill();
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
