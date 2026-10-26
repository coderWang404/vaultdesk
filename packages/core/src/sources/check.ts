import path from "node:path";
import { isFile, nowIso } from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { loadVault } from "../vault/model.js";
import { recordCheck } from "../vault/state.js";
import type { CheckReport, CheckResult } from "../types.js";
import { remoteFor } from "./fetch.js";
import { selectSources } from "./select.js";
import { gitLsRemote } from "../git.js";

export interface CheckOptions {
  names?: string[];
  persist?: boolean;
}

export async function checkSources(vaultPath: string, options: CheckOptions = {}): Promise<CheckReport> {
  const snapshot = await loadVault(vaultPath);
  const selected = selectSources(snapshot, options.names);
  const results: CheckResult[] = [];
  const warnings: string[] = [];

  const cache = new Map<string, { commit?: string; error?: VaultDeskError }>();
  for (const source of selected) {
    if (source.origin === "local") {
      results.push({
        name: source.name,
        origin: "local",
        status: "local",
        currentCommit: source.locked?.commit,
      });
      continue;
    }
    const key = `${remoteFor(source)}@${source.ref}`;
    let resolved = cache.get(key);
    if (!resolved) {
      try {
        const commit = await gitLsRemote(remoteFor(source), source.ref, vaultPath);
        resolved = { commit };
      } catch (error) {
        resolved = { error: error instanceof VaultDeskError ? error : new VaultDeskError("network", String(error)) };
      }
      cache.set(key, resolved);
    }
    const currentCommit = source.locked?.commit;
    if (resolved.error) {
      results.push({
        name: source.name,
        origin: "github",
        status: resolved.error.code === "auth-failed" ? "auth-failed" : "error",
        currentCommit,
        message: resolved.error.message,
      });
      warnings.push(`${source.name}: ${resolved.error.message}`);
      continue;
    }
    const remoteCommit = resolved.commit;
    let status: CheckResult["status"];
    if (!currentCommit) status = "not-downloaded";
    else if (currentCommit === remoteCommit) status = "current";
    else status = "update-available";
    results.push({
      name: source.name,
      origin: "github",
      status,
      currentCommit,
      remoteCommit,
    });
  }

  const report: CheckReport = { checkedAt: nowIso(), results, warnings };
  const canPersist =
    options.persist !== false &&
    snapshot.format === "v2" &&
    isFile(path.join(snapshot.path, ".vault", ".gitignore"));
  if (canPersist) {
    try {
      recordCheck(snapshot.path, report);
    } catch (error) {
      warnings.push(`Could not write local check state: ${(error as Error).message}`);
    }
  }
  return report;
}
