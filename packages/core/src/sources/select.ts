import path from "node:path";
import os from "node:os";
import { VaultDeskError } from "../errors.js";
import type { SourceRecord, VaultSnapshot } from "../types.js";

export function cacheRoot(): string {
  return process.env.VAULTDESK_CACHE_DIR || path.join(os.homedir(), "Library", "Caches", "VaultDesk");
}

export function selectSources(snapshot: VaultSnapshot, names?: string[]): SourceRecord[] {
  if (!names || names.length === 0) return [...snapshot.sources].sort((a, b) => a.name.localeCompare(b.name));
  const selected = new Map<string, SourceRecord>();
  for (const name of names) {
    const source =
      snapshot.sources.find((entry) => entry.name === name) ??
      snapshot.sources.find((entry) => entry.skills.some((skill) => skill.name === name));
    if (!source) {
      throw new VaultDeskError("unknown-source", `Unknown source or skill: ${name}`, { details: { name } });
    }
    selected.set(source.name, source);
  }
  return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSource(snapshot: VaultSnapshot, name: string): SourceRecord {
  const [source] = selectSources(snapshot, [name]);
  if (!source) throw new VaultDeskError("unknown-source", `Unknown source: ${name}`);
  return source;
}
