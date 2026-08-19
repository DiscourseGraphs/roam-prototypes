/* copy-for-latex — copy a discourse node as a LaTeX sentence with its citation.
 *
 * Spec: SPEC.md
 */
import addStyle from "roamjs-components/dom/addStyle";
import { runExtension } from "roamjs-components/util";
import { loadNodeTypes } from "~/graph";
import { startObserver } from "~/dom";
import { handleContextMenu, handleKeydown, handlePointer } from "~/contextMenu";
import { closeMenu } from "~/menu";
import { MENU_CSS } from "~/styles";

export default runExtension(async () => {
  /* Injected here rather than left to a published extension.css, which Roam
   * only injects on the URL-loading path. See src/styles.ts. */
  const style = addStyle(MENU_CSS);

  await loadNodeTypes();
  const observer = startObserver();

  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("mousedown", handlePointer, true);
  document.addEventListener("click", handlePointer, true);
  document.addEventListener("keydown", handleKeydown);

  return {
    unload: () => {
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("mousedown", handlePointer, true);
      document.removeEventListener("click", handlePointer, true);
      document.removeEventListener("keydown", handleKeydown);
      observer.disconnect();
      closeMenu();
      style.remove();
    },
  };
});
