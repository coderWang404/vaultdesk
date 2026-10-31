import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(packageRoot, "dist");
const source = path.join(dist, "bundled", "index.cjs");
const target = path.join(dist, "vaultdesk.cjs");

if (!fs.existsSync(source)) throw new Error(`CLI bundle is missing: ${source}`);
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
