import { defineConfig } from "tsup";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist/bundled",
  clean: false,
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  outExtension: () => ({ js: ".cjs" }),
  sourcemap: false,
  define: {
    __VAULTDESK_VERSION__: JSON.stringify(packageJson.version),
    "import.meta.url": "__VAULTDESK_MODULE_URL__",
  },
  banner: { js: '#!/usr/bin/env node\nconst __VAULTDESK_MODULE_URL__ = require("node:url").pathToFileURL(__filename).href;' },
});
