import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptMasterSkills, beginManagedDistribution, inspectManagedMaster, inspectManagedPluginTarget, installSkills, registerPluginTarget, removePluginTarget, removeTarget, verifyTarget } from "@vaultdesk/core";
import { copyFixture, setTargetDest, tempDir } from "./helpers.js";

function setup() {
  const vault = copyFixture("v2-basic");
  const root = fs.realpathSync(tempDir("distribution"));
  const master = path.join(root, "agents", "skills");
  const dest = path.join(root, "codex", "skills");
  const backupRoot = path.join(root, "backups");
  setTargetDest(vault, dest);
  return { vault, root, master, dest, backupRoot, options: { agentsSkillsDir: master, backupRoot } };
}

function updateSkill(vault: string, revision: string): void {
  fs.appendFileSync(path.join(vault, "skills", "local-notes", "SKILL.md"), "\n" + revision + "\n");
}

const originalAgentsRoot = process.env.VAULTDESK_AGENTS_SKILLS_DIR;
afterEach(() => {
  vi.restoreAllMocks();
  if (originalAgentsRoot === undefined) delete process.env.VAULTDESK_AGENTS_SKILLS_DIR;
  else process.env.VAULTDESK_AGENTS_SKILLS_DIR = originalAgentsRoot;
});

describe("managed distribution", () => {
  it("adopts an identical existing master while excluding generated cache", async () => {
    const { vault, master, options } = setup();
    const slot = path.join(master, "local-notes");
    fs.mkdirSync(master, { recursive: true });
    fs.cpSync(path.join(vault, "skills", "local-notes"), slot, { recursive: true });
    fs.mkdirSync(path.join(slot, "__pycache__"));
    fs.writeFileSync(path.join(slot, "__pycache__", "temp.pyc"), "generated");
    await expect(adoptMasterSkills(vault, ["missing"], options)).rejects.toMatchObject({ code: "unknown-skill" });
    expect(await adoptMasterSkills(vault, ["local-notes"], options)).toEqual(["local-notes"]);
    const marker = JSON.parse(fs.readFileSync(path.join(slot, ".vault-managed"), "utf8"));
    expect(marker).toMatchObject({ vault: fs.realpathSync(vault), skill: "local-notes", target_id: "agents-master" });
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    transaction.finalize();
    expect(fs.existsSync(path.join(slot, "__pycache__"))).toBe(false);
  });

  it("inspects a master without changing its files", async () => {
    const { vault, master, options } = setup();
    const slot = path.join(master, "local-notes");
    expect(inspectManagedMaster(vault, "local-notes", master)).toBe("missing");
    fs.mkdirSync(master, { recursive: true });
    fs.cpSync(path.join(vault, "skills", "local-notes"), slot, { recursive: true });
    expect(inspectManagedMaster(vault, "local-notes", master)).toBe("unmanaged");
    await adoptMasterSkills(vault, ["local-notes"], options);
    expect(inspectManagedMaster(vault, "local-notes", master)).toBe("current");
    fs.appendFileSync(path.join(slot, "SKILL.md"), "\nhand-edited\n");
    expect(inspectManagedMaster(vault, "local-notes", master)).toBe("modified");
  });

  it("migrates an owned legacy copy to a link and restores it on rollback", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    await installSkills(vault, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot: path.join(backupRoot, "legacy") });
    const slot = path.join(dest, "local-notes");
    const old = fs.readFileSync(path.join(slot, "SKILL.md"), "utf8");
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    updateSkill(vault, "upstream revision");
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    expect(transaction.changedPaths).toEqual([path.join(master, "local-notes"), slot]);
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toContain("upstream revision");
    transaction.rollback();
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe(old);
    expect(fs.existsSync(path.join(master, "local-notes"))).toBe(false);
    expect(fs.existsSync(path.join(backupRoot, "distribution", ".distribution.lock"))).toBe(false);
  });

  it("protects unmanaged names and manually modified masters", async () => {
    const { vault, master, dest, options } = setup();
    const slot = path.join(master, "local-notes");
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, "SKILL.md"), "mine\n");
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe("mine\n");
    fs.rmSync(slot, { recursive: true });
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    fs.writeFileSync(path.join(slot, "SKILL.md"), "hand edit\n");
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe("hand edit\n");
    fs.writeFileSync(path.join(slot, "SKILL.md"), fs.readFileSync(path.join(vault, "skills", "local-notes", "SKILL.md")));
    fs.unlinkSync(path.join(dest, "local-notes"));
    fs.mkdirSync(path.join(dest, "local-notes"));
    fs.writeFileSync(path.join(dest, "local-notes", "SKILL.md"), "unowned\n");
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(dest, "local-notes", "SKILL.md"), "utf8")).toBe("unowned\n");
  });

  it("rejects a hand-edited legacy managed copy without changing either location", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    await installSkills(vault, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot: path.join(backupRoot, "legacy") });
    const targetSkill = path.join(dest, "local-notes", "SKILL.md");
    fs.appendFileSync(targetSkill, "\nlocal customization\n");
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(targetSkill, "utf8")).toContain("local customization");
    expect(fs.existsSync(path.join(master, "local-notes"))).toBe(false);
  });

  it("migrates a legacy copy without target ID when registration is unique", async () => {
    const { vault, dest, backupRoot, options } = setup();
    await installSkills(vault, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot: path.join(backupRoot, "legacy") });
    const markerFile = path.join(dest, "local-notes", ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
    delete marker.target_id;
    fs.writeFileSync(markerFile, JSON.stringify(marker));
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(true);
    transaction.finalize();
  });

  it("rejects a legacy copy without target ID when two registrations claim its slot", async () => {
    const { vault, dest, backupRoot, options } = setup();
    await installSkills(vault, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot: path.join(backupRoot, "legacy") });
    const markerFile = path.join(dest, "local-notes", ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
    delete marker.target_id;
    fs.writeFileSync(markerFile, JSON.stringify(marker));
    fs.appendFileSync(path.join(vault, "vault.yml"),
      "  - id: another-agent\n    dest: " + dest + "\n    names: [local-notes]\n    install_after_update: true\n");
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(false);
  });

  it("does not copy a skill whose source root is a symbolic link", async () => {
    const { vault, root, master, options } = setup();
    const source = path.join(vault, "skills", "local-notes");
    const outside = path.join(root, "external-source");
    fs.cpSync(source, outside, { recursive: true });
    fs.rmSync(source, { recursive: true });
    fs.symlinkSync(outside, source);
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toMatchObject({ code: "path-escape" });
    expect(fs.existsSync(path.join(master, "local-notes"))).toBe(false);
  });

  it("copies a skill when the target cannot create symbolic links", async () => {
    const { vault, master, dest, options } = setup();
    const nativeSymlink = fs.symlinkSync;
    vi.spyOn(fs, "symlinkSync").mockImplementation((target, linkPath, type) => {
      if (String(target) === path.join(master, "local-notes")) {
        throw Object.assign(new Error("symlinks unsupported"), { code: "EPERM" });
      }
      return nativeSymlink(target, linkPath, type);
    });
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    const slot = path.join(dest, "local-notes");
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(slot, ".vault-managed"))).toBe(true);
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe(
      fs.readFileSync(path.join(master, "local-notes", "SKILL.md"), "utf8"),
    );
    transaction.finalize();
  });

  it("freezes a disabled symlink target before the master changes", async () => {
    const { vault, master, dest, options } = setup();
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    const slot = path.join(dest, "local-notes");
    const old = fs.readFileSync(path.join(slot, "SKILL.md"), "utf8");
    const config = path.join(vault, "vault.yml");
    fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace("install_after_update: true", "install_after_update: false"));
    updateSkill(vault, "new upstream content");
    const second = await beginManagedDistribution(vault, "local-notes", options);
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe(old);
    expect(fs.readFileSync(path.join(master, "local-notes", "SKILL.md"), "utf8")).toContain("new upstream content");
    second.finalize();
    const third = await beginManagedDistribution(vault, "local-notes", options);
    third.finalize();
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe(old);
  });

  it("leaves a hand-edited paused copy untouched while updating active targets", async () => {
    const { vault, dest, root, backupRoot, options } = setup();
    await installSkills(vault, {
      names: ["local-notes"], dest, id: "fixture-agents", backupRoot: path.join(backupRoot, "legacy"),
    });
    const paused = path.join(dest, "local-notes", "SKILL.md");
    fs.appendFileSync(paused, "\nprivate customization\n");
    const config = path.join(vault, "vault.yml");
    fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace("install_after_update: true", "install_after_update: false"));
    const activeDest = path.join(root, "claude", "skills");
    fs.appendFileSync(config, "  - id: active-agent\n    dest: " + activeDest + "\n    names: [local-notes]\n    install_after_update: true\n");
    updateSkill(vault, "new upstream content");
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    transaction.finalize();
    expect(fs.readFileSync(paused, "utf8")).toContain("private customization");
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(path.join(activeDest, "local-notes")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(activeDest, "local-notes", "SKILL.md"), "utf8")).toContain("new upstream content");
  });

  it("keeps linked targets valid across a manual reinstall into the master", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    process.env.VAULTDESK_AGENTS_SKILLS_DIR = master;
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    expect((await verifyTarget(vault, "fixture-agents")).modified).not.toContain("local-notes");
    const masterMarker = path.join(master, "local-notes", ".vault-managed");
    expect(JSON.parse(fs.readFileSync(masterMarker, "utf8")).targets).toHaveLength(1);

    const manual = await installSkills(vault, {
      names: ["local-notes"], dest: master, id: "manual-master", backupRoot: path.join(backupRoot, "manual"),
    });
    expect(manual.verification.filesInPlace).toBe(true);
    expect(JSON.parse(fs.readFileSync(masterMarker, "utf8")).targets).toMatchObject([
      { id: "fixture-agents", path: path.join(dest, "local-notes"), mode: "symlink" },
    ]);
    expect((await verifyTarget(vault, "fixture-agents")).modified).not.toContain("local-notes");

    updateSkill(vault, "later upstream revision");
    const second = await beginManagedDistribution(vault, "local-notes", options);
    expect(fs.readFileSync(path.join(dest, "local-notes", "SKILL.md"), "utf8")).toContain("later upstream revision");
    second.finalize();
    expect((await verifyTarget(vault, "fixture-agents")).modified).not.toContain("local-notes");
    expect((await verifyTarget(vault, "manual-master")).filesInPlace).toBe(true);
  });

  it("verifies shared master targets and never deletes the master on removal", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    process.env.VAULTDESK_AGENTS_SKILLS_DIR = master;
    fs.appendFileSync(path.join(vault, "vault.yml"),
      "  - id: agents-shared:local-notes\n    dest: " + master + "\n    names: [local-notes]\n    install_after_update: true\n");
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    transaction.finalize();
    expect((await verifyTarget(vault, "agents-shared:local-notes")).filesInPlace).toBe(true);
    const slot = path.join(master, "local-notes");
    const markerFile = path.join(slot, ".vault-managed");
    await removeTarget(vault, "agents-shared:local-notes", { deleteFiles: true, backupRoot });
    expect(fs.existsSync(path.join(slot, "SKILL.md"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(markerFile, "utf8")).targets).toMatchObject([
      { id: "fixture-agents", path: path.join(dest, "local-notes"), mode: "symlink" },
    ]);
    expect((await verifyTarget(vault, "fixture-agents")).modified).not.toContain("local-notes");
    updateSkill(vault, "revision after master target removal");
    const next = await beginManagedDistribution(vault, "local-notes", options);
    next.finalize();
    expect(fs.readFileSync(path.join(dest, "local-notes", "SKILL.md"), "utf8"))
      .toContain("revision after master target removal");
  });

  it("removes a managed link and its master record when uninstalling its target", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    process.env.VAULTDESK_AGENTS_SKILLS_DIR = master;
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    await removeTarget(vault, "fixture-agents", { deleteFiles: true, backupRoot });
    expect(fs.existsSync(path.join(dest, "local-notes"))).toBe(false);
    const markerFile = path.join(master, "local-notes", ".vault-managed");
    expect(JSON.parse(fs.readFileSync(markerFile, "utf8")).targets).toEqual([]);
    updateSkill(vault, "another revision");
    const second = await beginManagedDistribution(vault, "local-notes", options);
    second.finalize();
    expect(fs.existsSync(path.join(dest, "local-notes"))).toBe(false);
  });

  it("freezes a managed link when a target is unregistered but files are kept", async () => {
    const { vault, master, dest, options } = setup();
    process.env.VAULTDESK_AGENTS_SKILLS_DIR = master;
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    const slot = path.join(dest, "local-notes");
    const old = fs.readFileSync(path.join(slot, "SKILL.md"), "utf8");
    await removeTarget(vault, "fixture-agents", { deleteFiles: false });
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(slot, ".vault-managed"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(master, "local-notes", ".vault-managed"), "utf8")).targets).toEqual([]);
    updateSkill(vault, "another revision");
    const second = await beginManagedDistribution(vault, "local-notes", options);
    second.finalize();
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe(old);
  });

  it("rolls back every slot and releases its lock if a later target fails", async () => {
    const { vault, master, dest, root, backupRoot, options } = setup();
    const first = await beginManagedDistribution(vault, "local-notes", options);
    first.finalize();
    const secondDest = path.join(root, "claude", "skills");
    const secondSlot = path.join(secondDest, "local-notes");
    fs.appendFileSync(path.join(vault, "vault.yml"), "  - id: second-agent\n    dest: " + secondDest + "\n    names: [local-notes]\n    install_after_update: true\n");
    const old = fs.readFileSync(path.join(master, "local-notes", "SKILL.md"), "utf8");
    updateSkill(vault, "new revision");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === secondSlot) throw new Error("simulated target failure");
      return rename(from, to);
    });
    await expect(beginManagedDistribution(vault, "local-notes", options)).rejects.toThrow("simulated target failure");
    expect(fs.readFileSync(path.join(master, "local-notes", "SKILL.md"), "utf8")).toBe(old);
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(secondSlot)).toBe(false);
    expect(fs.existsSync(path.join(backupRoot, "distribution", ".distribution.lock"))).toBe(false);
  });

  it("updates only registered plugin targets and protects their edits", async () => {
    const vault = copyFixture("v2-plugins");
    const root = fs.realpathSync(tempDir("plugin-distribution"));
    const options = { agentsSkillsDir: path.join(root, "master"), backupRoot: path.join(root, "backups") };
    const noTarget = await beginManagedDistribution(vault, "claude-kit", options);
    expect(noTarget.changedPaths).toEqual([]);
    const dest = path.join(root, "plugin-target");
    await registerPluginTarget(vault, { id: "claude-plugins", dest, names: ["claude-kit"] });
    const transaction = await beginManagedDistribution(vault, "claude-kit", options);
    const slot = path.join(dest, "claude-kit");
    expect(transaction.changedPaths).toEqual([slot]);
    expect(fs.lstatSync(slot).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(slot, ".vaultdesk-plugin-managed"))).toBe(true);
    transaction.finalize();
    fs.writeFileSync(path.join(slot, "LICENSE"), "my edit\n");
    await expect(beginManagedDistribution(vault, "claude-kit", options)).rejects.toMatchObject({ code: "conflict" });
    await expect(removePluginTarget(vault, "claude-plugins", { deleteFiles: true, backupRoot: path.join(root, "backups") }))
      .rejects.toMatchObject({ code: "conflict" });
    const removed = await removePluginTarget(vault, "claude-plugins");
    expect(removed).toEqual({ removed: "claude-plugins", filesMoved: [] });
    expect(fs.readFileSync(path.join(slot, "LICENSE"), "utf8")).toBe("my edit\n");
  });

  it("reports plugin target drift even when the upstream is unchanged", async () => {
    const vault = copyFixture("v2-plugins");
    const root = fs.realpathSync(tempDir("plugin-drift"));
    const options = { agentsSkillsDir: path.join(root, "master"), backupRoot: path.join(root, "backups") };
    const dest = path.join(root, "plugin-target");
    await registerPluginTarget(vault, { id: "claude-plugins", dest, names: ["claude-kit"] });
    const transaction = await beginManagedDistribution(vault, "claude-kit", options);
    transaction.finalize();
    const slot = path.join(dest, "claude-kit");
    expect(inspectManagedPluginTarget(vault, "claude-kit", "claude-plugins", slot)).toBe("current");
    fs.writeFileSync(path.join(slot, "LICENSE"), "manual edit\n");
    expect(inspectManagedPluginTarget(vault, "claude-kit", "claude-plugins", slot)).toBe("modified");
    fs.rmSync(slot, { recursive: true, force: true });
    expect(inspectManagedPluginTarget(vault, "claude-kit", "claude-plugins", slot)).toBe("missing");
  });

  it("backs up an owned plugin target when explicitly removed", async () => {
    const vault = copyFixture("v2-plugins");
    const root = fs.realpathSync(tempDir("plugin-remove"));
    const options = { agentsSkillsDir: path.join(root, "master"), backupRoot: path.join(root, "backups") };
    const dest = path.join(root, "plugin-target");
    await registerPluginTarget(vault, { id: "claude-plugins", dest, names: ["claude-kit"] });
    const transaction = await beginManagedDistribution(vault, "claude-kit", options);
    transaction.finalize();
    const removed = await removePluginTarget(vault, "claude-plugins", { deleteFiles: true, backupRoot: options.backupRoot });
    expect(removed.removed).toBe("claude-plugins");
    expect(removed.filesMoved).toHaveLength(1);
    expect(fs.existsSync(path.join(dest, "claude-kit"))).toBe(false);
    expect(fs.existsSync(path.join(removed.filesMoved[0]!, ".vaultdesk-plugin-managed"))).toBe(true);
    await expect(removePluginTarget(vault, "claude-plugins")).rejects.toMatchObject({ code: "unknown-target" });
  });

  it("retains only the three most recent completed backups", async () => {
    const { vault, backupRoot, options } = setup();
    for (let index = 0; index < 5; index += 1) {
      updateSkill(vault, "revision " + index);
      const transaction = await beginManagedDistribution(vault, "local-notes", options);
      transaction.finalize();
    }
    const base = path.join(backupRoot, "distribution");
    const [vaultKey] = fs.readdirSync(base).filter((entry) => entry !== ".distribution.lock");
    expect(vaultKey).toBeDefined();
    expect(fs.readdirSync(path.join(base, vaultKey!))).toHaveLength(3);
  });
});
