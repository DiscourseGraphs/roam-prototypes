import { isProofDatabase } from "../core/database";
import { HELPERS_INIT_SCRIPT } from "../core/helpers";
import { validateBaseline, validateKit, type Baseline, type Kit } from "../core/kit";
import { parseRecipes, type RecipeBook } from "../core/recipes";
import type { TemplateContext } from "../core/template";
import {
  PaletteRegistry,
  dgRunning,
  fetchBuild,
  loadBuild,
  localServer,
  pointBuild,
  prHead,
  stopLocalServer,
  type ExtensionAPI,
  type FetchedBuild,
} from "./build-loader";
import { registerAgentTools, type AgentHost } from "./agent-tools";
import { baselineFiles, recipeFiles } from "./data";
import { CONNECT_LINK, RUNNER_URL, agentLink, agentPrompt } from "./links";
import { evaluate } from "./executor";
import { ABOUT_START, aboutText, isProofRoot, kitBlocks, pageKit, rootConfig } from "./page-kit";
import {
  blockUidOf,
  createTree,
  ensurePage,
  graphName,
  openUid,
  pageUid,
  proofRootFor,
  readTree,
  roam,
} from "./roam";
import {
  CONNECTING_FLAGS,
  HANDLER_SETUP_COMMAND,
  ProofRun,
  applyBeforeLoad,
  contextFor,
  fixturesFor,
  helperState,
  kitNeedsDatabase,
  PRODUCTION_REFUSAL,
  planBeforeLoad,
  retryPlan,
  wouldConnect,
  type RunnerEnv,
  type SetupPlan,
} from "./runner";

// The proof runner inside Roam, loaded as a developer extension (Roam passes
// extensionAPI) or from roam/js (it doesn't). On a page with a {{proof}}
// block it loads the build the block names, after the kit's before-load
// fixtures, asking first when those would change the graph. Every {{proof}}
// block shows a run panel, and the open page's kit opens in the right
// sidebar, pinned, to drive the page from. Elsewhere it waits.

type ProofWindow = Window & {
  proof?: Record<string, unknown> & { sidebar?: Record<string, unknown> };
  // Which database the loaded build talks to, for proof.supabase.
  __proofBackend?: { ref: string };
  proofRunner?: unknown;
  roamAlphaAPI?: unknown;
};

const win = window as unknown as ProofWindow;
const SECRETS_KEY = "proof:secrets";
const TIMEOUT_MS = 15_000;
const VERSION = process.env.VERSION ?? "dev";

// The setup note: the first block on a kit page, for a visitor without the
// runner (nothing else on the page can speak to them). With the runner on,
// it hides, and the panel's checklist starts with the runner instead.
export const RUNNER_HINT = `To run this kit, turn on the proof runner once for this graph: Settings > Roam Depot > Developer extensions (turn on developer mode) > Load from URL, paste ${RUNNER_URL} and reload this page. This line hides itself once the runner is on.`;
// The note's openings, today's and earlier ones, so older pages are found.
const HINT_STARTS = ["To run this kit", "First time here?"];
const HINTS_STYLE_ID = "proof-runner-hints";

// Roam's Settings names a developer extension loaded from a URL by that URL,
// in a tab list that never wraps, so the runner's entry took half the dialog.
// Cap the list and end long names with an ellipsis.
const SETTINGS_STYLE_ID = "proof-runner-settings";
const SETTINGS_CSS = `.rm-settings-tabs > .bp3-tab-list { max-width: 260px; }
.rm-settings-tabs > .bp3-tab-list .bp3-tab { overflow: hidden; text-overflow: ellipsis; }`;
// How long Connect waits for this machine's helper: the proof database
// takes about 20 s to start, longer when it migrates.
const CONNECT_TIMEOUT_MS = 120_000;
const NO_ANSWER_HINT_MS = 8_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const readSecrets = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SECRETS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};

const loadRecipeBook = (): RecipeBook => {
  const book: RecipeBook = new Map();
  for (const name of Object.keys(recipeFiles).sort()) parseRecipes(recipeFiles[name], name, book);
  return book;
};

const loadBaselines = (): Map<string, Baseline> =>
  new Map(Object.entries(baselineFiles).map(([ref, raw]) => [ref, validateBaseline(raw)]));

const waitForRoam = async (): Promise<void> => {
  for (;;) {
    const api = win.roamAlphaAPI as { data?: unknown; ui?: unknown } | undefined;
    if (api?.data && api.ui && document.querySelector(".roam-app, .roam-body")) return;
    await sleep(200);
  }
};

// What roamjs-components' createButtonObserver does: a {{proof}} renders as
// a bp3-button reading "proof"; mark each one once and hand it over. Written
// out because importing it means its dom barrel, which bundles about 850 KB
// of syntax highlighting the runner never uses.
const PROOF_BUTTON = "button.bp3-button:not([data-roamjs-proof])";

const observeProofButtons = (render: (button: HTMLButtonElement) => void): MutationObserver => {
  const visit = (root: Element | Document): void => {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>(PROOF_BUTTON));
    if (root instanceof HTMLButtonElement && root.matches(PROOF_BUTTON)) found.push(root);
    for (const button of found) {
      if (button.textContent?.trim().toUpperCase() !== "PROOF") continue;
      button.setAttribute("data-roamjs-proof", "true");
      render(button);
    }
  };
  visit(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) visit(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
};

const PALETTE = {
  toggle: "Proof runner: pause or resume the run",
  next: "Proof runner: run the next step",
};

class ProofRunner {
  readonly runs = new Map<string, ProofRun>();
  readonly env: RunnerEnv;
  private readonly opened = new Set<string>();
  private readonly hints = new Set<string>();
  private connecting = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private observer: MutationObserver | null = null;
  private loading: Promise<void> | null = null;
  private readonly onHashChange = (): void => {
    void this.loadIfNone().then(async () => this.tidyPage(await openUid()));
  };
  // The proof database's keys from the local server, for kits' {{env.X}};
  // held in this tab only.
  private localKeys: Record<string, string> = {};

  constructor(private readonly extensionAPI?: ExtensionAPI) {
    this.env = {
      graph: graphName(),
      extensionAPI,
      build: null,
      buildError: null,
      buildFor: null,
      beforeLoad: [],
      setup: null,
      confirmSetup: () => this.confirmSetup(),
      palette: new PaletteRegistry(),
      recipes: loadRecipeBook(),
      baselines: loadBaselines(),
      timeout: TIMEOUT_MS,
      secrets: () => ({ ...readSecrets(), ...this.localKeys }),
      loadTrace: [],
      loading: false,
      database: null,
      version: VERSION,
      helper: null,
      connect: () => this.connect(),
      disconnect: () => this.disconnect(),
      checkDatabase: () => this.checkDatabase(),
      askAgent: (rootUid) => this.askAgent(rootUid),
      agentSeenAt: 0,
    };
  }

  runFor(rootUid: string): ProofRun {
    let run = this.runs.get(rootUid);
    if (!run) {
      run = new ProofRun(rootUid, this.env);
      this.runs.set(rootUid, run);
    }
    return run;
  }

  async isProofRoot(uid: string | undefined): Promise<boolean> {
    if (!uid) return false;
    if (this.runs.has(uid)) return true;
    const tree = await readTree(uid);
    return Boolean(tree && isProofRoot(tree.string));
  }

  refreshAll(): void {
    for (const run of this.runs.values()) run.paint();
  }

  private trace(line: string): void {
    this.env.loadTrace.push(line);
  }

  // Loads the open page's build if this tab has none yet: at startup, and
  // when someone navigates to a kit page later. Swapping one loaded build
  // for another needs a reload; the panel offers it.
  async loadIfNone(): Promise<void> {
    if (this.env.build || this.env.setup || this.loading || dgRunning()) return;
    this.env.buildError = null;
    this.env.loading = true;
    this.refreshAll();
    this.loading = this.loadForOpenPage().finally(() => {
      this.loading = null;
      this.env.loading = false;
      this.refreshAll();
    });
    await this.loading;
  }

  // Finds the open page's kit and its build. When its before-load fixtures
  // would change the graph (flags, node types), it stops there and the panel
  // asks; otherwise the build loads now.
  private async loadForOpenPage(): Promise<void> {
    const uid = await openUid();
    this.trace(`open uid: ${uid ?? "none"} (hash ${location.hash})`);
    if (!uid) return;
    // The linked page's blocks can arrive a moment after the runner starts.
    let root = await proofRootFor(uid);
    for (let attempt = 0; !root && attempt < 20; attempt += 1) {
      await sleep(250);
      root = await proofRootFor(uid);
    }
    if (!root?.uid) {
      this.trace("no {{proof}} block on the open page, so no build to load");
      return;
    }
    const config = rootConfig(root);
    this.trace(`kit block ${root.uid}: build ${config.build ?? "none"}, pr ${config.pr ?? "none"}`);
    if (!config.build && !config.pr) return;
    this.env.buildFor = root.uid;
    if (dgRunning()) {
      this.trace("DG is already running");
      this.env.buildError =
        "Discourse Graph is already running in this tab (installed from Roam Depot, or loaded in developer mode), so the page's build wasn't loaded. Turn that copy off for this graph to test builds here.";
      return;
    }
    let branch = config.build;
    let head: string | null = null;
    if (config.pr) {
      const pr = await prHead(config.pr);
      if (pr) {
        head = pr.sha;
        branch = branch ?? pr.branch;
      } else if (!branch) {
        this.env.buildError = `Couldn't look up PR #${config.pr} on GitHub, and the page has no build:: to fall back on.`;
        return;
      }
    }
    let kit: Kit | null = null;
    try {
      kit = pageKit(root).kit;
    } catch (error) {
      this.trace(`the kit didn't parse, so no fixtures run: ${describe(error)}`);
    }
    const fixtures = kit ? fixturesFor(kit, this.env) : [];
    const needsDatabase = kit ? kitNeedsDatabase(kit, fixtures) : false;
    const flags = win.proof as unknown as { flags: { get(name: string): boolean } };
    const flagsOn = CONNECTING_FLAGS.filter((name) => flags.flags.get(name));
    // Whether the kit would put the graph on a database decides the build:
    // CI's builds talk to production, so a kit that would connect runs on
    // the PR's CI build pointed at the proof database, whose keys this
    // machine's helper hands over. Without the helper nothing loads; the
    // checklist offers to connect it.
    const needsProof = wouldConnect({
      needsDatabase,
      flagsOn,
      apply: kit ? (await planBeforeLoad(fixtures, contextFor(kit.name, this.env, "load"), "127")).apply : [],
    });
    let fetched: FetchedBuild;
    try {
      if (needsProof) {
        const server = await localServer();
        this.env.helper = helperState(server);
        if (!server?.database) {
          this.trace(`waiting for this machine: ${this.env.helper.detail}`);
          return;
        }
        this.localKeys = { ...(server.env ?? {}) };
        this.trace(`fetching ${branch} to point it at the proof database`);
        fetched = pointBuild(await fetchBuild(branch as string), server.database.publishableKey);
      } else {
        this.env.helper = null;
        this.trace(`fetching ${branch}`);
        fetched = await fetchBuild(branch as string);
      }
    } catch (error) {
      this.env.buildError = describe(error);
      return;
    }
    win.__proofBackend = { ref: fetched.backend ?? "127" };
    this.trace(`build ${fetched.commit?.slice(0, 7) ?? "?"} talks to database ${fetched.database ?? "none"}`);
    const context = contextFor(kit?.name ?? "kit", this.env, "load");
    const found = kit
      ? await planBeforeLoad(fixtures, context, fetched.backend)
      : { apply: [], skip: [], kept: [], byBuild: [] };
    const plan: SetupPlan = {
      rootUid: root.uid,
      kit: kit?.name ?? "kit",
      branch: branch as string,
      pr: config.pr,
      head,
      ...found,
      needsDatabase,
      fetched,
    };
    // Whatever was decided above, a build that isn't on the proof database
    // never starts for a kit that would connect.
    if (!isProofDatabase(fetched.database) && wouldConnect({ needsDatabase, flagsOn, apply: plan.apply })) {
      this.env.buildError = PRODUCTION_REFUSAL;
      this.trace(`refused: ${fetched.database ?? "no database"} is not the proof database`);
      return;
    }
    if (plan.apply.length) {
      this.env.setup = plan;
      this.trace(`waiting for Set up and load: ${plan.apply.map((fixture) => fixture.id).join(", ")}`);
      return;
    }
    await this.finishLoad(plan, context);
  }

  private async finishLoad(plan: SetupPlan, context: TemplateContext): Promise<void> {
    this.env.beforeLoad = await applyBeforeLoad(plan, context);
    this.trace(`before-load fixtures: ${this.env.beforeLoad.map((item) => `${item.id} ${item.outcome}`).join(", ") || "none"}`);
    const retry = retryPlan(plan, this.env.beforeLoad);
    if (retry) {
      const failed = this.env.beforeLoad.filter((item) => item.outcome === "failed");
      this.env.setup = retry;
      this.env.buildError = `Setup didn't take, so the build wasn't loaded: ${failed.map((item) => `${item.id} (${item.detail})`).join("; ")}. Fix it, then press Set up and load again.`;
      this.trace(`stopped: ${failed.map((item) => item.id).join(", ")} failed`);
      return;
    }
    const { branch, head } = plan;
    try {
      this.trace(`loading ${branch}`);
      if (!plan.fetched) throw new Error("The build wasn't fetched before setup; reload the page.");
      this.env.build = await loadBuild({
        fetched: plan.fetched,
        pr: plan.pr,
        graph: this.env.graph,
        palette: this.env.palette,
        head,
        extensionAPI: this.extensionAPI,
      });
      this.trace(`loaded ${branch} @ ${this.env.build.commit?.slice(0, 7) ?? "?"} with ${this.extensionAPI ? "the runner's extensionAPI" : "a stand-in extensionAPI"}`);
    } catch (error) {
      this.env.buildError = describe(error);
      return;
    }
    if (plan.needsDatabase) await this.checkDatabase();
  }

  // Waits for DG's session on the proof database: the kit's database-session
  // fixture signs in before load, and DG picks the session up when sync or
  // node sharing is on. Kits that need the database stay un-runnable until
  // the proof database accepts that session.
  async checkDatabase(timeoutMs = 45_000): Promise<void> {
    const proof = win.proof as unknown as {
      supabase: {
        hasSession(): boolean;
        signedIn(): Promise<boolean>;
        session(): { user?: { email?: string } } | null;
        backend(): string;
      };
      flags: { get(name: string): boolean };
    };
    const ref = this.env.build?.database ?? proof.supabase.backend();
    this.env.database = { state: "checking", detail: `${ref} for ${this.env.graph}` };
    this.refreshAll();
    // DG reports a failed sign-in on the console; keep what it says.
    const heard: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" ");
      if (/space|auth|database|supabase/i.test(text)) heard.push(text.slice(0, 300));
      original.apply(console, args);
    };
    try {
      const deadline = Date.now() + timeoutMs;
      while (!proof.supabase.hasSession() && Date.now() < deadline) await sleep(500);
    } finally {
      console.error = original;
    }
    const accepted = proof.supabase.hasSession() && (await proof.supabase.signedIn());
    if (accepted) {
      const email = proof.supabase.session()?.user?.email ?? "the space account";
      this.env.database = { state: "ok", detail: `signed in to ${ref} as ${email}` };
    } else {
      const syncing = proof.flags.get("Suggestive mode overlay enabled") || proof.flags.get("Enable node sharing");
      this.env.database = {
        state: "missing",
        detail: proof.supabase.hasSession()
          ? `The graph's session isn't one ${ref} knows (it's from another stack, or from before a reset). Reload: the kit's database-session fixture signs in again.`
          : !syncing
          ? "DG only signs in to its database when sync or node sharing is on, and both are off in this graph."
          : heard.length
            ? `DG tried and failed: ${heard[0]}`
            : `DG didn't sign in to ${ref} within ${timeoutMs / 1000}s. Reload to try again.`,
      };
    }
    this.trace(`database: ${this.env.database.state} (${this.env.database.detail})`);
    this.refreshAll();
  }

  // The panel's Set up and load: apply the fixtures it listed, then load.
  private async confirmSetup(): Promise<void> {
    const setup = this.env.setup;
    if (!setup) return;
    this.env.setup = null;
    this.env.buildError = null;
    this.env.loading = true;
    this.refreshAll();
    try {
      await this.finishLoad(setup, contextFor(setup.kit, this.env, "load"));
    } finally {
      this.env.loading = false;
      this.refreshAll();
    }
  }

  // The checklist's Connect: opens the dg-proof:// link, which starts this
  // machine's helper (the proof database, the embeddings stub and the keys
  // server), waits for it to answer, then carries on loading the kit.
  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    this.env.helper = { state: "connecting", detail: "Starting the proof database and the embeddings stub on this machine, usually about 20 s…" };
    this.env.buildError = null;
    this.refreshAll();
    openLink(CONNECT_LINK);
    try {
      const started = Date.now();
      const deadline = started + CONNECT_TIMEOUT_MS;
      let server = await localServer();
      while ((!server || server.starting) && Date.now() < deadline) {
        await sleep(1500);
        server = await localServer();
        if (!server && Date.now() - started > NO_ANSWER_HINT_MS) {
          this.env.helper = {
            state: "connecting",
            detail: `Nothing on this machine has answered yet (${Math.round((Date.now() - started) / 1000)} s). If your browser asked to open a dg-proof link, allow it. If this machine isn't set up, ${HANDLER_SETUP_COMMAND}`,
          };
          this.refreshAll();
        }
      }
      this.env.helper = server
        ? helperState(server)
        : { state: "unanswered", detail: "Nothing answered after the dg-proof:// link opened." };
    } finally {
      this.connecting = false;
      this.refreshAll();
    }
    if (this.env.helper?.state === "ok") await this.loadIfNone();
  }

  // The checklist's Stop: the helper stops what it started.
  private async disconnect(): Promise<void> {
    await stopLocalServer();
    this.localKeys = {};
    this.env.helper = { state: "missing", detail: "Stopped. This kit needs the proof database, which runs on this machine." };
    this.refreshAll();
  }

  // The checklist's Ask your agent: the dg-proof:// link opens the person's
  // agent on this kit, and the prompt goes on the clipboard for an agent
  // that's already open.
  private async askAgent(rootUid: string): Promise<string | null> {
    openLink(agentLink(this.env.graph, rootUid));
    try {
      await navigator.clipboard.writeText(agentPrompt(this.env.graph, rootUid));
    } catch {
      // The link still opens the agent.
    }
    return null;
  }

  // With the runner on, a kit page's setup note moves to the top for the
  // next visitor without it, and hides here.
  private async tidyHint(pageUid: string | null): Promise<void> {
    if (!pageUid || !(await proofRootFor(pageUid))) return;
    const uid = await placeRunnerHint(pageUid, { create: false }).catch(() => null);
    if (!uid) return;
    this.hints.add(uid);
    let style = document.getElementById(HINTS_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = HINTS_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = [...this.hints]
      .map((hint) => `.roam-block-container:has(> .rm-block-main .rm-block__input[id$="-${hint}"]) { display: none; }`)
      .join("\n");
  }

  // Swaps each rendered {{proof}} button for a run panel. A {{proof}} written
  // inside other text renders a button too; only a block that starts with it
  // is a kit.
  observe(): void {
    this.observer = observeProofButtons((button) => {
      void this.mount(button);
    });
  }

  private async mount(button: HTMLButtonElement): Promise<void> {
    const uid = blockUidOf(button);
    if (!uid) return;
    const tree = await readTree(uid);
    if (!tree || !isProofRoot(tree.string) || !button.isConnected) return;
    const host = document.createElement("div");
    host.className = "proof-panel-host";
    button.style.display = "none";
    button.after(host);
    const run = this.runFor(uid);
    run.panel.attach(host);
    await run.refresh();
  }

  // On a kit page: tidy its setup note, and take out kit windows an earlier
  // runner pinned in the right sidebar. A run's controls now float in the bar
  // whenever the page's own panel is out of view, and a block opened in the
  // sidebar also opened it on the page.
  async tidyPage(uid: string | null): Promise<void> {
    void this.tidyHint(uid);
    const root = uid ? await proofRootFor(uid) : null;
    if (!root?.uid || this.opened.has(root.uid)) return;
    this.opened.add(root.uid);
    const sidebar = roam().ui.rightSidebar;
    // Roam restores pinned windows a moment after startup, so look again a
    // few times.
    const tidy = async (): Promise<void> => {
      for (const item of sidebar.getWindows()) {
        const other = item["block-uid"];
        if (item.type !== "block" || !other || !(await this.isProofRoot(other))) continue;
        try {
          await sidebar.removeWindow({ window: { type: "block", "block-uid": other } });
        } catch {
          // Already gone.
        }
      }
    };
    await tidy();
    for (const delay of [1500, 4000, 8000]) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void tidy();
      }, delay);
      this.timers.add(timer);
    }
  }

  active(): ProofRun | null {
    return [...this.runs.values()].find((run) => run.running) ?? null;
  }

  // Pause and Next from the command palette, where a person can bind keys,
  // for when a dialog the kit opened covers the panel.
  async registerCommands(): Promise<void> {
    const palette = this.extensionAPI?.ui.commandPalette ?? roam().ui.commandPalette;
    await palette.addCommand({
      label: PALETTE.toggle,
      callback: () => {
        const run = this.active();
        if (run) run.command(run.view().machine?.paused ? "resume" : "pause");
      },
    });
    await palette.addCommand({
      label: PALETTE.next,
      callback: () => {
        this.active()?.command("next");
      },
    });
  }

  listen(): void {
    window.addEventListener("hashchange", this.onHashChange);
  }

  // What the runner's agent tools act through: a kit's run by its page
  // (title or uid, else the open page), and the agent's presence.
  agentHost(): AgentHost {
    return {
      runFor: async (page?: string) => {
        const uid = !page ? undefined : /^[\w-]{9}$/.test(page) ? page : await pageUid(page);
        if (page && !uid) throw new Error(`No page titled "${page}".`);
        const run = this.runFor(await this.rootFor(uid ?? undefined));
        if (!run.pageKit) await run.refresh();
        return run;
      },
      seen: () => {
        this.env.agentSeenAt = Date.now();
        this.refreshAll();
      },
    };
  }

  async rootFor(uid?: string): Promise<string> {
    const target = uid ?? (await openUid());
    const root = target ? await proofRootFor(target) : null;
    if (!root?.uid) throw new Error("No {{proof}} block on that page.");
    return root.uid;
  }

  // Everything the runner added, taken away again: Roam calls this when the
  // extension unloads or reloads.
  async stop(installedHelpers: boolean): Promise<void> {
    for (const run of this.runs.values()) {
      run.stop();
      run.panel.dispose();
    }
    this.observer?.disconnect();
    window.removeEventListener("hashchange", this.onHashChange);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const host of Array.from(document.querySelectorAll(".proof-panel-host"))) host.remove();
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-roamjs-proof]"))) {
      button.style.display = "";
      button.removeAttribute("data-roamjs-proof");
    }
    document.getElementById("proof-run-marks")?.remove();
    document.getElementById(HINTS_STYLE_ID)?.remove();
    document.getElementById(SETTINGS_STYLE_ID)?.remove();
    if (!this.extensionAPI) {
      for (const label of Object.values(PALETTE)) await roam().ui.commandPalette.removeCommand({ label });
    }
    try {
      await this.env.build?.unload();
    } catch (error) {
      console.error("[proof] the build didn't unload cleanly:", error);
    }
    if (installedHelpers) delete win.proof;
    delete win.proofRunner;
  }

  // The automation surface: what a Playwright session or a person at the
  // console can call.
  api() {
    return Object.freeze({
      version: VERSION,
      mode: this.extensionAPI ? "extension" : "roam/js",
      build: () => ({
        loaded: this.env.build ? { ...this.env.build, unload: undefined } : null,
        error: this.env.buildError,
        beforeLoad: this.env.beforeLoad,
        setup: this.env.setup ? { apply: this.env.setup.apply.map((fixture) => fixture.id), skip: this.env.setup.skip.map(({ fixture }) => fixture.id) } : null,
        database: this.env.database,
        trace: this.env.loadTrace,
      }),
      setUpAndLoad: () => this.confirmSetup(),
      checkDatabase: () => this.checkDatabase(),
      palette: () => this.env.palette.labels(),
      status: async (uid?: string) => this.runFor(await this.rootFor(uid)).status(),
      run: async (uid?: string, from = 0) => this.runFor(await this.rootFor(uid)).start(from > 0 ? { from } : {}),
      command: async (cmd: string, args: Record<string, unknown> = {}, uid?: string) =>
        this.runFor(await this.rootFor(uid)).command(cmd, args),
      kitFromPage: async (uid: string) => {
        const root = await proofRootFor(uid);
        if (!root) throw new Error("No {{proof}} block there.");
        return pageKit(root);
      },
      // Writes a kit to a page (proof/<name> unless a title is given) as a
      // {{proof}} block. replace swaps out a {{proof}} block already there.
      writeKit: async (raw: unknown, options: { title?: string; build?: string | null; replace?: boolean } = {}) => {
        const kit: Kit = validateKit(raw);
        const title = options.title ?? `proof/${kit.name}`;
        const uid = await ensurePage(title);
        const existing = await proofRootFor(uid);
        if (existing?.uid) {
          if (!options.replace) throw new Error(`${title} already has a {{proof}} block; pass replace: true to swap it.`);
          await roam().data.block.delete({ block: { uid: existing.uid } });
        }
        const root = { ...kitBlocks(kit, { build: options.build ?? null }), uid: roam().util.generateUID() };
        await createTree(uid, [root], 0);
        await placeRunnerHint(uid, { create: true });
        await placeAbout(uid, aboutText(kit));
        return { pageUid: uid, rootUid: root.uid, title };
      },
      placeRunnerHint: (pageUid: string) => placeRunnerHint(pageUid, { create: true }),
      setSecret: (name: string, value: string) => {
        const secrets = readSecrets();
        secrets[name] = value;
        localStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
      },
      clearSecrets: () => localStorage.removeItem(SECRETS_KEY),
      evaluate,
      pageUid,
    });
  }
}

// Puts the setup note first on a kit page, in today's words, creating it
// when asked; returns its uid.
const placeRunnerHint = async (pageUid: string, { create }: { create: boolean }): Promise<string | null> => {
  const children = (await readTree(pageUid))?.children ?? [];
  const index = children.findIndex((child) => HINT_STARTS.some((start) => child.string.startsWith(start)));
  const hint = children[index];
  if (!hint?.uid) {
    if (!create) return null;
    const uid = roam().util.generateUID();
    await roam().data.block.create({ location: { "parent-uid": pageUid, order: 0 }, block: { string: RUNNER_HINT, uid } });
    return uid;
  }
  if (hint.string !== RUNNER_HINT) await roam().data.block.update({ block: { uid: hint.uid, string: RUNNER_HINT } });
  if (index !== 0) await roam().data.block.move({ location: { "parent-uid": pageUid, order: 0 }, block: { uid: hint.uid } });
  return hint.uid;
};

// Puts the About block right after the setup note (first when there's
// none), in this kit's words, rewriting the one an earlier push left.
const placeAbout = async (pageUid: string, text: string): Promise<void> => {
  const children = (await readTree(pageUid))?.children ?? [];
  const order = children.some((child) => HINT_STARTS.some((start) => child.string.startsWith(start))) ? 1 : 0;
  const about = children.find((child) => child.string.startsWith(ABOUT_START));
  if (!about?.uid) {
    await roam().data.block.create({ location: { "parent-uid": pageUid, order }, block: { string: text, uid: roam().util.generateUID() } });
    return;
  }
  if (about.string !== text) await roam().data.block.update({ block: { uid: about.uid, string: text } });
  if (children.indexOf(about) !== order) await roam().data.block.move({ location: { "parent-uid": pageUid, order }, block: { uid: about.uid } });
};

// Opens a dg-proof:// link the way a click on one does, which hands it to
// the machine's handler (the browser asks first).
const openLink = (href: string): void => {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
};

export type Runner = { stop(): Promise<void> };

export const startRunner = async ({ extensionAPI }: { extensionAPI?: ExtensionAPI } = {}): Promise<Runner> => {
  if (win.proofRunner) {
    console.warn("[proof] a proof runner is already running in this tab; this copy stays off.");
    return { stop: async () => undefined };
  }
  await waitForRoam();
  const installedHelpers = !win.proof;
  if (installedHelpers) await evaluate(HELPERS_INIT_SCRIPT);
  const runner = new ProofRunner(extensionAPI);
  win.proofRunner = runner.api();
  if (!document.getElementById(SETTINGS_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = SETTINGS_STYLE_ID;
    style.textContent = SETTINGS_CSS;
    document.head.append(style);
  }
  await runner.registerCommands();
  if (registerAgentTools(extensionAPI, runner.agentHost())) console.log("[proof] agent tools registered with Roam's AI API.");
  await runner.loadIfNone();
  runner.observe();
  runner.listen();
  await runner.tidyPage(await openUid());
  return { stop: () => runner.stop(installedHelpers) };
};
