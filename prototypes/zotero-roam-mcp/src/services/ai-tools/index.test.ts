import { QueryClient } from "@tanstack/query-core";
import { mock } from "vitest-mock-extended";

import { Roam } from "@services/roam";

import { analyzeUserRequests, setupInitialSettings } from "../../setup";
import ZoteroRoam from "../../api";

import { aiTools, registerAiTools } from ".";

import { apiKeys, items, libraries, sampleAnnot, sampleNote, samplePDF } from "Mocks";
import { existing_page_uid, existing_page_with_content_uid, findRoamPage, importItemMetadata, importItemNotes } from "Mocks/roam";


const { userLibrary, groupLibrary } = libraries;
const { keyWithFullAccess: { key: masterKey } } = apiKeys;

const defaultReqs = [
	{ dataURI: userLibrary.path + "/items", apikey: masterKey, name: "My user library" },
	{ dataURI: groupLibrary.path + "/items", apikey: masterKey, name: "My group library" }
];
const initRequests = analyzeUserRequests(defaultReqs);
const initSettings = setupInitialSettings({});

const blochItem = items.find(it => it.key == "blochImplementingSocialInterventions2021")!;
const pintoItem = items.find(it => it.key == "pintoExploringDifferentMethods2021")!;

/** Creates a fake `extensionAPI`, with an in-memory settings store and spies for the AI tools API */
const makeExtensionAPI = (settings: Record<string, unknown> = {}, { withAI = true } = {}): Roam.ExtensionAPI => ({
	settings: {
		get: <T>(key: string) => settings[key] as T | undefined,
		getAll: () => settings,
		set: (key, value) => {
			settings[key] = value;
		},
		panel: {
			create: () => {}
		}
	},
	ui: {
		commandPalette: {
			addCommand: async () => {},
			removeCommand: async () => {}
		}
	},
	...(withAI
		? { ai: { addTool: vi.fn(() => null), removeTool: vi.fn(() => null) } }
		: {})
});

const getTool = (extensionAPI: Roam.ExtensionAPI, name: string) => {
	return aiTools({ extensionAPI }).find(tool => tool.name == name)!;
};

const toolContext = () => mock<Roam.AIToolContext>();

describe("registerAiTools", () => {
	it("registers every tool when the AI tools API is available", () => {
		const extensionAPI = makeExtensionAPI();

		expect(registerAiTools({ extensionAPI })).toBe(true);
		expect(extensionAPI.ai!.addTool).toHaveBeenCalledTimes(3);

		const registered = vi.mocked(extensionAPI.ai!.addTool).mock.calls.map(([tool]) => tool);
		expect(registered.map(tool => tool.name)).toEqual([
			"zotero-search-items",
			"zotero-import-metadata",
			"zotero-import-notes"
		]);
	});

	it("declares tools within Roam's constraints", () => {
		const extensionAPI = makeExtensionAPI();

		aiTools({ extensionAPI }).forEach(tool => {
			expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
			expect(tool.description.length).toBeLessThanOrEqual(2000);
			expect(["read", "append", "edit"]).toContain(tool.scope);
			expect(tool.inputSchema).toMatchObject({ type: "object" });
		});
	});

	it("no-ops on Roam builds without extension AI tools", () => {
		const extensionAPI = makeExtensionAPI({}, { withAI: false });

		expect(registerAiTools({ extensionAPI })).toBe(false);
	});
});

describe("AI tool handlers", () => {
	let client: QueryClient;
	let extensionAPI: Roam.ExtensionAPI;

	beforeEach(() => {
		// The Mocks/roam spies come from @storybook/test's `fn`, which vitest's `clearMocks` doesn't cover
		findRoamPage.mockClear();
		importItemMetadata.mockClear();
		importItemNotes.mockClear();

		client = new QueryClient();
		window.zoteroRoam = new ZoteroRoam({
			queryClient: client,
			requests: initRequests,
			settings: initSettings
		});

		client.setQueryData(
			["items"],
			(_prev) => ({
				data: [...items, samplePDF, sampleNote, sampleAnnot],
				lastUpdated: 9999
			})
		);

		extensionAPI = makeExtensionAPI();
	});

	describe("zotero-search-items", () => {
		it("returns compact matches, with the total count", () => {
			const tool = getTool(extensionAPI, "zotero-search-items");

			const output = tool.handler({ query: "@blochImplementingSocialInterventions2021" }, toolContext());

			expect(output).toEqual({
				total: 1,
				items: [
					expect.objectContaining({
						citekey: "@blochImplementingSocialInterventions2021",
						inGraph: false,
						key: "PPD648N6",
						library: userLibrary.path
					})
				]
			});
		});

		it("caps the number of returned items to the limit", () => {
			const tool = getTool(extensionAPI, "zotero-search-items");

			const output = tool.handler({ query: "", limit: 1 }, toolContext()) as { total: number, items: unknown[] };

			expect(output.total).toBe(items.length);
			expect(output.items.length).toBe(1);
		});
	});

	describe("zotero-import-metadata", () => {
		it("imports metadata for a loaded item, with its children and current settings", async () => {
			const tool = getTool(extensionAPI, "zotero-import-metadata");

			const output = await tool.handler({ citekey: "@blochImplementingSocialInterventions2021" }, toolContext());

			expect(importItemMetadata).toHaveBeenCalledTimes(1);
			expect(importItemMetadata).toHaveBeenCalledWith(
				{ item: blochItem, pdfs: [samplePDF], notes: [sampleNote, sampleAnnot] },
				false,
				initSettings.metadata,
				initSettings.typemap,
				initSettings.notes,
				initSettings.annotations
			);
			expect(output).toEqual({
				citekey: "@blochImplementingSocialInterventions2021",
				page: { new: true, title: "@blochImplementingSocialInterventions2021", uid: existing_page_uid },
				success: true,
				blocksAdded: 0
			});
		});

		it("refuses to import when the citekey page already has content", async () => {
			findRoamPage.mockReturnValueOnce(existing_page_with_content_uid);
			const tool = getTool(extensionAPI, "zotero-import-metadata");

			await expect(tool.handler({ citekey: "blochImplementingSocialInterventions2021" }, toolContext()))
				.rejects.toThrow(/already has content/);
			expect(importItemMetadata).not.toHaveBeenCalled();
		});

		it("imports into an existing page when allowDuplicate is set", async () => {
			findRoamPage.mockReturnValueOnce(existing_page_with_content_uid);
			const tool = getTool(extensionAPI, "zotero-import-metadata");

			await tool.handler({ citekey: "blochImplementingSocialInterventions2021", allowDuplicate: true }, toolContext());

			expect(importItemMetadata).toHaveBeenCalledWith(
				expect.anything(),
				existing_page_with_content_uid,
				initSettings.metadata,
				initSettings.typemap,
				initSettings.notes,
				initSettings.annotations
			);
		});

		it("fails with guidance when the citekey doesn't match a loaded item", async () => {
			const tool = getTool(extensionAPI, "zotero-import-metadata");

			await expect(tool.handler({ citekey: "@noSuchCitekey2099" }, toolContext()))
				.rejects.toThrow(/No Zotero item found for citekey "@noSuchCitekey2099"/);
			expect(importItemMetadata).not.toHaveBeenCalled();
		});
	});

	describe("zotero-import-notes", () => {
		it("imports notes and annotations for a loaded item", async () => {
			const tool = getTool(extensionAPI, "zotero-import-notes");

			const output = await tool.handler({ citekey: "@blochImplementingSocialInterventions2021" }, toolContext());

			expect(importItemNotes).toHaveBeenCalledTimes(1);
			expect(importItemNotes).toHaveBeenCalledWith(
				{ item: blochItem, notes: [sampleNote, sampleAnnot] },
				false,
				initSettings.notes,
				initSettings.annotations
			);
			expect(output).toEqual({
				citekey: "@blochImplementingSocialInterventions2021",
				page: { new: true, title: "@blochImplementingSocialInterventions2021", uid: existing_page_uid },
				success: true,
				notesImported: 2
			});
		});

		it("fails when the item has no notes or annotations", async () => {
			const tool = getTool(extensionAPI, "zotero-import-notes");

			await expect(tool.handler({ citekey: pintoItem.key }, toolContext()))
				.rejects.toThrow(/has no notes or annotations/);
			expect(importItemNotes).not.toHaveBeenCalled();
		});
	});
});
