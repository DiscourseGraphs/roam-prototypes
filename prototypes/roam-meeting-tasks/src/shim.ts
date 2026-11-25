/* The code that lives in the graph's roam/render code block.
 *
 * Every widget is placed with `{{roam/render: ((uid))}}`, where `uid` is one
 * javascript code block. That block used to hold the whole component. Now it
 * holds only this shim, which renders an empty host element and hands it to
 * the extension. So invocations, templates, and the block uid all stay as
 * they are; only the code block's content changes.
 *
 * The extension may finish loading after Roam has already rendered a widget
 * (a roam/js loader imports it asynchronously). In that case the shim parks
 * its host element in a queue, which the extension drains when it loads.
 * Until then, and for anyone who does not have the extension, a one-line
 * note is shown; the extension's stylesheet hides it.
 *
 * Constraints on this text, all learned the hard way:
 *   - Roam finds the component by its function name on `window`, so the name
 *     must be unique across every roam/render block in the graph. It stays
 *     `dgMeetingTasks`, the name the deployed component already uses.
 *   - No hooks: Roam calls this function in a way that makes hooks throw.
 *   - ES5 only, no imports: Roam evaluates the block as a plain script.
 */
import { FALLBACK_CLASS, GLOBAL_KEY, HOST_CLASS, QUEUE_KEY } from "~/config";

export const SHIM_FUNCTION = "dgMeetingTasks";

export const SHIM_SOURCE = `function ${SHIM_FUNCTION}(props) {
  // Drawn by the roam-meeting-tasks extension:
  // https://github.com/DiscourseGraphs/roam-prototypes/tree/main/prototypes/roam-meeting-tasks
  // This block only gives it a place to draw. Keep the function name.
  var React = window.React;
  var argv = (props && props.args) || (typeof args !== "undefined" ? args : []) || [];
  var host = null;
  function attach(el) {
    var ext = window.${GLOBAL_KEY};
    if (el) {
      host = el;
      if (ext) ext.mount(el, argv);
      else (window.${QUEUE_KEY} = window.${QUEUE_KEY} || []).push({ el: el, args: argv });
    } else if (host) {
      if (ext) ext.release(host);
      host = null;
    }
  }
  return React.createElement(
    "div",
    null,
    React.createElement("div", { className: "${HOST_CLASS}", ref: attach }),
    React.createElement(
      "div",
      { className: "${FALLBACK_CLASS}", style: { fontSize: "12px", opacity: 0.5 } },
      "Meeting tasks: waiting for the roam-meeting-tasks extension."
    )
  );
}`;

/* The exact string to paste into the roam/render code block. */
export const SHIM_BLOCK = "```javascript\n" + SHIM_SOURCE + "\n```";
