import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "../packages/core/src/settings.js";

const files: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const file of files.splice(0)) fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

function legacySettings(checkIntervalHours: number): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdesk-settings-"));
  const file = path.join(directory, "settings.json");
  files.push(file);
  fs.writeFileSync(file, JSON.stringify({ checkIntervalHours, backupRetention: 10 }));
  vi.stubEnv("VAULTDESK_SETTINGS_FILE", file);
}

describe("background settings migration", () => {
  it("preserves an explicitly disabled legacy check", () => {
    legacySettings(0);
    expect(readSettings()).toMatchObject({ autoSyncEnabled: false, checkIntervalHours: 1 });
  });

  it("moves active legacy settings to hourly checks and 3-by-7 backups", () => {
    legacySettings(24);
    expect(readSettings()).toMatchObject({
      autoSyncEnabled: true, checkIntervalHours: 1, backupRetention: 3, backupRetentionDays: 7,
    });
  });
});
