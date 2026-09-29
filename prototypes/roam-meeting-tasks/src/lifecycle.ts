/* Load and unload. Everything the extension adds to the page is created here
 * and removed in unload(), so reloading the extension never leaves a
 * duplicate behind. */
import { GLOBAL_KEY, QUEUE_KEY, VERSION } from "~/config";
import { mount, mountedCount, release, unmountAll } from "~/mount";
import { forgetReads } from "~/roam";
import { SHIM_BLOCK } from "~/shim";
import { addStyles, removeStyles } from "~/styles";

type PublicApi = {
  version: string;
  mount: typeof mount;
  release: typeof release;
  /** The text to paste into the roam/render code block. */
  shim: string;
  debug: () => { version: string; mounted: number };
};

type Queued = { el: Element; args: unknown };

const globals = window as unknown as Record<string, unknown>;

export const load = (): void => {
  addStyles();
  const api: PublicApi = {
    version: VERSION,
    mount,
    release,
    shim: SHIM_BLOCK,
    debug: () => ({ version: VERSION, mounted: mountedCount() }),
  };
  globals[GLOBAL_KEY] = api;

  // Widgets Roam rendered before this load finished.
  const queued = (globals[QUEUE_KEY] as Queued[] | undefined) ?? [];
  delete globals[QUEUE_KEY];
  for (const { el, args } of queued) if (el.isConnected) mount(el, args);
};

export const unload = (): void => {
  unmountAll();
  forgetReads();
  removeStyles();
  delete globals[GLOBAL_KEY];
};
