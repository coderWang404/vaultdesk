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
  /** Delay before the single retry of a failed network check. Tests pass 0. */
  retryDelayMs?: number;
}

const NETWORK_RETRY_DELAY_MS = 3_000;

const MAX_NETWORK_RETRIES_PER_CHECK = 3;

/**
 * A dropped connection is usually momentary, so a network failure gets one
 * more attempt. The budget keeps a real outage from doubling the whole check.
 */
async function lsRemoteWithRetry(
  remote: string, ref: string, cwd: string, delayMs: number, budget: { left: number },
): Promise<string> {
  try {
    return await gitLsRemote(remote, ref, cwd);
  } catch (error) {
    if (!(error instanceof VaultDeskError) || error.code !== "network" || budget.left <= 0) throw error;
    budget.left -= 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return gitLsRemote(remote, ref, cwd);
  }
}

export async function checkSources(vaultPath: string, options: CheckOptions = {}): Promise<CheckReport> {
  const snapshot = await loadVault(vaultPath);
  const selected = selectSources(snapshot, options.names);
  const results: CheckResult[] = [];
  const warnings: string[] = [];

  const cache = new Map<string, { commit?: string; error?: VaultDeskError }>();
  const retryBudget = { left: MAX_NETWORK_RETRIES_PER_CHECK };
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
        const commit = await lsRemoteWithRetry(remoteFor(source), source.ref, vaultPath, options.retryDelayMs ?? NETWORK_RETRY_DELAY_MS, retryBudget);
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
