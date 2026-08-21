import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for the loader state");
};

const readInstrumentedLoader = async () => {
  const readme = await readFile(
    path.join(repoRoot, "packages", "extension-base", "template", "README.md"),
    "utf8",
  );
  const loader = /```javascript\r?\n([\s\S]*?)\r?\n```/.exec(readme)?.[1];
  assert.ok(loader, "template README should contain a roam/js loader");

  const dynamicImport =
    "const module = await import(`${baseUrl}/extension.js?v=${version}`);";
  const instrumentedLoader = loader.replace(
    dynamicImport,
    "const module = await window.__importPrototype(`${baseUrl}/extension.js?v=${version}`);",
  );
  assert.notEqual(instrumentedLoader, loader, "test should instrument the loader import");
  return instrumentedLoader;
};

test("serializes overlapping roam/js loader executions", async () => {
  const instrumentedLoader = await readInstrumentedLoader();

  const events = [];
  let importCount = 0;
  let releaseFirstLoad;
  const firstLoad = new Promise((resolve) => {
    releaseFirstLoad = resolve;
  });
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.window = {
    __importPrototype: async () => {
      const id = ++importCount;
      events.push(`import:${id}`);
      return {
        default: {
          id,
          onload: async () => {
            events.push(`onload:${id}`);
            if (id === 1) await firstLoad;
          },
          onunload: async () => {
            events.push(`onunload:${id}`);
          },
        },
      };
    },
  };
  globalThis.document = {
    createElement: () => ({ dataset: {}, remove: () => {} }),
    head: { appendChild: () => {} },
  };

  try {
    const runLoader = new Function(instrumentedLoader);
    runLoader();
    runLoader();

    await waitFor(() => events.includes("onload:1"));
    assert.deepEqual(events, ["import:1", "onload:1"]);

    releaseFirstLoad();
    await waitFor(
      () => window["__roamPrototype:__PROTOTYPE_NAME__"]?.extension?.id === 2,
    );

    assert.deepEqual(events, [
      "import:1",
      "onload:1",
      "import:2",
      "onunload:1",
      "onload:2",
    ]);
    assert.equal(window["__roamPrototype:__PROTOTYPE_NAME__:load"], undefined);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("cleans up an extension whose roam/js onload rejects", async () => {
  const instrumentedLoader = await readInstrumentedLoader();
  const events = [];
  const errors = [];
  let stylesheetRemoved = false;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalConsoleError = console.error;

  globalThis.window = {
    __importPrototype: async () => ({
      default: {
        onload: async () => {
          events.push("onload");
          throw new Error("load failed");
        },
        onunload: async () => {
          events.push("onunload");
        },
      },
    }),
  };
  globalThis.document = {
    createElement: () => ({
      dataset: {},
      remove: () => {
        stylesheetRemoved = true;
      },
    }),
    head: { appendChild: () => {} },
  };
  console.error = (...args) => errors.push(args);

  try {
    new Function(instrumentedLoader)();
    await waitFor(
      () =>
        events.includes("onunload") &&
        window["__roamPrototype:__PROTOTYPE_NAME__:load"] === undefined,
    );

    assert.deepEqual(events, ["onload", "onunload"]);
    assert.equal(stylesheetRemoved, true);
    assert.equal(window["__roamPrototype:__PROTOTYPE_NAME__"], undefined);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Could not load __PROTOTYPE_TITLE__/);
  } finally {
    console.error = originalConsoleError;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
