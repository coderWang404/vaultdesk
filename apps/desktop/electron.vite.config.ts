import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));
const coreSource = resolve(root, "../../packages/core/src/index.ts");
const schemaSource = resolve(root, "../../packages/schema/src/index.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@vaultdesk/core", "@vaultdesk/schema"] })],
    resolve: {
      alias: {
        "@vaultdesk/core": coreSource,
        "@vaultdesk/schema": schemaSource,
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/main/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/preload/index.ts") },
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [
      react(),
      {
        name: "vaultdesk-prod-csp",
        transformIndexHtml(html, ctx) {
          if (ctx.server) return html;
          const csp =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
          return html.replace(
            "<head>",
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
          );
        },
      },
    ],
    resolve: {
      alias: {
        "@renderer": resolve(root, "src/renderer/src"),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/renderer/index.html") },
      },
    },
  },
});
