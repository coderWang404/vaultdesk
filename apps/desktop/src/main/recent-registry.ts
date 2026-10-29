import path from "node:path";

export interface RecentVault {
  path: string;
  name: string;
  openedAt: string;
}

export function mergeRecent(existing: RecentVault[], vaultPath: string, name: string, openedAt: string): RecentVault[] {
  const resolved = path.resolve(vaultPath);
  // This registry drives background sync, so it must retain every enrolled vault.
  return [{ path: resolved, name, openedAt }, ...existing.filter((entry) => entry.path !== resolved)];
}
