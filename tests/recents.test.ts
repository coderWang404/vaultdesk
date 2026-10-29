import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeRecent } from "../apps/desktop/src/main/recent-registry.js";

describe("registered vaults", () => {
  it("keeps every enrolled vault for background sync, beyond the former 12-item cap", () => {
    let entries: ReturnType<typeof mergeRecent> = [];
    for (let index = 0; index < 16; index += 1) {
      entries = mergeRecent(entries, path.join("/tmp/vaultdesk", `vault-${index}`), `Vault ${index}`, "2026-10-30");
    }
    expect(entries).toHaveLength(16);
    expect(entries.map((entry) => entry.name)).toContain("Vault 0");
    entries = mergeRecent(entries, "/tmp/vaultdesk/vault-0", "Vault 0", "2026-10-31");
    expect(entries).toHaveLength(16);
    expect(entries[0]?.name).toBe("Vault 0");
  });
});
