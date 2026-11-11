import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	accountId: "cf559e22e53a23bda9f802a1336cef99",
	worker: {
		name: "5w2h",
		compatibilityDate: "2026-11-10",
		entrypoint: "worker/index.ts",
		workersDev: true,
		previewUrls: false,
		observability: {
			enabled: true,
			headSamplingRate: 1,
		},
		assets: {
			notFoundHandling: "single-page-application",
		},
		env: {
			ACCESS_ISSUER: bindings.text("https://pedrobrown.cloudflareaccess.com"),
			ACCESS_AUD: bindings.text("fedc6c8d7fdc39578c9b164af47359d0c99b614d7941f1189da27d3accea4d6a"),
			DB: bindings.d1({
				name: "5w2h-finance",
				id: "91e1f490-e0c7-4738-b515-4a6f2b03c532",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
