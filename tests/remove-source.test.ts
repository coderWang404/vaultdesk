import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkills, openVault, removeSource, validateVault } from "@vaultdesk/core";
import { copyFixture, setTargetDest, tempDir } from "./helpers.js";

describe("source removal", () => {
  it("removes metadata and workspace files but never touches installed copies", async () => {
    const vaultPath = copyFixture("v2-basic");
    const dest = path.join(tempDir("remove-dest"), "agents");
    const backupRoot = tempDir("remove-backups");
    setTargetDest(vaultPath, dest);
    const install = await installSkills(vaultPath, {
      names: ["local-notes", "gh-standalone"],
      dest,
      id: "remove-target",
      backupRoot,
    });
    expect(install.verification.filesInPlace).toBe(true);

    const result = await removeSource(vaultPath, "gh-standalone", { deleteFiles: true });
    expect(result.name).toBe("gh-standalone");
    expect(result.removedPaths.some((entry) => entry.endsWith(path.join("skills", "gh-standalone")))).toBe(true);
    expect(result.removedPaths.some((entry) => entry.endsWith(path.join("third_party", "gh-standalone")))).toBe(true);

    expect(fs.existsSync(path.join(vaultPath, "sources", "gh-standalone.yml"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "skills", "gh-standalone"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "third_party", "gh-standalone"))).toBe(false);

    const snapshot = await openVault(vaultPath);
    expect(snapshot.sources.map((source) => source.name).sort()).toEqual(["gh-pack", "local-notes"]);
    expect(snapshot.locked?.sources["gh-standalone"]).toBeUndefined();
    expect(snapshot.targets.find((target) => target.id === "remove-target")?.names).toEqual(["local-notes"]);
    expect(snapshot.targets.find((target) => target.id === "fixture-agents")?.names).not.toContain("gh-standalone");

    expect(fs.readFileSync(path.join(dest, "gh-standalone", "SKILL.md"), "utf8")).toContain("GH Standalone");
    expect(fs.existsSync(path.join(dest, "gh-standalone", ".vault-managed"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "local-notes", ".vault-managed"))).toBe(true);
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("prunes empty package and vendor directories", async () => {
    const vaultPath = copyFixture("v2-basic");
    const result = await removeSource(vaultPath, "gh-pack", { deleteFiles: true });

    expect(result.removedPaths.some((entry) => entry.endsWith(path.join("packages", "gh-pack")))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "packages", "gh-pack"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "third_party", "gh-pack"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "packages"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "third_party"))).toBe(true);
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("requires v2 and an existing source", async () => {
    const v1 = copyFixture("v1-basic");
    await expect(removeSource(v1, "local-notes")).rejects.toMatchObject({ code: "not-writable-v1" });

    const v2 = copyFixture("v2-basic");
    await expect(removeSource(v2, "missing")).rejects.toMatchObject({ code: "unknown-source" });
  });
});
