import { render as renderAlert } from "roamjs-components/components/SimpleAlert";
import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import "./styles.css";

const reportRoamJsLoadFailure = (error: unknown) => {
  console.error("Failed to load Loaded Dialog from roam/js.", error);
  try {
    renderToast({
      id: "loaded-dialog-error",
      content: "Failed to load Loaded Dialog. See the developer console for details.",
      intent: "danger",
    });
  } catch (toastError) {
    console.error("Could not display the Loaded Dialog failure toast.", toastError);
  }
};

export default runExtension(async (args) => {
  try {
    await renderAlert({
      content: "Loaded Dialog has loaded successfully.",
      confirmText: "Got it",
    });
  } catch (error) {
    if (args.extensionAPI) throw error;
    reportRoamJsLoadFailure(error);
  }
});
