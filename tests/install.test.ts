import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireWriteLock,
  backupRootFor,
  installSkills,
  listBackups,
  openVault,
  planInstall,
  readVaultFile,
  reinstallTargets,
  removeTarget,
  restoreBackup,
  validateVault,
  verifyTarget,
  writeVaultFile,
} from "@vaultdesk/core";
import { copyFixture, setTargetDest, snapshotTree, tempDir } from "./helpers.js";

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

function sameNamedSourceScaffold() {
  const context = scaffold();
  const { vaultPath } = context;
  const oldSource = path.join(vaultPath, "sources", "gh-pack.yml");
  const newSource = path.join(vaultPath, "sources", "gh-pack-alpha.yml");
  fs.writeFileSync(newSource, fs.readFileSync(oldSource, "utf8").replace(/^name: gh-pack$/m, "name: gh-pack-alpha"));
  fs.unlinkSync(oldSource);
  const lock = path.join(vaultPath, "vault.lock");
  fs.writeFileSync(lock, fs.readFileSync(lock, "utf8").replace(/^  gh-pack:$/m, "  gh-pack-alpha:"));
  const config = readVaultFile(vaultPath);
  for (const target of config.targets) {
    target.names = target.names.map((name) => name === "gh-pack" ? "gh-pack-alpha" : name);
  }
  writeVaultFile(vaultPath, config);
  return context;
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

  it("preserves an existing target's paused synchronization policy when reinstalling", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    await installSkills(vaultPath, { names: ["local-notes"], dest, id: "paused-target", backupRoot });
    const file = readVaultFile(vaultPath);
    const target = file.targets.find((entry) => entry.id === "paused-target")!;
    target.install_after_update = false;
    writeVaultFile(vaultPath, file);

    const result = await installSkills(vaultPath, { names: ["local-notes"], dest, id: "paused-target", backupRoot });

    expect(result.verification.filesInPlace).toBe(true);
    expect(readVaultFile(vaultPath).targets.find((entry) => entry.id === "paused-target")).toEqual(target);
    expect((await openVault(vaultPath)).targets.find((entry) => entry.id === "paused-target")?.installAfterUpdate).toBe(false);
  });

  it("rejects an existing target ID with a different destination before preview or writes", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const requestedDest = tempDir("conflicting-target-dest");
    fs.mkdirSync(path.join(requestedDest, "local-notes"));
    fs.writeFileSync(path.join(requestedDest, "local-notes", "user-note.txt"), "keep this directory\n");
    const vaultBefore = snapshotTree(vaultPath);
    const originalBefore = snapshotTree(dest);
    const requestedBefore = snapshotTree(requestedDest);
    const backupBefore = snapshotTree(backupRoot);
    const options = { names: ["local-notes"], dest: requestedDest, id: "fixture-agents", backupRoot };
    const snapshot = await openVault(vaultPath);

    expect(() => planInstall(snapshot, options)).toThrow(/already points at/);
    for (const dryRun of [true, false]) {
      await expect(installSkills(vaultPath, { ...options, dryRun })).rejects.toMatchObject({ code: "conflict" });
    }

    expect(snapshotTree(vaultPath)).toEqual(vaultBefore);
    expect(snapshotTree(dest)).toEqual(originalBefore);
    expect(snapshotTree(requestedDest)).toEqual(requestedBefore);
    expect(snapshotTree(backupRoot)).toEqual(backupBefore);
  });

  it("keeps an exact skill selection exact after installation and reload when its source has the same name", async () => {
    const { vaultPath, backupRoot } = sameNamedSourceScaffold();
    const config = readVaultFile(vaultPath);
    config.targets = [];
    writeVaultFile(vaultPath, config);
    const dest = tempDir("exact-skill-dest");
    const options = { names: ["gh-pack-alpha"], skillsOnly: true, dest, id: "exact-target", backupRoot };
    const preview = planInstall(await openVault(vaultPath), options);
    expect(preview.slots.map((slot) => slot.skill)).toEqual(["gh-pack-alpha"]);

    const result = await installSkills(vaultPath, options);
    expect(result.installed).toBe(1);
    expect(result.verification.filesInPlace).toBe(true);
    expect(fs.existsSync(path.join(dest, "gh-pack-beta"))).toBe(false);
    expect(readVaultFile(vaultPath).targets.find((target) => target.id === "exact-target")).toMatchObject({
      names: ["gh-pack-alpha"], skills_only: true,
    });
    expect((await openVault(vaultPath)).targets.find((target) => target.id === "exact-target")?.skills).toEqual(["gh-pack-alpha"]);
    const refreshed = await reinstallTargets(vaultPath, ["gh-pack-alpha"], { backupRoot });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.installed).toBe(1);
    expect(fs.existsSync(path.join(dest, "gh-pack-beta"))).toBe(false);
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("retains CLI source shorthand while adding its resolved skills to an existing exact target", async () => {
    const { vaultPath, backupRoot } = sameNamedSourceScaffold();
    const dest = tempDir("exact-cli-merge-dest");
    await installSkills(vaultPath, { names: ["gh-pack-alpha"], skillsOnly: true, dest, id: "exact-target", backupRoot });

    const legacyPlan = planInstall(await openVault(vaultPath), { names: ["gh-pack-alpha"], dest, id: "exact-target" });
    expect(legacyPlan.slots.map((slot) => slot.skill)).toEqual(["gh-pack-alpha", "gh-pack-beta"]);
    const added = await installSkills(vaultPath, { names: ["gh-pack-alpha"], dest, id: "exact-target", backupRoot });

    expect(added.installed).toBe(2);
    expect(added.verification.filesInPlace).toBe(true);
    expect(readVaultFile(vaultPath).targets.find((target) => target.id === "exact-target")).toMatchObject({
      names: ["gh-pack-alpha", "gh-pack-beta"], skills_only: true,
    });
    expect((await openVault(vaultPath)).targets.find((target) => target.id === "exact-target")?.skills).toEqual(["gh-pack-alpha", "gh-pack-beta"]);
  });

  it("preserves earlier source registrations when an exact selection is added to a legacy target", async () => {
    const { vaultPath, dest, backupRoot } = sameNamedSourceScaffold();
    const before = (await openVault(vaultPath)).targets.find((target) => target.id === "fixture-agents")!.skills;
    await installSkills(vaultPath, { names: ["gh-pack-alpha"], skillsOnly: true, dest, id: "fixture-agents", backupRoot });

    const target = (await openVault(vaultPath)).targets.find((entry) => entry.id === "fixture-agents")!;
    expect(target.skills).toEqual(before);
    expect(target.skillsOnly).toBe(true);
    expect(readVaultFile(vaultPath).targets.find((entry) => entry.id === "fixture-agents")!.names.slice().sort()).toEqual(before.slice().sort());
  });

  it("never overwrites a slot managed by another vault", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const slot = path.join(dest, "gh-pack-alpha");
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, "SKILL.md"), "foreign content\n");
    fs.writeFileSync(path.join(slot, ".vault-managed"), JSON.stringify({ vault: tempDir("foreign-vault"), skill: "gh-pack-alpha" }));
    const snapshot = await openVault(vaultPath);
    expect(() => planInstall(snapshot, { names: ["gh-pack-alpha"], dest, id: "test-target", backupRoot })).toThrow(/another vault/);
    await expect(installSkills(vaultPath, { names: ["gh-pack-alpha"], dest, id: "test-target", backupRoot })).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe("foreign content\n");
  });

  it("attributes a shared directory slot to the target that installed it", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    await installSkills(vaultPath, { names: ["local-notes"], dest, id: "new-target", backupRoot });
    const snapshot = await openVault(vaultPath);
    expect(snapshot.targets.find((target) => target.id === "fixture-agents")?.installed.filter((entry) => entry.managed)).toEqual([]);
    expect(snapshot.targets.find((target) => target.id === "new-target")?.installed).toHaveLength(1);
    expect(snapshot.counts.managedInstalls).toBe(1);
    await expect(installSkills(vaultPath, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot })).rejects.toMatchObject({ code: "conflict" });
    const removed = await removeTarget(vaultPath, "fixture-agents", { deleteFiles: true, backupRoot });
    expect(removed.filesMoved).toEqual([]);
    expect(fs.existsSync(path.join(dest, "local-notes", "SKILL.md"))).toBe(true);
  });

  it("records each target's own installed content hash", async () => {
    const { vaultPath, backupRoot } = scaffold();
    const root = tempDir("two-target-hashes");
    await installSkills(vaultPath, { names: ["local-notes"], dest: path.join(root, "notes"), id: "notes-target", backupRoot });
    await installSkills(vaultPath, { names: ["gh-standalone"], dest: path.join(root, "github"), id: "github-target", backupRoot });
    const snapshot = await openVault(vaultPath);
    const notesHash = snapshot.targets.find((target) => target.id === "notes-target")?.installedHash;
    const githubHash = snapshot.targets.find((target) => target.id === "github-target")?.installedHash;
    expect(notesHash).toMatch(/^sha256:/);
    expect(githubHash).toMatch(/^sha256:/);
    expect(notesHash).not.toBe(githubHash);
  });

  it("separates backup roots for target IDs that sanitize alike", async () => {
    const { vaultPath, backupRoot } = scaffold();
    const destinations = [tempDir("colon-target"), tempDir("underscore-target")];
    for (const dest of destinations) {
      fs.mkdirSync(path.join(dest, "local-notes"), { recursive: true });
      fs.writeFileSync(path.join(dest, "local-notes", "user.txt"), "original\n");
    }
    const first = await installSkills(vaultPath, { names: ["local-notes"], dest: destinations[0]!, id: "a:b", backupRoot });
    await installSkills(vaultPath, { names: ["local-notes"], dest: destinations[1]!, id: "a_b", backupRoot });
    expect(backupRootFor("a:b", backupRoot)).not.toBe(backupRootFor("a_b", backupRoot));
    expect(path.dirname(backupRootFor("..", backupRoot))).toBe(backupRoot);
    const firstBackup = first.backups[0]?.to;
    if (!firstBackup) throw new Error("Missing first backup");
    await expect(restoreBackup(vaultPath, { targetId: "a_b", backupPath: firstBackup, name: "local-notes", backupRoot })).rejects.toMatchObject({ code: "invalid-input" });
    const ambiguousLegacy = path.join(backupRoot, "a_b", "legacy-stamp", "local-notes");
    fs.mkdirSync(path.dirname(ambiguousLegacy), { recursive: true });
    fs.cpSync(firstBackup, ambiguousLegacy, { recursive: true });
    await expect(restoreBackup(vaultPath, { targetId: "a_b", backupPath: ambiguousLegacy, name: "local-notes", backupRoot })).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("continues to list and restore an unambiguous legacy backup", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const installed = await installSkills(vaultPath, { names: ["local-notes"], dest, id: "legacy-target", backupRoot });
    const original = installed.backups[0]?.to;
    if (!original) throw new Error("Missing fixture backup");
    const legacyPath = path.join(backupRoot, "legacy-target", "legacy-stamp", "local-notes");
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.cpSync(original, legacyPath, { recursive: true });
    expect((await listBackups("legacy-target", backupRoot)).some((entry) => entry.path === path.dirname(legacyPath))).toBe(true);
    expect((await restoreBackup(vaultPath, { targetId: "legacy-target", backupPath: legacyPath, name: "local-notes", backupRoot })).restored).toBe("local-notes");
  });

  it("restores only a named skill from its target's own backup tree", async () => {
    const { vaultPath, dest, backupRoot } = scaffold();
    const first = await installSkills(vaultPath, { names: ["local-notes"], dest, id: "test-target", backupRoot });
    const recordedBackup = first.backups[0]?.to;
    if (!recordedBackup) throw new Error("Missing fixture backup");
    const unrelated = path.join(tempDir("unrelated-backup"), "local-notes");
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, "SKILL.md"), "unrelated content\n");
    await expect(restoreBackup(vaultPath, { targetId: "test-target", backupPath: unrelated, name: "local-notes", backupRoot })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(restoreBackup(vaultPath, { targetId: "test-target", backupPath: recordedBackup, name: "gh-pack-alpha", backupRoot })).rejects.toMatchObject({ code: "invalid-input" });
    expect(fs.existsSync(path.join(dest, "gh-pack-alpha"))).toBe(false);
  });
});
