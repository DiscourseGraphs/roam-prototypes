/* hover-key-figure — presentation-ready key-figure preview for discourse
 * nodes in the Roam outliner.
 *
 * Hover a discourse-node reference → a small "Figure" chip appears → click it
 * → the node's key figure in a pinned card → click the image → full-screen
 * lightbox. Esc unwinds. Nothing is added to the page at rest.
 *
 * Spec: SPEC.md
 */
import { runExtension } from "roamjs-components/util";
import {
  fetchManualKeyImage,
  fetchStrings,
  fetchTree,
  getNodeTypes,
  loadNodeTypes,
  uidForTitle,
} from "~/graph";
import { resolveKeyFigure, type KeyFigure, type KeyFigureIO } from "~/keyFigure";
import { initHover, type HoverController } from "~/hover";
import { isEligibleTitle } from "~/eligibility";
import { closeAll, getOpenCardTitle, openCard } from "~/card";
import { HKF_CSS, HKF_STYLE_ID } from "~/styles";

/* Deliberately not roamjs-components' addStyle, which is a default export.
 * This repository builds with esbuild in ESM format with Node-interop, so a
 * default import from CommonJS roamjs-components arrives as `{ default: fn }`
 * and calling it throws. Named imports are unaffected. */
const injectStyle = (css: string): HTMLStyleElement => {
  document.getElementById(HKF_STYLE_ID)?.remove();
  const el = document.createElement("style");
  el.id = HKF_STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
  return el;
};

/* Checked before anything else so a missing capability reports itself by
 * name instead of as a TypeError deep in a helper. */
const missingCapability = (): string => {
  const api = window.roamAlphaAPI as unknown as Record<string, unknown> | undefined;
  if (!api) return "window.roamAlphaAPI is not available";
  const data = api.data as { async?: { q?: unknown; pull?: unknown } } | undefined;
  if (typeof data?.async?.q !== "function")
    return "window.roamAlphaAPI.data.async.q is not available in this Roam build";
  if (typeof data?.async?.pull !== "function")
    return "window.roamAlphaAPI.data.async.pull is not available in this Roam build";
  return "";
};

/* runExtension's own failure path cannot be relied on: in production it
 * posts to SamePage without logging, and its reporter reads
 * `extensionAPI.settings` — undefined on the roam/js `import()` preview path
 * — so it throws over the real error. Catch here, where the message exists. */
const reportLoadFailure = (error: unknown): void => {
  // Console first, and unconditionally — anything fancier (a toast needs
  // Blueprint plus a lazily-loaded Roam global) can itself throw and eat
  // the message.
  console.error("hover-key-figure failed to load:", error);
};

const SETTING_DELAY = "hover-delay-ms";
const SETTING_EXTRA_REGEX = "extra-title-regex";
const DEFAULT_DELAY_MS = 150;
const CACHE_TTL_MS = 5 * 60 * 1000;

type Settings = {
  get: (key: string) => unknown;
} | null;

export default runExtension(async (args) => {
  try {
    const problem = missingCapability();
    if (problem) throw new Error(problem);

    /* `extensionAPI` is undefined when the bundle is loaded via a roam/js
     * block (the documented preview path), so every settings read is
     * guarded and every default lives here, not in the panel. */
    const settings: Settings = args?.extensionAPI?.settings ?? null;
    const settingNumber = (key: string, fallback: number): number => {
      const raw = settings?.get(key);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const settingString = (key: string): string => {
      const raw = settings?.get(key);
      return typeof raw === "string" ? raw.trim() : "";
    };

    try {
      args?.extensionAPI?.settings?.panel?.create({
        tabTitle: "Hover Key Figure",
        settings: [
          {
            id: SETTING_DELAY,
            name: "Hover delay (ms)",
            description:
              "How long the pointer rests on a node reference before the Figure chip appears.",
            action: { type: "input", placeholder: String(DEFAULT_DELAY_MS) },
          },
          {
            id: SETTING_EXTRA_REGEX,
            name: "Extra title pattern",
            description:
              "Optional regular expression; page titles matching it also get the chip (e.g. ^@ for source pages).",
            action: { type: "input", placeholder: "^@" },
          },
        ],
      });
    } catch (e) {
      console.warn("hover-key-figure: settings panel unavailable:", e);
    }

    injectStyle(HKF_CSS);

    /* Node-type formats from the graph's own discourse-graph/nodes/* config
     * pages — the same matcher the plugin uses, not a hardcoded list. */
    await loadNodeTypes().catch((e) => {
      console.warn("hover-key-figure: could not load node types:", e);
      return [];
    });

    let extraRegexSource = "__unset__";
    let extraRegex: RegExp | null = null;
    const getExtraRegex = (): RegExp | null => {
      const source = settingString(SETTING_EXTRA_REGEX);
      if (source !== extraRegexSource) {
        extraRegexSource = source;
        try {
          extraRegex = source ? new RegExp(source) : null;
        } catch {
          console.warn("hover-key-figure: invalid extra title pattern:", source);
          extraRegex = null;
        }
      }
      return extraRegex;
    };

    const titleEligible = (title: string): boolean =>
      isEligibleTitle(title, getNodeTypes(), getExtraRegex());

    const io: KeyFigureIO = { fetchTree, fetchStrings, fetchManualKeyImage };

    /* One resolution per page per TTL; shared by prefetch-on-hover and the
     * card, so the click is answered from the hover's work. */
    const cache = new Map<string, { at: number; promise: Promise<KeyFigure | null> }>();
    const resolveForTitle = (title: string): Promise<KeyFigure | null> => {
      const hit = cache.get(title);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
      const promise = (async () => {
        const uid = await uidForTitle(title);
        if (!uid) return null;
        return resolveKeyFigure(uid, io);
      })().catch((e) => {
        cache.delete(title); // a failed read should not be cached for 5 min
        throw e;
      });
      cache.set(title, { at: Date.now(), promise });
      return promise;
    };

    let hover: HoverController | null = null;
    hover = initHover({
      isEligibleTitle: titleEligible,
      hoverDelayMs: () => settingNumber(SETTING_DELAY, DEFAULT_DELAY_MS),
      prefetch: resolveForTitle,
      onOpen: ({ title, anchor }) => {
        if (getOpenCardTitle() === title) {
          closeAll();
          return;
        }
        openCard({ title, anchor, load: () => resolveForTitle(title) });
      },
    });

    console.log("hover-key-figure: loaded.");

    return {
      unload: () => {
        hover?.destroy();
        closeAll();
        document.getElementById(HKF_STYLE_ID)?.remove();
        cache.clear();
      },
    };
  } catch (error) {
    reportLoadFailure(error);
    return { unload: () => undefined };
  }
});
