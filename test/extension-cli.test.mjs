import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDevelopmentNotifier,
  pathsReferToSameFile,
} from "../packages/extension-base/scripts/cli.mjs";

test("recognizes a CLI invoked through a workspace directory link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "roam-extension-cli-"));
  const realDirectory = path.join(root, "real");
  const linkedDirectory = path.join(root, "linked");
  const filename = "cli.mjs";

  try {
    await mkdir(realDirectory);
    await writeFile(path.join(realDirectory, filename), "", "utf8");
    await symlink(
      realDirectory,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.equal(
      pathsReferToSameFile(
        path.join(linkedDirectory, filename),
        path.join(realDirectory, filename),
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports the initial development build and subsequent updates", () => {
  const messages = [];
  const callbacks = [];
  const notifier = createDevelopmentNotifier({
    outdir: path.join(process.cwd(), "dist"),
    log: (message) => messages.push(message),
  });
  notifier.setup({ onEnd: (callback) => callbacks.push(callback) });

  callbacks[0]({ errors: [] });
  callbacks[0]({ errors: [] });
  callbacks[0]({ errors: [{}] });

  assert.deepEqual(messages, [
    "Built dist; watching for changes",
    "Updated dist",
  ]);
});
