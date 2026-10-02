// Written by roam/build.ts from proof/recipes and proof/baselines. Don't edit by hand.
import recipeDialogs from "../recipes/dialogs.json";
import recipeOverlay from "../recipes/overlay.json";
import recipePages from "../recipes/pages.json";
import recipeSearch from "../recipes/search.json";
import recipeSettings from "../recipes/settings.json";
import recipeSharing from "../recipes/sharing.json";
import baselineDgBaseline1 from "../baselines/dg-baseline@1.json";

export const recipeFiles: Record<string, unknown> = {
  "dialogs.json": recipeDialogs,
  "overlay.json": recipeOverlay,
  "pages.json": recipePages,
  "search.json": recipeSearch,
  "settings.json": recipeSettings,
  "sharing.json": recipeSharing,
};

// By ref, e.g. dg-baseline@1.
export const baselineFiles: Record<string, unknown> = {
  "dg-baseline@1": baselineDgBaseline1,
};
