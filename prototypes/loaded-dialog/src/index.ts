import { render as renderAlert } from "roamjs-components/components/SimpleAlert";
import { runExtension } from "roamjs-components/util";
import "./styles.css";

export default runExtension(async () => {
  await renderAlert({
    content: "Loaded Dialog has loaded successfully.",
    confirmText: "Got it",
  });
});
