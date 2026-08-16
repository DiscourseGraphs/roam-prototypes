import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = path.join(root, "packages", "extension-base", "skills");
const readSkill = (name) => readFile(path.join(skills, name, "SKILL.md"), "utf8");

test("Roam data guidance prefers current async namespaced reads", async () => {
  const source = await readSkill("graph-data");
  assert.match(source, /roamAlphaAPI\.data\.async\.q/);
  assert.match(source, /roamAlphaAPI\.data\.async\.pull/);
  assert.match(source, /roamAlphaAPI\.data\.async\.fast\.q/);
  assert.doesNotMatch(source, /await window\.roamAlphaAPI\.(?:q|pull)\(/);
});

test("Roam write guidance uses current block and page namespaces", async () => {
  const source = await readSkill("graph-writes");
  for (const api of [
    "data.block.create",
    "data.block.update",
    "data.block.move",
    "data.block.delete",
    "data.page.create",
    "data.page.update",
    "data.page.delete",
  ]) {
    assert.match(source, new RegExp(api.replaceAll(".", "\\.")));
  }
});

test("command guidance documents extension-scoped automatic cleanup", async () => {
  const source = await readSkill("commands-navigation");
  assert.match(source, /extensionAPI\.ui\.commandPalette\.addCommand/);
  assert.match(source, /automatically removes commands/);
  assert.match(source, /returns `null`, not a disposer/);
});
