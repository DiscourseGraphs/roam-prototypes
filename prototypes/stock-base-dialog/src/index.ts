import { render as renderAlert } from "roamjs-components/components/SimpleAlert";
import runExtension from "roamjs-components/util/runExtension";
import "./styles.css";

export default runExtension(async () => {
  let closeDialog: (() => void) | undefined;

  closeDialog = await renderAlert({
    content: "**Stock Base Dialog is working.**\n\nThe extension loaded successfully.",
    confirmText: "Close",
    onConfirm: () => {
      closeDialog = undefined;
    },
  });

  return {
    unload: () => {
      const close = closeDialog;
      closeDialog = undefined;
      close?.();
    },
  };
});
