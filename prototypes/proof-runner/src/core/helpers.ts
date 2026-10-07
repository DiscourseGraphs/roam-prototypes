// The helper library every proof session loads before the page's own scripts,
// as window.proof. Kit js uses it instead of pasting its own waiters and
// clickers: proof.waitFor(...), proof.callout("Stored relations are disabled"),
// proof.setSwitch("Enable stored relations", false, { confirm: ["Deactivate"] }).
// Plain JS in a string: tsx would inject helpers into serialized functions.
import { PROOF_DB_URL } from "./database";

export const HELPERS_INIT_SCRIPT = String.raw`(() => {
  if (window.proof) return;

  // The proof database (core/database.ts), the only one proof talks to.
  const PROOF_DB_URL = ${JSON.stringify(PROOF_DB_URL)};

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const describe = (probe, what) =>
    what || (typeof probe === "string" ? probe : "the condition");

  // Resolves with the first truthy value of a selector or a function.
  const waitFor = async (probe, options) => {
    const timeout = (options && options.timeout) || 10000;
    const interval = (options && options.interval) || 100;
    const deadline = Date.now() + timeout;
    for (;;) {
      const value =
        typeof probe === "string" ? document.querySelector(probe) : await probe();
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(
          "Timed out after " + timeout + " ms waiting for " + describe(probe, options && options.what) + ".",
        );
      }
      await sleep(interval);
    }
  };

  const assert = (condition, message) => {
    if (!condition) throw new Error(message || "Assertion failed.");
    return true;
  };

  const visible = (element) =>
    Boolean(element) &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden";

  const textOf = (element) => (element.innerText || element.textContent || "").trim();

  const byText = (selector, text, root) =>
    Array.from((root || document).querySelectorAll(selector)).find(
      (element) => visible(element) && textOf(element).includes(text),
    ) || null;

  const dialogs = () =>
    Array.from(document.querySelectorAll(".bp3-dialog")).filter(visible);

  const dialogText = () => dialogs().map(textOf).join("\n");

  const callout = (title) => byText(".bp3-callout", title);

  const switchByLabel = (label) =>
    byText("label.bp3-control, label.bp3-checkbox, label.bp3-switch", label);

  // Blueprint hides the real input under .bp3-control-indicator, so click
  // the indicator. confirm lists dialog buttons to try, in order, when the
  // switch asks before it changes (Stored relations does both ways).
  const setSwitch = async (label, on, options) => {
    const control = await waitFor(() => switchByLabel(label), {
      what: 'the "' + label + '" switch',
    });
    const input = control.querySelector("input");
    if (!input) throw new Error('The "' + label + '" switch has no input.');
    if (input.checked === on) return "kept";
    (control.querySelector(".bp3-control-indicator") || control).click();
    const confirm = (options && options.confirm) || [];
    if (confirm.length) {
      const button = await waitFor(
        () =>
          confirm
            .map((name) => byText(".bp3-dialog button", name))
            .find(Boolean) || null,
        { what: "one of: " + confirm.join(", ") },
      );
      button.click();
    }
    await waitFor(
      () => {
        const current = switchByLabel(label);
        const box = current && current.querySelector("input");
        return Boolean(box) && box.checked === on;
      },
      { what: '"' + label + '" to turn ' + (on ? "on" : "off") },
    );
    return "changed";
  };

  // Blueprint v3 closes a dialog on an Escape keydown that reaches its overlay
  // with which 27. A constructed event has which 0 and, sent to the document,
  // never reaches the overlay, so DG's settings (no close button) stayed open.
  const pressEscapeOn = (target) => {
    const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, "keyCode", { get: () => 27 });
    Object.defineProperty(event, "which", { get: () => 27 });
    target.dispatchEvent(event);
  };

  // Closes the top dialog first: its close button when it has one, else Escape.
  const closeDialogs = async () => {
    for (let attempt = 0; attempt < 6 && dialogs().length; attempt += 1) {
      const open = dialogs();
      const top = open[open.length - 1];
      const close =
        top.querySelector("button[aria-label='Close']") ||
        document.querySelector(".rm-settings-close-button");
      if (close) close.click();
      else pressEscapeOn(top);
      await sleep(300);
    }
    return dialogs().length === 0;
  };

  // The proof database's REST API. Pass the key from the kit,
  // {{env.SUPABASE_SERVICE_ROLE_KEY}}, so it is filled in only while the step runs.
  const rest = async (path, options) => {
    const opts = options || {};
    if (!opts.key) throw new Error("proof.rest needs { key }.");
    const headers = {
      apikey: opts.key,
      authorization: "Bearer " + opts.key,
      "content-type": "application/json",
    };
    if (opts.prefer) headers.prefer = opts.prefer;
    const response = await fetch(PROOF_DB_URL + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error((opts.method || "GET") + " " + path + " -> " + response.status + ": " + text.slice(0, 200));
    }
    return text ? JSON.parse(text) : null;
  };

  // recordDemo forwards only page console lines with this prefix.
  const log = (label, value) =>
    console.log("[recordDemo] " + label + " " + JSON.stringify(value));

  // Roam data. Titles are passed as query inputs, never spliced into Datalog.
  const api = () => window.roamAlphaAPI;
  const CONFIG_PAGE = "roam/js/discourse-graph";
  const FLAGS_BLOCK = "Feature Flags";

  // Pulled props come back with ":"-prefixed keys.
  const normalizeProps = (raw) => {
    const out = {};
    for (const key in raw || {}) out[key.replace(/^:+/, "")] = raw[key];
    return out;
  };

  const uid = (title) =>
    api().data.q(
      "[:find ?u . :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]",
      title,
    ) || null;

  const createBlocks = async (parentUid, children) => {
    const list = children || [];
    for (let index = 0; index < list.length; index += 1) {
      const child = typeof list[index] === "string" ? { string: list[index] } : list[index];
      const blockUid = child.uid || api().util.generateUID();
      await api().data.block.create({
        location: { "parent-uid": parentUid, order: index },
        block: { string: child.string, uid: blockUid },
      });
      if (child.children) await createBlocks(blockUid, child.children);
    }
  };

  const page = {
    uid,
    exists: (title) => Boolean(uid(title)),
    // Creates the page with these child blocks unless it already exists.
    ensure: async (title, children) => {
      const existing = uid(title);
      if (existing) return existing;
      const pageUid = api().util.generateUID();
      await api().data.page.create({ page: { title, uid: pageUid } });
      await createBlocks(pageUid, children);
      await waitFor(() => uid(title), { what: "the page " + title });
      return pageUid;
    },
    remove: async (titles) => {
      let removed = 0;
      for (const title of [].concat(titles)) {
        const pageUid = uid(title);
        if (!pageUid) continue;
        await api().data.page.delete({ page: { uid: pageUid } });
        removed += 1;
      }
      return removed;
    },
    recreate: async (title, children) => {
      await page.remove(title);
      return page.ensure(title, children);
    },
    // Waits for the main window to show the page, by its uid. Roam draws the
    // [[links]] in a title as separate pieces and can hide their brackets,
    // so a title like "[[EVD]] - … - [[@Source]]" needn't read as itself on
    // screen, and waiting for that text timed out on every such page.
    open: async (title) => {
      const pageUid = uid(title);
      if (!pageUid) throw new Error("No page titled " + JSON.stringify(title) + " in this graph.");
      await api().ui.mainWindow.openPage({ page: { uid: pageUid } });
      return waitFor(
        async () => {
          if ((await api().ui.mainWindow.getOpenPageOrBlockUid()) !== pageUid) return null;
          const shown = document.querySelector(
            '.roam-article .rm-title-display-container[data-page-uid="' + pageUid + '"] .rm-title-display',
          );
          if (shown) return visible(shown) ? shown : null;
          // A Roam that doesn't mark the title with its uid: the main window's title, now that it's this page.
          return Array.from(document.querySelectorAll(".roam-article .rm-title-display")).find((element) => visible(element)) || null;
        },
        { what: "the page " + title },
      );
    },
  };

  const configChildren = () => {
    const result = api().data.pull(
      "[{:block/children [:block/uid :block/string :block/props]}]",
      [":node/title", CONFIG_PAGE],
    );
    return (result && result[":block/children"]) || [];
  };

  const flagsBlock = () =>
    configChildren().find((child) => child[":block/string"] === FLAGS_BLOCK) || null;

  // Feature flags are props on the Feature Flags block of roam/js/discourse-graph.
  // The extension reads them once at load, so set them before it loads.
  const flags = {
    all: () => normalizeProps((flagsBlock() || {})[":block/props"]),
    get: (name) => flags.all()[name] === true,
    set: async (name, value) => {
      let pageUid = uid(CONFIG_PAGE);
      if (!pageUid) {
        pageUid = api().util.generateUID();
        await api().data.page.create({ page: { title: CONFIG_PAGE, uid: pageUid } });
      }
      const block = flagsBlock();
      let blockUid;
      let existing = {};
      if (block) {
        blockUid = block[":block/uid"];
        existing = normalizeProps(block[":block/props"]);
      } else {
        blockUid = api().util.generateUID();
        await api().data.block.create({
          location: { "parent-uid": pageUid, order: "last" },
          block: { string: FLAGS_BLOCK, uid: blockUid },
        });
      }
      if (existing[name] === value) return "kept";
      const props = Object.assign({}, existing);
      props[name] = value;
      await api().data.block.update({ block: { uid: blockUid, props } });
      await waitFor(() => flags.all()[name] === value, {
        what: "the flag " + name + " to read back as " + value,
        timeout: 5000,
      });
      return "changed";
    },
  };

  const toasts = {
    clear: () => {
      document
        .querySelectorAll(".bp3-toast .bp3-toast-dismiss button, .bp3-toast button[aria-label='Close']")
        .forEach((button) => button.click());
      return true;
    },
  };

  const sidebar = {
    clearRight: async () => {
      for (const item of api().ui.rightSidebar.getWindows()) {
        try {
          await api().ui.rightSidebar.removeWindow({
            window: {
              type: item.type,
              "block-uid": item["block-uid"] || item["page-uid"] || item["mentions-uid"],
            },
          });
        } catch (error) {
          // A window that's already gone is fine.
        }
      }
      return api().ui.rightSidebar.getWindows().length === 0;
    },
  };

  // Strips ":" prefixes at every depth, for props read back from Roam.
  const plain = (value) => {
    if (Array.isArray(value)) return value.map(plain);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key in value) out[key.replace(/^:+/, "")] = plain(value[key]);
    return out;
  };

  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  };

  // True when two elements' boxes share any area.
  const overlaps = (a, b) => {
    const one = rect(a);
    const two = rect(b);
    return one.left < two.right && two.left < one.right && one.top < two.bottom && two.top < one.bottom;
  };

  // Stored relations are blocks on this page whose "discourse-graph" prop holds
  // { sourceUid, destinationUid, hasSchema, tentative? }, as createReifiedBlock
  // writes them. Imported ones carry tentative: "true" until accepted.
  const RELATIONS_PAGE = "roam/js/discourse-graph/relations";

  const relationBlocks = () => {
    const pageUid = uid(RELATIONS_PAGE);
    if (!pageUid) return [];
    const result = api().data.pull(
      "[{:block/children [:block/uid :block/props]}]",
      [":block/uid", pageUid],
    );
    return ((result && result[":block/children"]) || [])
      .map((child) => {
        const props = plain(child[":block/props"] || {});
        return Object.assign({ uid: child[":block/uid"] }, props["discourse-graph"] || {});
      })
      .filter((item) => item.sourceUid && item.destinationUid);
  };

  const configTree = () => {
    const result = api().data.pull(
      "[:block/string :block/uid :block/props {:block/children ...}]",
      [":node/title", CONFIG_PAGE],
    );
    return (result && result[":block/children"]) || [];
  };

  const byString = (children, text) =>
    (children || []).find(
      (child) => String(child[":block/string"] || "").trim().toLowerCase() === text.toLowerCase(),
    ) || null;

  const relations = {
    page: RELATIONS_PAGE,
    all: relationBlocks,
    touching: (uids) => {
      const set = new Set([].concat(uids));
      return relationBlocks().filter((item) => set.has(item.sourceUid) || set.has(item.destinationUid));
    },
    // The id of the relation type with this label, from the legacy grammar
    // tree or, with the new settings store, the Global block's Relations prop.
    schemaId: (label) => {
      const tree = configTree();
      const grammar = byString(tree, "grammar");
      const relationsNode = grammar && byString(grammar[":block/children"], "relations");
      const legacy = relationsNode && byString(relationsNode[":block/children"], label);
      if (legacy) return legacy[":block/uid"];
      for (const child of tree) {
        const props = plain(child[":block/props"] || {});
        const all = props.Relations || {};
        for (const id in all) {
          if (all[id] && all[id].label === label) return id;
        }
      }
      return null;
    },
    removeTouching: async (uids) => {
      const found = relations.touching(uids);
      for (const item of found) {
        await api().data.block.delete({ block: { uid: item.uid } });
      }
      return found.length;
    },
    // Writes the block an import writes for a relation still pending review.
    createTentative: async ({ sourceUid, destinationUid, schemaUid }) => {
      let pageUid = uid(RELATIONS_PAGE);
      if (!pageUid) {
        pageUid = api().util.generateUID();
        await api().data.page.create({ page: { title: RELATIONS_PAGE, uid: pageUid } });
      }
      const blockUid = api().util.generateUID();
      await api().data.block.create({
        location: { "parent-uid": pageUid, order: "last" },
        block: { string: blockUid, uid: blockUid },
      });
      await api().data.block.update({
        block: {
          uid: blockUid,
          props: { "discourse-graph": { sourceUid, destinationUid, hasSchema: schemaUid, tentative: "true" } },
        },
      });
      await waitFor(() => relationBlocks().some((item) => item.uid === blockUid), {
        what: "the pending relation block to read back",
      });
      return blockUid;
    },
  };

  // A node type is a discourse-graph/nodes/<label> page with Shortcut, Tag and
  // Format blocks for the legacy settings store and the same values as page
  // props for the new one, as createDiscourseNodeType writes it. The extension
  // reads node types at load, so create them before it loads.
  const NODE_TYPE_PREFIX = "discourse-graph/nodes/";
  const nodeType = {
    uid: (label) => uid(NODE_TYPE_PREFIX + label),
    format: (label) => {
      const pageUid = nodeType.uid(label);
      if (!pageUid) return null;
      const result = api().data.pull(
        "[{:block/children [:block/string {:block/children [:block/string]}]}]",
        [":block/uid", pageUid],
      );
      const format = byString((result && result[":block/children"]) || [], "Format");
      const value = format && (format[":block/children"] || [])[0];
      return value ? value[":block/string"] : null;
    },
    // The template's block strings, depth first, or null without a Template block.
    template: (label) => {
      const pageUid = nodeType.uid(label);
      if (!pageUid) return null;
      const result = api().data.pull(
        "[{:block/children [:block/string {:block/children ...}]}]",
        [":block/uid", pageUid],
      );
      const template = byString((result && result[":block/children"]) || [], "Template");
      if (!template) return null;
      const strings = [];
      const walk = (children) => {
        for (const child of children || []) {
          strings.push(child[":block/string"] || "");
          walk(child[":block/children"]);
        }
      };
      walk(template[":block/children"]);
      return strings;
    },
    ensure: async ({ label, format, shortcut }) => {
      if (nodeType.format(label) === format) return nodeType.uid(label);
      const existing = nodeType.uid(label);
      if (existing) await api().data.page.delete({ page: { uid: existing } });
      const pageUid = api().util.generateUID();
      await api().data.page.create({ page: { title: NODE_TYPE_PREFIX + label, uid: pageUid } });
      const key = shortcut || label.slice(0, 1).toUpperCase();
      await createBlocks(pageUid, [
        { string: "Shortcut", children: [key] },
        { string: "Tag", children: [""] },
        { string: "Format", children: [format] },
      ]);
      await api().data.block.update({
        block: { uid: pageUid, props: { text: label, type: pageUid, shortcut: key, format } },
      });
      await waitFor(() => nodeType.format(label) === format, {
        what: "the node type " + label + " to read back",
      });
      return pageUid;
    },
  };

  // The proof database session the extension reads at load. Without one it
  // asks the create-space edge function for a space, and the proof database
  // runs without edge functions, so sign in the way createLoggedInClient
  // does: as the space's anon account with the password the graph stores.

  const storedSession = (storageKey) => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch (error) {
      return null;
    }
  };

  const sessionValid = (storageKey, platform) => {
    const session = storedSession(storageKey);
    return Boolean(
      session &&
        session.user &&
        new RegExp("^" + platform + "-\\d+-anon@").test(session.user.email || "") &&
        session.expires_at > Date.now() / 1000 + 300,
    );
  };

  // Whether the proof database knows the stored session's user. A session
  // from another local stack (DG keys them all "sb-127:") or from before a
  // reset passes sessionValid and then fails every query.
  const sessionWorks = async (storageKey, platform) => {
    if (!sessionValid(storageKey, platform)) return false;
    const session = storedSession(storageKey);
    try {
      const response = await fetch(PROOF_DB_URL + "/auth/v1/user", {
        headers: { authorization: "Bearer " + session.access_token },
      });
      if (!response.ok) return false;
      const user = await response.json();
      return Boolean(user && user.id === session.user.id);
    } catch (error) {
      return false;
    }
  };

  // Signs in as the space's anon account and stores the session where
  // createSingletonClient looks for it ("sb-127:<name without non-word
  // characters>-auth-token"). Whatever the create-space edge function would
  // have made and isn't there yet (the Space row, the anon account with the
  // app's password, its PlatformAccount and editor access), the service key
  // makes; an account whose password differs is reset to the app's.
  const signInAnon = async ({ storageKey, spaceUrl, name, platform, password, serviceKey, publishableKey }) => {
    if (typeof password !== "string" || !password) {
      throw new Error("The app has no space password yet; let it connect to sync once first.");
    }
    const service = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
    const merge = Object.assign({ prefer: "resolution=merge-duplicates,return=representation" }, service);
    const admin = async (path, init) => {
      const response = await fetch(PROOF_DB_URL + path, Object.assign({ headers: service }, init));
      const text = await response.text();
      if (!response.ok) throw new Error(((init && init.method) || "GET") + " " + path + " -> " + response.status + ": " + text.slice(0, 200));
      return text ? JSON.parse(text) : null;
    };
    const platformName = platform === "roam" ? "Roam" : "Obsidian";
    let spaces = await admin("/rest/v1/Space?select=id&url=eq." + encodeURIComponent(spaceUrl));
    if (!spaces.length) {
      spaces = await admin("/rest/v1/Space?on_conflict=url&select=id", {
        method: "POST",
        headers: merge,
        body: JSON.stringify({ url: spaceUrl, name, platform: platformName }),
      });
    }
    const spaceId = spaces[0].id;
    const email = platform + "-" + spaceId + "-anon@database.discoursegraphs.com";
    const token = () =>
      fetch(PROOF_DB_URL + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: publishableKey, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    let response = await token();
    if (!response.ok) {
      const listed = await admin("/auth/v1/admin/users?page=1&per_page=1000");
      let user = ((listed && listed.users) || []).find((item) => item.email === email);
      if (user) {
        await admin("/auth/v1/admin/users/" + user.id, { method: "PUT", body: JSON.stringify({ password }) });
      } else {
        user = await admin("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
      }
      await admin("/rest/v1/PlatformAccount?on_conflict=account_local_id,platform", {
        method: "POST",
        headers: merge,
        body: JSON.stringify({
          platform: platformName,
          account_local_id: email,
          name: "Anonymous of space " + spaceId,
          agent_type: "anonymous",
          dg_account: user.id,
        }),
      });
      await admin("/rest/v1/SpaceAccess?on_conflict=account_uid,space_id", {
        method: "POST",
        headers: merge,
        body: JSON.stringify({ space_id: spaceId, account_uid: user.id, permissions: "editor" }),
      });
      response = await token();
    }
    const session = await response.json();
    if (!response.ok || !session.access_token) {
      throw new Error("Sign-in failed: " + JSON.stringify(session).slice(0, 200));
    }
    if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
    localStorage.setItem(storageKey, JSON.stringify(session));
    return spaceId;
  };

  // The database the loaded build talks to, by the first part of its
  // Supabase host, the way DG names its session key: "127" for a local dist,
  // the hosted project for a CI build (the in-Roam runner sets
  // window.__proofBackend from the build it loaded).
  const backendRef = () => (window.__proofBackend && window.__proofBackend.ref) || "127";

  const supabase = {
    backend: backendRef,
    hosted: () => backendRef() !== "127",
    storageKey: () => "sb-" + backendRef() + ":" + api().graph.name.replace(/\W/g, "") + "-auth-token",
    spaceUrl: () => "https://roamresearch.com/#/app/" + api().graph.name,
    session: () => storedSession(supabase.storageKey()),
    // A stored session that hasn't expired; no request.
    hasSession: () => sessionValid(supabase.storageKey(), "roam"),
    // A stored session the proof database accepts (a promise).
    signedIn: () => sessionWorks(supabase.storageKey(), "roam"),
    password: async () => {
      const pageUid = uid(CONFIG_PAGE);
      if (!pageUid) throw new Error("No " + CONFIG_PAGE + " page; load the extension once first.");
      const result = api().data.pull("[:block/props]", [":block/uid", pageUid]);
      const props = normalizeProps(result && result[":block/props"]);
      if (typeof props["space-user-password"] === "string") return props["space-user-password"];
      const password = crypto.randomUUID();
      await api().data.block.update({
        block: { uid: pageUid, props: Object.assign({}, props, { "space-user-password": password }) },
      });
      return password;
    },
    signIn: async ({ serviceKey, publishableKey }) => {
      if (supabase.hosted()) {
        throw new Error("This build uses the hosted database; DG signs in to it by itself when it loads with sync or node sharing on.");
      }
      return signInAnon({
        storageKey: supabase.storageKey(),
        spaceUrl: supabase.spaceUrl(),
        name: api().graph.name,
        platform: "roam",
        password: await supabase.password(),
        serviceKey,
        publishableKey,
      });
    },
  };

  // Obsidian: the same helpers work in its window (it has no roamAlphaAPI),
  // plus these for the vault and the Discourse Graph plugin.
  const PLUGIN_ID = "@discourse-graph/obsidian";
  const obsidian = {
    app: () => window.app,
    plugin: () => window.app.plugins.plugins[PLUGIN_ID],
    // Reloads the plugin from disk, so a newly installed build takes over.
    reloadPlugin: async () => {
      await window.app.plugins.disablePlugin(PLUGIN_ID);
      await window.app.plugins.enablePlugin(PLUGIN_ID);
      return waitFor(() => obsidian.plugin() && obsidian.plugin().settings, {
        what: "the Discourse Graph plugin to load again",
        timeout: 30000,
      });
    },
    storageKey: () => "sb-127:" + window.app.vault.getName().replace(/\W/g, "") + "-auth-token",
    signedIn: () => sessionWorks(obsidian.storageKey(), "obsidian"),
    // Same as proof.supabase.signIn, for the vault's space. Kept when signed in.
    signIn: async ({ serviceKey, publishableKey }) =>
      (await obsidian.signedIn())
        ? "kept"
        : signInAnon({
            storageKey: obsidian.storageKey(),
            spaceUrl: "obsidian:" + window.app.appId,
            name: window.app.vault.getName(),
            platform: "obsidian",
            password: obsidian.plugin() && obsidian.plugin().settings.spacePassword,
            serviceKey,
            publishableKey,
          }),
    nodeTypes: () => (obsidian.plugin().settings.nodeTypes || []).slice(),
    nodeType: (name) => obsidian.nodeTypes().find((type) => type.name === name) || null,
    removeNodeTypes: async (names) => {
      const settings = obsidian.plugin().settings;
      const drop = new Set([].concat(names));
      const before = settings.nodeTypes.length;
      settings.nodeTypes = settings.nodeTypes.filter((type) => !drop.has(type.name));
      if (settings.nodeTypes.length !== before) await obsidian.plugin().saveSettings();
      return before - settings.nodeTypes.length;
    },
    file: (path) => window.app.vault.getAbstractFileByPath(path),
    frontmatter: (file) => (window.app.metadataCache.getFileCache(file) || {}).frontmatter || {},
    // Notes imported from these source ids, by the importedFromRid they carry.
    importedFiles: (localIds) =>
      window.app.vault.getMarkdownFiles().filter((file) => {
        const rid = obsidian.frontmatter(file).importedFromRid || "";
        return [].concat(localIds).some((id) => rid.endsWith("/" + id));
      }),
    removeFiles: async (files) => {
      for (const file of [].concat(files)) if (file) await window.app.vault.delete(file);
      return true;
    },
    open: async (path) => {
      const file = obsidian.file(path);
      if (!file) throw new Error("No file " + path + " in the vault.");
      await window.app.workspace.getLeaf(false).openFile(file);
      return file;
    },
    write: async (path, text) => {
      const existing = obsidian.file(path);
      if (existing) await window.app.vault.modify(existing, text);
      else await window.app.vault.create(path, text);
      return obsidian.file(path);
    },
    templates: () => {
      const plugin = window.app.internalPlugins.plugins.templates;
      return {
        enabled: Boolean(plugin && plugin.enabled),
        folder: (plugin && plugin.instance && plugin.instance.options && plugin.instance.options.folder) || "",
      };
    },
    // Turns the Templates core plugin on with this folder, or off. The folder
    // holds for the session, which is all a take needs.
    setTemplates: async ({ on, folder }) => {
      const plugins = window.app.internalPlugins;
      if (on) {
        if (!plugins.plugins.templates.enabled) await plugins.enablePluginAndSave("templates");
        if (folder && !obsidian.file(folder)) await window.app.vault.createFolder(folder);
        plugins.plugins.templates.instance.options.folder = folder;
      } else if (plugins.plugins.templates.enabled) {
        await plugins.disablePluginAndSave("templates");
      }
      return obsidian.templates();
    },
    notices: () =>
      Array.from(document.querySelectorAll(".notice")).map(textOf).join("\n"),
    clearNotices: () => {
      document.querySelectorAll(".notice").forEach((notice) => notice.remove());
      return true;
    },
    closeModals: async () => {
      for (let attempt = 0; attempt < 5 && document.querySelector(".modal"); attempt += 1) {
        const close = document.querySelector(".modal .modal-close-button");
        if (close) close.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(250);
      }
      return !document.querySelector(".modal");
    },
  };

  const toastText = () =>
    Array.from(document.querySelectorAll(".bp3-toast")).filter(visible).map(textOf).join("\n");

  const nodeTypes = () => {
    const builder =
      window.roamjs && window.roamjs.extension && window.roamjs.extension.queryBuilder;
    if (!builder || typeof builder.getDiscourseNodes !== "function") {
      throw new Error("The DG extension isn't loaded.");
    }
    return builder.getDiscourseNodes();
  };

  Object.defineProperty(window, "proof", {
    value: Object.freeze({
      sleep,
      waitFor,
      assert,
      visible,
      byText,
      dialogs,
      dialogText,
      callout,
      switchByLabel,
      setSwitch,
      closeDialogs,
      rest,
      log,
      normalizeProps,
      uid,
      page,
      flags,
      toasts,
      sidebar,
      nodeTypes,
      plain,
      rect,
      overlaps,
      relations,
      nodeType,
      supabase,
      obsidian,
      toastText,
    }),
    // Configurable so a long-lived window (Obsidian) can take a newer copy.
    configurable: true,
    writable: false,
  });
})();`;
