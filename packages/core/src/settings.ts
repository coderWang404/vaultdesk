import path from "node:path";
import { z } from "zod";
import { expandHome, isFile, readText, writeTextAtomic } from "./fsx.js";

export const appSettingsSchema = z.object({
  autoSyncEnabled: z.boolean().default(true),
  checkIntervalHours: z.number().int().min(0).max(720).default(1),
  backupRetention: z.number().int().min(1).max(100).default(3),
  backupRetentionDays: z.number().int().min(1).max(365).default(7),
  backupRoot: z.string().optional(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  autoSyncEnabled: true,
  checkIntervalHours: 1,
  backupRetention: 3,
  backupRetentionDays: 7,
};

export function settingsPath(): string {
  return (
    process.env.VAULTDESK_SETTINGS_FILE ||
    path.join(expandHome("~/Library/Application Support/VaultDesk"), "settings.json")
  );
}

export function readSettings(): AppSettings {
  const file = settingsPath();
  if (!isFile(file)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(readText(file)) as Record<string, unknown>;
    const parsed = appSettingsSchema.safeParse(raw);
    if (!parsed.success) return { ...DEFAULT_SETTINGS };
    // Legacy checkIntervalHours described startup-only checks. Preserve its
    // explicit off state; migrate active installs to hourly background checks.
    if (!("autoSyncEnabled" in raw)) {
      return {
        ...parsed.data,
        autoSyncEnabled: parsed.data.checkIntervalHours > 0,
        checkIntervalHours: 1,
        backupRetention: 3,
      };
    }
    return parsed.data;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: AppSettings): AppSettings {
  const parsed = appSettingsSchema.parse(settings);
  writeTextAtomic(settingsPath(), JSON.stringify(parsed, null, 2) + "\n");
  return parsed;
}
