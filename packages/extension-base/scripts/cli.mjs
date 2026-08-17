#!/usr/bin/env node

import * as esbuild from "esbuild";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_GLOBALS = Object.freeze({
  "@blueprintjs/core": "window.Blueprint.Core",
  "@blueprintjs/datetime": "window.Blueprint.DateTime",
  "@blueprintjs/select": "window.Blueprint.Select",
  "chrono-node": "window.ChronoNode",
  "crypto-js": "window.CryptoJS",
  "cytoscape": "window.RoamLazy.Cytoscape",
  "file-saver": "window.FileSaver",
  "idb": "window.idb",
  "insect": "window.RoamLazy.Insect",
  "jszip": "window.RoamLazy.JSZip",
  "marked": "window.RoamLazy.Marked",
  "marked-react": "window.RoamLazy.MarkedReact",
  "nanoid": "window.Nanoid;module.exports.nanoid=window.Nanoid",
  "react":
    'window.React;module.exports.useSyncExternalStore=require("use-sync-external-store/shim").useSyncExternalStore',
  "react-dom": "window.ReactDOM",
  "react-dom/client": "window.ReactDOM",
  "react-youtube": "window.ReactYoutube",
  "tslib": "window.TSLib",
});

const escapeRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const importAsGlobals = (mapping) => ({
  name: "roam-host-globals",
  setup(build) {
    const filter = new RegExp(
      Object.keys(mapping)
        .map((moduleName) => `^${escapeRegExp(moduleName)}$`)
        .join("|"),
    );
    build.onResolve({ filter }, ({ path: moduleName }) => ({
      path: moduleName,
      namespace: "roam-host-global",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "roam-host-global" },
      ({ path: moduleName }) => ({
        contents: `module.exports = ${mapping[moduleName]};`,
        loader: "js",
        resolveDir: build.initialOptions.absWorkingDir,
      }),
    );
  },
});

const isFile = async (target) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const copyPublicDocuments = ({ root, outdir }) => ({
  name: "copy-public-documents",
  setup(build) {
    build.onEnd(async ({ errors }) => {
      if (errors.length) return;
      for (const name of ["README.md", "CHANGELOG.md"]) {
        const source = path.join(root, name);
        if (await isFile(source)) await copyFile(source, path.join(outdir, name));
      }
    });
  },
});

export const createDevelopmentNotifier = ({ outdir, log = console.log }) => ({
  name: "development-build-notifier",
  setup(build) {
    let hasBuilt = false;
    build.onEnd(({ errors }) => {
      if (errors.length) return;
      const output = path.relative(process.cwd(), outdir) || "dist";
      log(hasBuilt ? `Updated ${output}` : `Built ${output}; watching for changes`);
      hasBuilt = true;
    });
  },
});

const readManifest = async (root) => {
  const source = await readFile(path.join(root, "package.json"), "utf8");
  const manifest = JSON.parse(source);
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("Prototype package.json must have a name");
  }
  return manifest;
};

const createBuildOptions = async ({ root, production }) => {
  const manifest = await readManifest(root);
  const outdir = path.join(root, "dist");
  const mode = production ? "production" : "development";
  return {
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    outdir,
    entryNames: "extension",
    assetNames: "assets/[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    minify: production,
    sourcemap: production ? false : "inline",
    legalComments: "none",
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
      "process.env.PACKAGE_NAME": JSON.stringify(manifest.name),
      "process.env.ROAMJS_VERSION": JSON.stringify(manifest.version || "0.0.0"),
      "process.env.VERSION": JSON.stringify(manifest.version || "0.0.0"),
    },
    loader: {
      ".woff": "dataurl",
      ".woff2": "dataurl",
      ".yaml": "text",
    },
    plugins: [
      importAsGlobals(HOST_GLOBALS),
      copyPublicDocuments({ root, outdir }),
      ...(!production ? [createDevelopmentNotifier({ outdir })] : []),
    ],
  };
};

export const buildPrototype = async ({ root = process.cwd() } = {}) => {
  const resolvedRoot = path.resolve(root);
  const outdir = path.join(resolvedRoot, "dist");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await esbuild.build(await createBuildOptions({ root: resolvedRoot, production: true }));
  console.log(`Built ${path.relative(process.cwd(), outdir) || "dist"}`);
};

export const developPrototype = async ({ root = process.cwd() } = {}) => {
  const resolvedRoot = path.resolve(root);
  const outdir = path.join(resolvedRoot, "dist");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const context = await esbuild.context(
    await createBuildOptions({ root: resolvedRoot, production: false }),
  );
  await context.watch();

  await new Promise((resolve) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await context.dispose();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
};

const run = async () => {
  const [command] = process.argv.slice(2);
  if (command === "build") {
    await buildPrototype();
    return;
  }
  if (command === "dev") {
    await developPrototype();
    return;
  }
  throw new Error("Usage: roam-prototype <build|dev>");
};

const normalizePath = (value) => {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const pathsReferToSameFile = (left, right) => {
  if (!left || !right) return false;
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  try {
    return normalizePath(realpathSync.native(resolvedLeft)) ===
      normalizePath(realpathSync.native(resolvedRight));
  } catch {
    return normalizePath(resolvedLeft) === normalizePath(resolvedRight);
  }
};

const isCli = pathsReferToSameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isCli) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
