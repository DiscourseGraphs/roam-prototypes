import { render as renderToast } from "roamjs-components/components/Toast";
import { runExtension } from "roamjs-components/util";
import "./styles.css";

export default runExtension(async () => {
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

  return {
    unload: () => {
      // Remove anything that is not returned through runExtension's registry.
    },
  };
});
