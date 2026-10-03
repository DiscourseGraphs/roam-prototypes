import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import { startRunner } from "./roam/index";
import "./styles.css";

// The runner's code under src/core and src/roam is copied in from
// dg-demo-videos/proof by its roam/build.ts; this file, the README and the
// tests belong to the prototype.

const reportRoamJsLoadFailure = (error: unknown) => {
  console.error("Failed to load the Proof runner prototype from roam/js.", error);
  try {
    renderToast({
      id: "proof-runner-error",
      content: "Failed to load Proof runner. See the developer console for details.",
      intent: "danger",
    });
  } catch (toastError) {
    console.error("Could not display the Proof runner failure toast.", toastError);
  }
};

export default runExtension(async (args) => {
  try {
    if (process.env.NODE_ENV === "development") {
      renderToast({
        id: "proof-runner-loaded",
        content: "Loaded Proof runner",
        intent: "success",
        timeout: 800,
      });
    }
    // With URL loading the runner hands its extensionAPI on to the DG build
    // it loads; from roam/js there is none, and it uses a stand-in.
    const runner = await startRunner({ extensionAPI: args.extensionAPI });
    return { unload: () => runner.stop() };
  } catch (error) {
    if (args.extensionAPI) throw error;
    reportRoamJsLoadFailure(error);
    return {};
  }
});
