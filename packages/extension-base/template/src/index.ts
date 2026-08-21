import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import "./styles.css";

const reportRoamJsLoadFailure = (error: unknown) => {
  console.error("Failed to load the __PROTOTYPE_TITLE__ prototype from roam/js.", error);
  try {
    renderToast({
      id: "__PROTOTYPE_NAME__-error",
      content: "Failed to load __PROTOTYPE_TITLE__. See the developer console for details.",
      intent: "danger",
    });
  } catch (toastError) {
    console.error("Could not display the __PROTOTYPE_TITLE__ failure toast.", toastError);
  }
};

export default runExtension(async (args) => {
  try {
    if (process.env.NODE_ENV === "development") {
      renderToast({
        id: "__PROTOTYPE_NAME__-loaded",
        content: __LOAD_MESSAGE_JSON__,
        intent: "success",
        timeout: 800,
      });
    }

    // Add prototype behavior here. Register every observer, listener, command,
    // timer, and mounted element for cleanup when the extension unloads.
    // args.extensionAPI is available with URL loading and undefined from roam/js.

    return {
      unload: () => {
        // Remove anything that is not returned through runExtension's registry.
      },
    };
  } catch (error) {
    if (args.extensionAPI) throw error;
    reportRoamJsLoadFailure(error);
    return {};
  }
});
