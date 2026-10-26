import path from "node:path";
import { z } from "zod";
import { expandHome, isFile, readText, writeTextAtomic } from "./fsx.js";

export const appSettingsSchema = z.object({
  checkIntervalHours: z.number().int().min(0).max(720).default(24),
  backupRetention: z.number().int().min(1).max(100).default(10),
  backupRoot: z.string().optional(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  checkIntervalHours: 24,
  backupRetention: 10,
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
    const parsed = appSettingsSchema.safeParse(JSON.parse(readText(file)));
    return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: AppSettings): AppSettings {
  const parsed = appSettingsSchema.parse(settings);
  writeTextAtomic(settingsPath(), JSON.stringify(parsed, null, 2) + "\n");
  return parsed;
}
