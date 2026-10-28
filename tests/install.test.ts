import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireWriteLock,
  installSkills,
  openVault,
  planInstall,
  removeTarget,
  restoreBackup,
  validateVault,
  verifyTarget,
} from "@vaultdesk/core";
import { copyFixture, setTargetDest, tempDir } from "./helpers.js";

function scaffold() {
  const vaultPath = copyFixture("v2-basic");
  const dest = path.join(tempDir("install-dest"), "agents");
  const backupRoot = tempDir("install-backups");
  const external = path.join(tempDir("install-external"), "linked");
  setTargetDest(vaultPath, dest);
  fs.mkdirSync(path.join(dest, "local-notes"), { recursive: true });
  fs.writeFileSync(path.join(dest, "local-notes", "user-note.txt"), "user-owned\n");
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, "keep.txt"), "do not touch\n");
  fs.mkdirSync(dest, { recursive: true });
  fs.symlinkSync(external, path.join(dest, "gh-standalone"), "dir");
  return { vaultPath, dest, backupRoot, external };
}

describe("install slots and backups", () => {
  it("keeps shared directory slots owned by the target that registered them", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const file = path.join(vaultPath, "vault.yml");
    fs.writeFileSync(
      file,
      [
        "schema: 1",
        "name: v2-basic",
        "defaults:",
        "  ref: main",
        "  update_mode: review-before-apply",
        "targets:",
        "  - id: shared:notes",
        `    dest: ${dest}`,
        "    names:",
        "      - local-notes",
        "    install_after_update: false",
        "  - id: shared:standalone",
        `    dest: ${dest}`,
        "    names:",
        "      - gh-standalone",
        "    install_after_update: false",
        "",
      ].join("\n"),
      "utf8",
    );

    await installSkills(vaultPath, { names: ["local-notes"], dest, id: "shared:notes", backupRoot });
    await installSkills(vaultPath, { names: ["gh-standalone"], dest, id: "shared:standalone", backupRoot });

    const snapshot = await openVault(vaultPath);
    const notes = snapshot.targets.find((target) => target.id === "shared:notes");
    const standalone = snapshot.targets.find((target) => target.id === "shared:standalone");
    expect(notes?.installed.map((entry) => path.basename(entry.path))).toEqual(["local-notes"]);
    expect(notes?.otherManaged.map((entry) => path.basename(entry.path))).toEqual(["gh-standalone"]);
    expect(standalone?.installed.map((entry) => path.basename(entry.path))).toEqual(["gh-standalone"]);
    expect(standalone?.otherManaged.map((entry) => path.basename(entry.path))).toEqual(["local-notes"]);
    expect(snapshot.counts.managedInstalls).toBe(2);
  });

  it("classifies create, managed, symlink, and unmanaged slots", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const snapshot = await openVault(vaultPath);
    const plan = planInstall(snapshot, { names: ["local-notes", "gh-standalone", "gh-pack"], dest, id: "test-target", backupRoot });

    expect(plan.targetId).toBe("test-target");
    const bySkill = Object.fromEntries(plan.slots.map((slot) => [slot.skill, slot]));
    expect(bySkill["local-notes"]?.state).toBe("unmanaged");
    expect(bySkill["gh-standalone"]?.state).toBe("symlink");
    expect(bySkill["gh-pack-alpha"]?.state).toBe("create");
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("installs safely, verifies, reinstalls, restores, and removes", async () => {
    const { vaultPath, dest, backupRoot, external } = scaffold();
    const names = ["local-notes", "gh-standalone", "gh-pack"];

    const first = await installSkills(vaultPath, { names, dest, id: "test-target", backupRoot });
    expect(first.installed).toBe(4);
    expect(first.backups).toHaveLength(1);
    expect(first.verification).toMatchObject({ filesInPlace: true, checked: 4, missing: [], modified: [] });

    const backupOfNotes = first.backups[0];
    expect(backupOfNotes?.skill).toBe("local-notes");
    expect(fs.readFileSync(path.join(backupOfNotes?.to as string, "user-note.txt"), "utf8")).toBe("user-owned\n");
    expect(fs.existsSync(path.join(dest, "local-notes", ".vault-managed"))).toBe(true);
    expect(fs.lstatSync(path.join(dest, "gh-standalone")).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(external, "keep.txt"), "utf8")).toBe("do not touch\n");

    const snapshot = await openVault(vaultPath);
    expect(snapshot.targets.find((target) => target.id === "test-target")?.skills.sort()).toEqual([
      "gh-pack-alpha",
      "gh-pack-beta",
      "gh-standalone",
      "local-notes",
    ]);

    fs.writeFileSync(path.join(dest, "gh-pack-alpha", "SKILL.md"), "---\nname: gh-pack-alpha\ndescription: edited\n---\n");
    const modified = await verifyTarget(vaultPath, "test-target");
    expect(modified.filesInPlace).toBe(false);
    expect(modified.modified).toContain("gh-pack-alpha");

    const second = await installSkills(vaultPath, { names, dest, id: "test-target", backupRoot });
    expect(second.verification.filesInPlace).toBe(true);
    expect(second.backups).toHaveLength(0);

    const restored = await restoreBackup(vaultPath, {
      targetId: "test-target",
      backupPath: backupOfNotes?.to as string,
      name: "local-notes",
      backupRoot,
    });
    expect(restored.restored).toBe("local-notes");
    expect(fs.readFileSync(path.join(dest, "local-notes", "user-note.txt"), "utf8")).toBe("user-owned\n");
    expect((await verifyTarget(vaultPath, "test-target")).filesInPlace).toBe(true);

    const removed = await removeTarget(vaultPath, "test-target", { deleteFiles: true, backupRoot });
    expect(removed.removed).toBe("test-target");
    expect(removed.filesMoved).toHaveLength(4);
    for (const skill of ["local-notes", "gh-standalone", "gh-pack-alpha", "gh-pack-beta"]) {
      expect(fs.existsSync(path.join(dest, skill))).toBe(false);
    }
    expect(fs.readFileSync(path.join(external, "keep.txt"), "utf8")).toBe("do not touch\n");

    const after = await openVault(vaultPath);
    expect(after.targets.some((target) => target.id === "test-target")).toBe(false);
    expect((await validateVault(vaultPath)).ok).toBe(true);

    await expect(
      restoreBackup(vaultPath, {
        targetId: "test-target",
        backupPath: backupOfNotes?.to as string,
        name: "local-notes",
        backupRoot,
      }),
    ).rejects.toMatchObject({ code: "unknown-target" });
  });

  it("reuses an existing vault lock for update-triggered installs", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const lock = acquireWriteLock(vaultPath);
    try {
      const result = await installSkills(vaultPath, {
        names: ["local-notes"],
        dest,
        id: "locked-target",
        backupRoot,
        alreadyLocked: true,
      });
      expect(result.verification.filesInPlace).toBe(true);
    } finally {
      lock.release();
    }
  });

  it("treats symlinked vault paths as the same lock", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const link = path.join(tempDir("lock-link"), "vault");
    fs.symlinkSync(vaultPath, link, "dir");
    const previous = process.env.VAULTDESK_LOCK_DIR;
    process.env.VAULTDESK_LOCK_DIR = tempDir("lock-dir");
    try {
      const lock = acquireWriteLock(vaultPath);
      try {
        await expect(
          installSkills(link, { names: ["local-notes"], dest, id: "alias-target", backupRoot }),
        ).rejects.toMatchObject({ code: "conflict" });
      } finally {
        lock.release();
      }
      const result = await installSkills(link, { names: ["local-notes"], dest, id: "alias-target", backupRoot });
      expect(result.verification.filesInPlace).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VAULTDESK_LOCK_DIR;
      else process.env.VAULTDESK_LOCK_DIR = previous;
    }
  });

  it("keeps the destination outside the vault", async () => {
    const { vaultPath } = scaffold();
    const inside = path.join(vaultPath, "installed");
    const snapshot = await openVault(vaultPath);
    expect(() => planInstall(snapshot, { names: ["local-notes"], dest: inside })).toThrow(/inside the vault/);
  });
});
