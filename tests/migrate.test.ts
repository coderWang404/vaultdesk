import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigration, openVault, planMigration, validateVault } from "@vaultdesk/core";
import { copyFixture, git, initGitRepo, repoRoot, snapshotTree, tempDir } from "./helpers.js";

describe("v1 to v2 migration", () => {
  it("produces a deterministic preview and writes nothing", async () => {
    const vaultPath = copyFixture("v1-basic");
    initGitRepo(vaultPath);
    const before = snapshotTree(vaultPath);

    const first = await planMigration(vaultPath);
    const second = await planMigration(vaultPath);

    expect(first.writes).toEqual(second.writes);
    expect(first.deletes).toEqual(second.deletes);
    expect(first.diff).toEqual(second.diff);
    expect(first.cleanWorktree).toBe(true);
    expect(first.skillCount).toBe(6);
    expect(first.sourceCount).toBe(4);
    expect(first.deletes).toEqual([
      "install-targets.yml",
      "packages/collection-pack/package.yml",
      "packages/suite-pack/package.yml",
      "sources.yml",
    ]);
    expect(first.writes.map((write) => write.path)).toEqual([
      ".vault/.gitignore",
      "sources/collection-pack.yml",
      "sources/gh-standalone.yml",
      "sources/local-notes.yml",
      "sources/suite-pack.yml",
      "vault.lock",
      "vault.yml",
    ]);
    expect(first.diff).toContain("+name: suite-pack");
    const golden = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tests", "golden", "v1-to-v2.json"), "utf8"),
    ) as { writes: unknown; deletes: unknown; diff: string };
    expect({ writes: first.writes, deletes: first.deletes, diff: first.diff }).toEqual(golden);
    expect(snapshotTree(vaultPath)).toEqual(before);
    expect(git(vaultPath, ["status", "--porcelain"])).toBe("");
  });

  it("applies on a vault-v2 branch, validates, and commits only metadata", async () => {
    const vaultPath = copyFixture("v1-basic");
    initGitRepo(vaultPath);

    const result = await applyMigration(vaultPath);

    expect(result.branch).toBe("vault-v2");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.validation.ok).toBe(true);
    expect(git(vaultPath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("vault-v2");
    expect(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim()).toBe("chore: migrate vault metadata to v2");

    for (const deleted of result.plan.deletes) {
      expect(fs.existsSync(path.join(vaultPath, deleted))).toBe(false);
    }
    for (const written of result.plan.writes) {
      expect(fs.existsSync(path.join(vaultPath, written.path))).toBe(true);
    }

    const snapshot = await openVault(vaultPath);
    expect(snapshot.format).toBe("v2");
    expect(snapshot.counts).toMatchObject({ sources: 4, skills: 6, targets: 1 });
    expect(snapshot.targets[0]?.names.sort()).toEqual(["gh-standalone", "local-notes", "suite-pack"]);
    expect(snapshot.sources.find((source) => source.name === "suite-pack")?.entrypoint).toBe("suite-main");

    const changed = git(vaultPath, ["show", "--name-status", "--no-renames", "--pretty=format:", "HEAD"])
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^[A-Z]\s+/, ""))
      .sort();
    expect(changed).toEqual([...result.plan.writes.map((write) => write.path), ...result.plan.deletes].sort());
    expect(changed.some((entry) => entry.startsWith("build/"))).toBe(false);
    expect(changed).not.toContain("skills/local-notes/SKILL.md");
  });

  it("refuses to apply when the worktree is dirty", async () => {
    const vaultPath = copyFixture("v1-basic");
    initGitRepo(vaultPath);
    fs.writeFileSync(path.join(vaultPath, "README.md"), "changed\n");

    await expect(applyMigration(vaultPath)).rejects.toMatchObject({ code: "git-not-clean" });
    expect(git(vaultPath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
  });

  it("refuses to migrate a v2 vault and resists a second apply", async () => {
    const v2 = copyFixture("v2-basic");
    await expect(planMigration(v2)).rejects.toMatchObject({ code: "unsupported" });

    const v1 = copyFixture("v1-basic");
    initGitRepo(v1);
    await applyMigration(v1);
    await expect(applyMigration(v1)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("creates a new vault with a clean v2 layout", async () => {
    const { initVault, openVault: open } = await import("@vaultdesk/core");
    const vaultPath = path.join(tempDir("init"), "Fresh Vault");
    const result = await initVault(vaultPath, { name: "fresh", git: true });
    expect(result.gitInitialized).toBe(true);
    const snapshot = await open(vaultPath);
    expect(snapshot.name).toBe("fresh");
    expect(snapshot.format).toBe("v2");
    expect(snapshot.counts).toMatchObject({ sources: 0, skills: 0, targets: 0 });
    expect((await validateVault(vaultPath)).ok).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, ".vault", ".gitignore"))).toBe(true);
  });
});
