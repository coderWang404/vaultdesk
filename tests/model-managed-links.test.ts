import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { beginManagedDistribution, openVault } from "@vaultdesk/core";
import { copyFixture, setTargetDest, tempDir } from "./helpers.js";

describe("managed target snapshot", () => {
  it("counts a registered master link as an installed target", async () => {
    const vault = copyFixture("v2-basic");
    const root = tempDir("snapshot-links");
    const master = path.join(root, "agents", "skills");
    const dest = path.join(root, "codex", "skills");
    setTargetDest(vault, dest);
    const transaction = await beginManagedDistribution(vault, "local-notes", {
      agentsSkillsDir: master, backupRoot: path.join(root, "backups"),
    });
    transaction.finalize();
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(true);

    const target = (await openVault(vault)).targets.find((entry) => entry.id === "fixture-agents");
    expect(target?.installed.some((entry) => entry.path === path.join(dest, "local-notes"))).toBe(true);
    expect(target?.otherManaged.some((entry) => entry.path === path.join(dest, "local-notes"))).toBe(false);
  });
});
