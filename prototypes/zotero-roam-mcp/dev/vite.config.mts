import { resolve } from "path";
import { defineConfig, PluginOption } from "vite";

import react from "@vitejs/plugin-react-swc";
import { viteExternalsPlugin } from "vite-plugin-externals";

import pkg from "../package.json";


// Adapted from upstream zotero-roam's dev/vite.config.mts: only the Roam
// developer-extension build is kept (upstream's roam/js and sandbox modes are
// dropped), targeting dist/ with no sourcemap per the roam-prototypes
// artifact contract.
export default defineConfig(() => {
	// These libraries are provided as globals by the Roam app; under vitest
	// they must resolve normally, since there is no Roam host page
	const extraPlugins: PluginOption[] = process.env.VITEST ? [] : [
		viteExternalsPlugin({
			"@blueprintjs/core": ["Blueprint", "Core"],
			"@blueprintjs/datetime": ["Blueprint", "DateTime"],
			"@blueprintjs/select": ["Blueprint", "Select"],
			"idb": "idb",
			"react": "React",
			"react-dom": "ReactDOM",
		}, { useWindow: true })
	];

	return {
		build: {
			target: "es2021",
			minify: true,
			sourcemap: false,
			outDir: "dist",
			emptyOutDir: true,
			copyPublicDir: false,
			chunkSizeWarningLimit: 3000,
			rollupOptions: {
				input: {
					"extension": resolve("src", "index")
				},
				output: {
					format: "es",
					assetFileNames: "extension.[ext]",
					entryFileNames: "[name].js"
				},
				preserveEntrySignatures: "allow-extension"
			}
		},
		resolve: {
			alias: {
				"@clients": resolve("src", "clients"),
				"@hooks": resolve("src", "hooks"),
				...(process.env.VITEST ? { "@services/roam": resolve("mocks", "roam.ts") } : {}),
				"@services": resolve("src", "services"),
				"Mocks": resolve("mocks"),
				"Components": resolve("src", "components"),
				"Styles": resolve("styles"),
				"Types": resolve("src", "types")
			}
		},
		plugins: [react(), ...extraPlugins],
		test: {
			alias: {
				"\.(css|sass)$": resolve("mocks", "style.ts")
			},
			clearMocks: true,
			define: {
				"PACKAGE_VERSION": pkg.version
			},
			environment: "jsdom",
			globals: true,
			setupFiles: ["dev/vitest.setup.js"],
			typecheck: {
				enabled: true
			}
		}
	};
});
