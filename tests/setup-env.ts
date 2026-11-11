import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every default location VaultDesk writes outside a Vault is redirected to a
// throwaway directory. A test that forgets to pass its own paths then cannot
// touch the developer's real ~/.agents/skills, backups, locks, or settings.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdesk-test-home-"));
const defaults: Record<string, string> = {
  VAULTDESK_AGENTS_SKILLS_DIR: path.join(root, "agents-skills"),
  VAULTDESK_BACKUP_DIR: path.join(root, "backups"),
  VAULTDESK_LOCK_DIR: path.join(root, "locks"),
  VAULTDESK_CACHE_DIR: path.join(root, "cache"),
  VAULTDESK_SETTINGS_FILE: path.join(root, "settings.json"),
  VAULTDESK_AUTO_SYNC_PENDING_DIR: path.join(root, "auto-sync-pending"),
};
for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
