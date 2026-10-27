import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const source = path.join(repoRoot, "agent-skill");
const target = path.join(packageRoot, "dist", "agent-skill");

if (!fs.existsSync(path.join(source, "vaultdesk", "SKILL.md"))) {
  throw new Error(`Bundled agent skill source is missing: ${source}`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
