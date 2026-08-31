import { Roam, findRoamPage, hasBlockChildren, importItemMetadata, importItemNotes } from "@services/roam";

import { matchItems, normalizeCitekey, simplifyItemForAgent } from "./helpers";

import { setupInitialSettings } from "../../setup";
import { categorizeLibraryItems, identifyChildren } from "../../utils";

import { UserSettings } from "Types/extension";
import { ZItemAnnotation, ZItemAttachment, ZItemNote, ZItemTop, ZLibraryContents } from "Types/transforms";


/** Retrieves the extension's current settings, merged with defaults.
 * Settings are read at call time (rather than captured at registration), so that changes made through the settings dialog are picked up without a reload.
 */
function getCurrentSettings(extensionAPI: Roam.ExtensionAPI): UserSettings {
	return setupInitialSettings((extensionAPI.settings.getAll() || {}) as Partial<UserSettings>);
}

/** Retrieves the categorized contents of the user's Zotero libraries, as currently loaded by the extension */
function getLibraryContents(): ZLibraryContents {
	return categorizeLibraryItems(window.zoteroRoam.getItems("all"));
}

/** Finds a loaded Zotero item from its citekey.
 * @returns The item and the categorized library contents it was found in
 */
function findItemByCitekey(citekey: string): { item: ZItemTop, libraryContents: ZLibraryContents } {
	const key = normalizeCitekey(citekey);
	const libraryContents = getLibraryContents();
	const item = libraryContents.items.find(it => it.key == key);

	if (!item) {
		throw new Error(`No Zotero item found for citekey "@${key}". The item may not be loaded yet, or may not have a pinned citation key - use the zotero-search-items tool to find items by title or DOI.`);
	}

	return { item, libraryContents };
}

/** Identifies an item's children (PDFs, notes/annotations) among the library contents */
function findItemChildren(item: ZItemTop, libraryContents: ZLibraryContents): { pdfs: ZItemAttachment[], notes: (ZItemNote | ZItemAnnotation)[] } {
	const location = item.library.type + "s/" + item.library.id;
	return identifyChildren(item.data.key, location, { pdfs: libraryContents.pdfs, notes: libraryContents.notes });
}

/** Generates the list of AI tools to register.
 * Tool handlers read from `window.zoteroRoam` and from the extension's settings at call time, so they must only be invoked once the extension is fully loaded.
 */
const aiTools = ({ extensionAPI }: { extensionAPI: Roam.ExtensionAPI }): Roam.AITool[] => [
	{
		name: "zotero-search-items",
		description: "Searches the Zotero items currently loaded by the zoteroRoam extension, by citekey, DOI, Zotero item key, or title substring. Read-only. Returns compact summaries, including each item's citekey and inGraph (the UID of its Roam page if one exists, otherwise false). Use this to find an item's exact citekey before calling zotero-import-metadata or zotero-import-notes. An empty query lists loaded items, up to the limit. Items are matched against the extension's local data, which syncs periodically from the Zotero API - an item added to Zotero moments ago may not be loaded yet.",
		scope: "read",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search string - a citekey (with or without the leading @), a DOI, a Zotero item key, or a title substring"
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 50,
					default: 20,
					description: "Maximum number of matches to return"
				}
			},
			required: ["query"],
			additionalProperties: false
		},
		handler: ({ query, limit = 20 }) => {
			const { items } = getLibraryContents();
			const matches = matchItems(items, String(query ?? ""));

			return {
				total: matches.length,
				items: matches
					.slice(0, Number(limit) || 20)
					.map(item => simplifyItemForAgent(item, { inGraph: findRoamPage("@" + item.key) }))
			};
		}
	},
	{
		name: "zotero-import-metadata",
		description: "Imports a Zotero item's metadata into Roam, as blocks on its citekey page ([[@citekey]]) - creating that page if needed. This is the headless equivalent of zoteroRoam's 'Import metadata' button: it uses the user's configured metadata settings (default formatter, custom function, or SmartBlock) and covers the item's PDF links and notes as configured. If the citekey doesn't match a loaded item, the call fails with guidance - use zotero-search-items first when unsure. By default the call is refused if the citekey page already has content, to avoid duplicate imports.",
		scope: "edit",
		inputSchema: {
			type: "object",
			properties: {
				citekey: {
					type: "string",
					description: "The item's citation key, with or without the leading @ (e.g. \"@smithSomeTitle2021\")"
				},
				allowDuplicate: {
					type: "boolean",
					default: false,
					description: "Import even if the item's Roam page already has content. This adds another copy of the metadata at the top of the page."
				}
			},
			required: ["citekey"],
			additionalProperties: false
		},
		handler: async ({ citekey, allowDuplicate = false }) => {
			const { item, libraryContents } = findItemByCitekey(citekey);
			const { pdfs, notes } = findItemChildren(item, libraryContents);
			const uid = findRoamPage("@" + item.key);

			if (uid && !allowDuplicate && hasBlockChildren(uid)) {
				throw new Error(`The page [[@${item.key}]] already has content - its metadata may already have been imported. Pass allowDuplicate: true to import anyway (this will add another copy of the metadata at the top of the page).`);
			}

			const settings = getCurrentSettings(extensionAPI);
			const outcome = await importItemMetadata({ item, pdfs, notes }, uid, settings.metadata, settings.typemap, settings.notes, settings.annotations);

			if (outcome.success === false) {
				throw (outcome.error instanceof Error ? outcome.error : new Error("Metadata import failed"));
			}

			return {
				citekey: "@" + item.key,
				page: outcome.page,
				success: outcome.success,
				blocksAdded: outcome.args && "blocks" in outcome.args ? outcome.args.blocks.length : null
			};
		}
	},
	{
		name: "zotero-import-notes",
		description: "Imports a Zotero item's notes and PDF annotations into Roam, as blocks on its citekey page ([[@citekey]]) - creating that page if needed. This is the headless equivalent of zoteroRoam's 'Import notes' button: notes and annotations are formatted with the user's notes/annotations settings. Fails if the item has no notes or annotations, or if the citekey doesn't match a loaded item - use zotero-search-items first when unsure.",
		scope: "edit",
		inputSchema: {
			type: "object",
			properties: {
				citekey: {
					type: "string",
					description: "The item's citation key, with or without the leading @ (e.g. \"@smithSomeTitle2021\")"
				}
			},
			required: ["citekey"],
			additionalProperties: false
		},
		handler: async ({ citekey }) => {
			const { item, libraryContents } = findItemByCitekey(citekey);
			const { notes } = findItemChildren(item, libraryContents);

			if (notes.length == 0) {
				throw new Error(`The item "@${item.key}" has no notes or annotations in Zotero - there is nothing to import.`);
			}

			const uid = findRoamPage("@" + item.key);
			const settings = getCurrentSettings(extensionAPI);
			const outcome = await importItemNotes({ item, notes }, uid, settings.notes, settings.annotations);

			if (outcome.success === false) {
				throw (outcome.error instanceof Error ? outcome.error : new Error("Notes import failed"));
			}

			return {
				citekey: "@" + item.key,
				page: outcome.page,
				success: outcome.success,
				notesImported: notes.length
			};
		}
	}
];

/** Registers the extension's AI tools, so that agents connected through Roam's MCP server can invoke them (via `call_extension_tool`).
 * No-ops on Roam builds that predate extension AI tools. Safe to call again (re-adding a name updates the tool in place); registered tools are removed automatically when the extension is unloaded.
 * @returns Whether the tools were registered
 */
function registerAiTools({ extensionAPI }: { extensionAPI: Roam.ExtensionAPI }): boolean {
	const ai = extensionAPI.ai;
	if (!ai || typeof ai.addTool !== "function") {
		return false;
	}

	aiTools({ extensionAPI }).forEach(tool => ai.addTool(tool));
	return true;
}


export { aiTools, registerAiTools };
