import path from "node:path";
import YAML from "yaml";
import {
  lockSchema,
  vaultStateSchema,
  type LockFile,
  type VaultState,
} from "@vaultdesk/schema";
import { ensureDir, isFile, nowIso, readText, writeTextAtomic } from "../fsx.js";
import { loadVault } from "./model.js";
import type { CheckReport } from "../types.js";

export function vaultDir(vaultPath: string): string {
  return path.join(vaultPath, ".vault");
}

export function statePath(vaultPath: string): string {
  return path.join(vaultDir(vaultPath), "state.json");
}

export function lockPath(vaultPath: string): string {
  return path.join(vaultPath, "vault.lock");
}

export function ensureLocalStateDir(vaultPath: string): void {
  const dir = vaultDir(vaultPath);
  ensureDir(dir);
  writeTextAtomic(path.join(dir, ".gitignore"), "state.json\noperation.json\n");
}

export function readState(vaultPath: string): VaultState {
  const file = statePath(vaultPath);
  if (!isFile(file)) {
    return { schema: 1, sources: {}, targets: {} };
  }
  try {
    const parsed = vaultStateSchema.safeParse(JSON.parse(readText(file)));
    return parsed.success ? parsed.data : { schema: 1, sources: {}, targets: {} };
  } catch {
    return { schema: 1, sources: {}, targets: {} };
  }
}

export function writeState(vaultPath: string, state: VaultState): void {
  ensureLocalStateDir(vaultPath);
  writeTextAtomic(statePath(vaultPath), JSON.stringify(state, null, 2) + "\n");
}

export function readLock(vaultPath: string): LockFile | undefined {
  const file = lockPath(vaultPath);
  if (!isFile(file)) return undefined;
  try {
    const parsed = lockSchema.safeParse(YAML.parse(readText(file)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeLock(vaultPath: string, lock: LockFile): void {
  const ordered = {
    schema: 1,
    sources: Object.fromEntries(
      Object.entries(lock.sources)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entry]) => [
          name,
          {
            ...(entry.commit ? { commit: entry.commit } : {}),
            ...(entry.hash ? { hash: entry.hash } : {}),
            ...(entry.skills
              ? {
                  skills: Object.fromEntries(
                    Object.entries(entry.skills).sort(([a], [b]) => a.localeCompare(b)),
                  ),
                }
              : {}),
          },
        ]),
    ),
  };
  writeTextAtomic(lockPath(vaultPath), YAML.stringify(ordered, { lineWidth: 0 }));
}

export function recordCheck(vaultPath: string, report: CheckReport): void {
  const state = readState(vaultPath);
  state.last_checked_at = report.checkedAt;
  for (const result of report.results) {
    if (result.origin !== "github" || result.status === "local") continue;
    const entry = {
      ...state.sources[result.name],
      checked_at: report.checkedAt,
      status: result.status,
      ...(result.remoteCommit ? { remote_commit: result.remoteCommit } : {}),
    };
    if (result.status === "error" || result.status === "auth-failed") {
      entry.error = result.message ?? "Check failed.";
    } else {
      delete entry.error;
    }
    state.sources[result.name] = entry;
  }
  writeState(vaultPath, state);
}

export function recordSourceApplied(vaultPath: string, name: string): void {
  const state = readState(vaultPath);
  const stamp = nowIso();
  state.last_applied_at = stamp;
  state.sources[name] = { ...state.sources[name], applied_at: stamp };
  writeState(vaultPath, state);
}

export function recordTargetInstalled(
  vaultPath: string,
  targetId: string,
  hash: string,
  backupPath?: string,
): void {
  const state = readState(vaultPath);
  const stamp = nowIso();
  state.targets[targetId] = {
    last_installed_at: stamp,
    installed_hash: hash,
    ...(backupPath ? { backup_path: backupPath } : {}),
  };
  writeState(vaultPath, state);
}

export async function lockForVault(vaultPath: string): Promise<LockFile> {
  const snapshot = await loadVault(vaultPath);
  const sources: LockFile["sources"] = {};
  for (const source of snapshot.sources) {
    if (source.origin !== "github") continue;
    sources[source.name] = {
      commit: source.locked?.commit,
      hash: source.locked?.hash,
      skills: Object.fromEntries(source.skills.map((skill) => [skill.name, skill.contentHash])),
    };
  }
  return { schema: 1, sources };
}
