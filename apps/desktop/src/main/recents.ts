import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { mergeRecent, type RecentVault } from "./recent-registry.js";

export type { RecentVault } from "./recent-registry.js";

function storePath(): string {
  return path.join(app.getPath("userData"), "recent-vaults.json");
}

export function readRecents(): RecentVault[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as { vaults?: RecentVault[] };
    return Array.isArray(raw.vaults)
      ? raw.vaults.filter(
          (entry): entry is RecentVault =>
            Boolean(entry) && typeof entry.path === "string" && typeof entry.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeRecents(vaults: RecentVault[]): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), `${JSON.stringify({ vaults }, null, 2)}\n`, "utf8");
}

export function addRecent(vaultPath: string, name: string): RecentVault[] {
  const vaults = mergeRecent(readRecents(), vaultPath, name, new Date().toISOString());
  writeRecents(vaults);
  return vaults;
}

export function removeRecent(vaultPath: string): RecentVault[] {
  const resolved = path.resolve(vaultPath);
  const vaults = readRecents().filter((entry) => entry.path !== resolved);
  writeRecents(vaults);
  return vaults;
}
