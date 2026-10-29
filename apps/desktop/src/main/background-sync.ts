import fs from "node:fs";
import path from "node:path";
import { app, net, Notification, powerMonitor } from "electron";
import { autoSyncVault, readSettings, VaultDeskError } from "@vaultdesk/core";
import { readRecents } from "./recents.js";
import { AutoSyncScheduler, type SyncTrigger } from "./auto-sync-scheduler.js";
import { configureLaunchAgent } from "./launch-agent.js";

export interface AutoSyncActivity {
  at: string;
  trigger: SyncTrigger;
  vaultPath: string;
  vaultName: string;
  source: string;
  status: "updated" | "current" | "skipped" | "error" | "push-failed";
  message?: string;
  commit?: string;
  pendingSkills?: string[];
}

export interface AutoSyncRunSummary {
  checkedVaults: number;
  updated: number;
  errors: number;
  entries: AutoSyncActivity[];
}

function activityPath(): string {
  return path.join(app.getPath("userData"), "auto-sync-activity.jsonl");
}

function safeMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function appendActivity(entries: AutoSyncActivity[]): void {
  if (entries.length === 0) return;
  const file = activityPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", { mode: 0o600 });
}

export function readAutoSyncActivity(limit = 30): AutoSyncActivity[] {
  try {
    const lines = fs.readFileSync(activityPath(), "utf8").trim().split("\n");
    const recent: AutoSyncActivity[] = [];
    for (const line of lines.slice(-Math.max(1, Math.min(limit, 100)))) {
      try {
        const value = JSON.parse(line) as AutoSyncActivity;
        if (typeof value.vaultPath === "string" && typeof value.status === "string") recent.push(value);
      } catch { /* Ignore a partial append after a crash. */ }
    }
    return recent.reverse();
  } catch {
    return [];
  }
}

function validVaultPaths(only?: string): Array<{ path: string; name: string }> {
  if (only) return [{ path: only, name: path.basename(only) }];
  const seen = new Set<string>();
  return readRecents()
    .filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      try { return fs.statSync(entry.path).isDirectory(); } catch { return false; }
    })
    .map((entry) => ({ path: entry.path, name: entry.name }));
}

let lastAttentionSignature: string | null = null;

function notifyFailures(entries: AutoSyncActivity[]): void {
  const failures = entries.filter((entry) => entry.status === "error" || entry.status === "push-failed");
  const pending = entries.filter((entry) => entry.pendingSkills?.length);
  if (failures.length === 0 && pending.length === 0) {
    lastAttentionSignature = null;
    return;
  }
  const signature = JSON.stringify([
    ...failures.map((entry) => [entry.vaultPath, entry.source, entry.status, entry.message]),
    ...pending.map((entry) => [entry.vaultPath, entry.source, entry.pendingSkills]),
  ]);
  if (signature === lastAttentionSignature || !Notification.isSupported()) return;
  lastAttentionSignature = signature;
  const details = failures.slice(0, 2).map((entry) =>
    `${entry.vaultName}/${entry.source}${entry.message ? `：${entry.message}` : ""}`,
  ).join("；").slice(0, 250);
  new Notification({
    title: "VaultDesk 自动同步需处理",
    body: [
      failures.length > 0 ? `${failures.length} 项失败：${details}` : "",
      pending.length > 0 ? `${pending.length} 个来源有新技能待接纳：${pending.slice(0, 2).map((entry) => `${entry.vaultName}/${entry.source}`).join("、")}` : "",
    ].filter(Boolean).join("；") + "。打开 VaultDesk 查看活动记录。",
  }).show();
}

export async function runAutoSyncAll(
  onlyVaultPath?: string,
  trigger: SyncTrigger = "manual",
  showFailureNotification = false,
): Promise<AutoSyncRunSummary> {
  const settings = readSettings();
  const entries: AutoSyncActivity[] = [];
  const vaults = validVaultPaths(onlyVaultPath);
  let updated = 0;
  let errors = 0;
  for (const vault of vaults) {
    try {
      const report = await autoSyncVault(vault.path, {
        backupRoot: settings.backupRoot,
        retention: settings.backupRetention,
        retentionDays: settings.backupRetentionDays,
      });
      updated += report.updated;
      errors += report.errors;
      for (const source of report.sources) {
        entries.push({
          at: new Date().toISOString(), trigger,
          vaultPath: vault.path, vaultName: vault.name,
          source: source.name, status: source.status,
          ...(source.message ? { message: safeMessage(source.message) } : {}),
          ...(source.commit ? { commit: source.commit } : {}),
          ...(source.pendingSkills?.length ? { pendingSkills: source.pendingSkills } : {}),
        });
      }
    } catch (reason) {
      const legacy = reason instanceof VaultDeskError && reason.code === "not-writable-v1";
      if (!legacy) errors += 1;
      entries.push({
        at: new Date().toISOString(), trigger,
        vaultPath: vault.path, vaultName: vault.name,
        source: "仓库", status: legacy ? "skipped" : "error",
        message: legacy ? "v1 仓库尚未迁移，已跳过自动同步。" : safeMessage(reason),
      });
    }
  }
  appendActivity(entries);
  if (showFailureNotification) notifyFailures(entries);
  return { checkedVaults: vaults.length, updated, errors, entries };
}

/** A LaunchAgent keeps this headless process alive during the login session. */
export function startBackgroundWorker(): void {
  const scheduler = new AutoSyncScheduler(
    () => Math.max(1, readSettings().checkIntervalHours) * 3_600_000,
  );
  const attempt = (trigger: SyncTrigger): void => {
    const settings = readSettings();
    if (!settings.autoSyncEnabled || settings.checkIntervalHours === 0) {
      try { configureLaunchAgent(false); } catch (error) { console.error("Background disable failed", safeMessage(error)); }
      app.quit();
      return;
    }
    void scheduler.maybeRun(trigger, net.isOnline(), async () => {
      await runAutoSyncAll(undefined, trigger, true);
    }).catch((error) => console.error("Background sync failed", safeMessage(error)));
  };

  // Polling detects a network return within 15 seconds once an offline state
  // has been observed; hourly checks are still gated by AutoSyncScheduler.
  const timer = setInterval(() => attempt("poll"), 15_000);
  powerMonitor.on("resume", () => attempt("resume"));
  app.on("before-quit", () => clearInterval(timer));
  attempt("startup");
}
