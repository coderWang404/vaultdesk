import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { canonicalPath, exists, expandHome, hashDirectory, isInside, nowIso, timestampSlug, movePath, listDirectory, removePath } from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import type { VaultFile } from "@vaultdesk/schema";
import type { InstalledSkill, InstallPlan, InstallResult, InstallSlotPlan, SkillRecord, TargetRecord, VaultSnapshot } from "./types.js";
import { loadVault } from "./vault/model.js";
import { openVault } from "./vault/validate.js";
import { buildSnapshot } from "./build.js";
import { readVaultFile, writeVaultFile } from "./vault/config.js";
import { withWriteLock } from "./vault/lockfile.js";
import { Journal } from "./journal.js";
import { recordTargetInstalled, writeState, readState } from "./vault/state.js";

const MARKER = ".vault-managed";

export interface InstallOptions {
  names: string[];
  dest: string;
  id?: string;
  dryRun?: boolean;
  register?: boolean;
  backupRoot?: string;
  retention?: number;
  rebuild?: boolean;
}

export interface BackupEntry {
  targetId: string;
  timestamp: string;
  path: string;
  skills: string[];
}

export function defaultBackupBase(): string {
  return process.env.VAULTDESK_BACKUP_DIR || path.join(expandHome("~/Library/Application Support/VaultDesk"), "backups");
}

export function backupRootFor(targetId: string, base?: string): string {
  const safe = targetId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(base || defaultBackupBase(), safe);
}

function resolveSkills(snapshot: VaultSnapshot, names: string[]): SkillRecord[] {
  const selected = new Map<string, SkillRecord>();
  for (const name of names) {
    const source = snapshot.sources.find((entry) => entry.name === name);
    if (source) {
      for (const skill of source.skills) selected.set(skill.name, skill);
      continue;
    }
    const skill = snapshot.skills.find((entry) => entry.name === name);
    if (skill) {
      selected.set(skill.name, skill);
      continue;
    }
    throw new VaultDeskError("unknown-source", `Unknown source or skill: ${name}`);
  }
  if (selected.size === 0) {
    throw new VaultDeskError("unknown-source", `No skills resolved from: ${names.join(", ")}`);
  }
  return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function slotState(slotPath: string): { state: InstallSlotPlan["state"]; linkTarget?: string } {
  if (!exists(slotPath) && !isSymlink(slotPath)) return { state: "create" };
  if (isSymlink(slotPath)) return { state: "symlink", linkTarget: fs.readlinkSync(slotPath) };
  if (fs.statSync(slotPath).isDirectory() && fs.existsSync(path.join(slotPath, MARKER))) return { state: "managed" };
  return { state: "unmanaged" };
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function validateDest(vaultPath: string, dest: string): string {
  if (!dest.startsWith("/") && dest !== "~" && !dest.startsWith("~/")) {
    throw new VaultDeskError("invalid-input", `Install destination must be absolute or start with ~/: ${dest}`);
  }
  const expanded = canonicalPath(expandHome(dest));
  if (!path.isAbsolute(expanded)) {
    throw new VaultDeskError("invalid-input", `Install destination is not absolute: ${dest}`);
  }
  if (isInside(expanded, vaultPath)) {
    throw new VaultDeskError("path-escape", `Refusing to install inside the vault: ${dest}`);
  }
  return expanded;
}

export function planInstall(
  snapshot: VaultSnapshot,
  input: { names: string[]; dest: string; id?: string; backupRoot?: string },
): InstallPlan {
  const vaultPath = snapshot.path;
  const dest = validateDest(vaultPath, input.dest);
  const targetId = input.id || `target:${input.names.join("+")}`;
  const backupRoot = backupRootFor(targetId, input.backupRoot);
  const skills = resolveSkills(snapshot, input.names);
  const stamp = timestampSlug();
  const slots: InstallSlotPlan[] = [];
  const warnings: string[] = [];

  for (const skill of skills) {
    const slot = path.join(dest, skill.name);
    const current = slotState(slot);
    if (current.state === "managed") {
      slots.push({ skill: skill.name, slot, state: "managed", action: "replace-managed" });
    } else if (current.state === "symlink") {
      slots.push({
        skill: skill.name,
        slot,
        state: "symlink",
        action: "replace-symlink",
        linkTarget: current.linkTarget,
      });
    } else if (current.state === "unmanaged") {
      slots.push({
        skill: skill.name,
        slot,
        state: "unmanaged",
        action: "backup-and-replace",
        backupPath: path.join(backupRoot, stamp, skill.name),
      });
    } else {
      slots.push({ skill: skill.name, slot, state: "create", action: "create" });
    }
  }

  if (slots.some((slot) => slot.state === "unmanaged")) {
    warnings.push("Existing unmanaged directories will be moved to the backup root before install.");
  }

  return { targetId, dest, slots, warnings };
}

function planPrune(backupRoot: string, retention: number): void {
  const dirs = listDirectory(backupRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const excess = dirs.length - retention;
  for (let index = 0; index < excess; index += 1) {
    const name = dirs[index];
    if (name) removePath(path.join(backupRoot, name));
  }
}

function ensureRegistered(snapshot: VaultSnapshot, targetId: string, dest: string, names: string[]): void {
  const file = readVaultFile(snapshot.path);
  const existing = file.targets.find((target) => target.id === targetId);
  if (existing) {
    if (canonicalPath(expandHome(existing.dest)) !== canonicalPath(expandHome(dest))) {
      throw new VaultDeskError("conflict", `Target ${targetId} already points at ${existing.dest}`);
    }
    const merged = [...new Set([...existing.names, ...names])];
    existing.names = merged;
    existing.install_after_update = true;
  } else {
    file.targets.push({ id: targetId, dest, names: [...names], install_after_update: true });
  }
  writeVaultFile(snapshot.path, file);
}

export async function installSkills(inputPath: string, options: InstallOptions): Promise<InstallResult> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") {
    throw new VaultDeskError("not-writable-v1", "Install requires a v2 vault. Migrate this vault first.");
  }
  if (snapshot.issues.some((issue) => issue.severity === "error")) {
    throw new VaultDeskError("validation-failed", "Fix validation errors before installing.", {
      details: snapshot.issues.filter((issue) => issue.severity === "error"),
    });
  }
  const plan = planInstall(snapshot, options);
  if (options.dryRun) {
    return {
      targetId: plan.targetId,
      dest: plan.dest,
      installed: 0,
      plan,
      backups: [],
      verification: {
        targetId: plan.targetId,
        filesInPlace: false,
        checked: 0,
        missing: [],
        modified: [],
        unmanagedByTarget: [],
      },
    };
  }

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "install", [
      { id: "build", label: "Build skills" },
      { id: "install", label: "Copy skills into destination" },
      { id: "register", label: "Register install target" },
      { id: "verify", label: "Verify installed files" },
    ]);
    try {
      const fresh = await openVault(vaultPath);
      const freshPlan = planInstall(fresh, options);
      let buildHashes: Record<string, string>;
      if (options.rebuild === false) {
        buildHashes = {};
        for (const skill of resolveSkills(fresh, options.names)) {
          buildHashes[skill.name] = hashDirectory(path.join(vaultPath, "build", "skills", skill.name));
        }
      } else {
        journal.start("build");
        const build = buildSnapshot(fresh);
        buildHashes = build.hashes;
        journal.done("build", `${build.skills.length} skills`);
      }

      journal.start("install");
      fs.mkdirSync(freshPlan.dest, { recursive: true });
      const backups: InstallResult["backups"] = [];
      let installed = 0;
      for (const slot of freshPlan.slots) {
        const artifact = path.join(vaultPath, "build", "skills", slot.skill);
        if (!fs.existsSync(path.join(artifact, "SKILL.md"))) {
          throw new VaultDeskError("source-not-found", `Built artifact missing for ${slot.skill}`);
        }
        switch (slot.action) {
          case "replace-symlink":
            fs.unlinkSync(slot.slot);
            break;
          case "replace-managed":
            removePath(slot.slot);
            break;
          case "backup-and-replace": {
            if (!slot.backupPath) throw new VaultDeskError("operation-failed", "Backup path missing");
            movePath(slot.slot, slot.backupPath);
            backups.push({ skill: slot.skill, from: slot.slot, to: slot.backupPath });
            break;
          }
          case "create":
            break;
        }
        fs.cpSync(artifact, slot.slot, { recursive: true, dereference: false });
        const installedAt = nowIso();
        const hash = buildHashes[slot.skill] ?? hashDirectory(slot.slot);
        fs.writeFileSync(
          path.join(slot.slot, MARKER),
          JSON.stringify({ vault: vaultPath, skill: slot.skill, installed_at: installedAt, hash }, null, 2) + "\n",
          "utf8",
        );
        installed += 1;
      }
      journal.done("install", `${installed} skills`);

      if (options.register !== false) {
        journal.start("register");
        ensureRegistered(fresh, freshPlan.targetId, options.dest, options.names);
        journal.done("register", freshPlan.targetId);
      } else {
        journal.skipped("register");
      }

      const retention = options.retention ?? 10;
      if (backups.length > 0) {
        planPrune(backupRootFor(freshPlan.targetId, options.backupRoot), retention);
      }

      const targetHash = `sha256:${createHash("sha256")
        .update(
          Object.entries(buildHashes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, hash]) => `${name}:${hash}`)
            .join("|"),
        )
        .digest("hex")}`;
      recordTargetInstalled(
        vaultPath,
        freshPlan.targetId,
        targetHash,
        backups[0]?.to ? path.dirname(path.dirname(backups[0].to)) : undefined,
      );

      journal.start("verify");
      const verification = verifyTargetRecord(await loadVault(vaultPath), freshPlan.targetId);
      journal.done("verify", verification.filesInPlace ? "files in place" : "verification found differences");
      journal.finish();

      return {
        targetId: freshPlan.targetId,
        dest: freshPlan.dest,
        installed,
        plan: freshPlan,
        backups,
        verification,
      };
    } catch (error) {
      journal.fail("failed", (error as Error).message);
      throw error;
    }
  });
}

export function verifyTargetRecord(snapshot: VaultSnapshot, targetId: string): InstallResult["verification"] {
  const target = snapshot.targets.find((entry) => entry.id === targetId);
  if (!target) {
    throw new VaultDeskError("unknown-target", `Unknown install target: ${targetId}`);
  }
  const missing: string[] = [];
  const modified: string[] = [];
  const unmanagedByTarget: string[] = [];
  let checked = 0;

  for (const skillName of target.skills) {
    const slot = path.join(target.expandedDest, skillName);
    checked += 1;
    if (!exists(slot) && !isSymlink(slot)) {
      missing.push(skillName);
      continue;
    }
    const markerPath = path.join(slot, MARKER);
    if (!fs.existsSync(markerPath)) {
      modified.push(skillName);
      continue;
    }
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { vault?: string; hash?: string };
      const sameVault = marker.vault ? canonicalPath(marker.vault) === canonicalPath(snapshot.path) : false;
      if (!sameVault) {
        modified.push(skillName);
        continue;
      }
      if (marker.hash && hashDirectory(slot) !== marker.hash) {
        modified.push(skillName);
      }
    } catch {
      modified.push(skillName);
    }
  }

  for (const entry of target.installed) {
    if (entry.managedByThisVault && !target.skills.includes(path.basename(entry.path))) {
      unmanagedByTarget.push(path.basename(entry.path));
    }
  }

  return {
    targetId,
    filesInPlace: missing.length === 0 && modified.length === 0,
    checked,
    missing,
    modified,
    unmanagedByTarget,
  };
}

export async function verifyTarget(inputPath: string, targetId: string): Promise<InstallResult["verification"]> {
  const snapshot = await loadVault(inputPath);
  return verifyTargetRecord(snapshot, targetId);
}

export async function removeTarget(
  inputPath: string,
  targetId: string,
  options: { deleteFiles?: boolean; backupRoot?: string; retention?: number } = {},
): Promise<{ removed: string; backupPath?: string; filesMoved: string[] }> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault first.");
  const target = snapshot.targets.find((entry) => entry.id === targetId);
  if (!target) throw new VaultDeskError("unknown-target", `Unknown install target: ${targetId}`);

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "remove", [
      { id: "files", label: "Move managed files to backup" },
      { id: "unregister", label: "Remove target registration" },
    ]);
    const filesMoved: string[] = [];
    let backupPath: string | undefined;
    try {
      if (options.deleteFiles) {
        journal.start("files");
        const stamp = timestampSlug();
        for (const skillName of target.skills) {
          const slot = path.join(target.expandedDest, skillName);
          if (!fs.existsSync(slot) && !isSymlink(slot)) continue;
          const markerPath = path.join(slot, MARKER);
          if (!fs.existsSync(markerPath)) continue;
          let marker: { vault?: string };
          try {
            marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as { vault?: string };
          } catch {
            continue;
          }
          if (!marker.vault || canonicalPath(marker.vault) !== vaultPath) continue;
          const destination = path.join(
            backupRootFor(targetId, options.backupRoot),
            `${stamp}-removed`,
            skillName,
          );
          movePath(slot, destination);
          filesMoved.push(destination);
        }
        backupPath = filesMoved[0] ? path.dirname(filesMoved[0]) : undefined;
        journal.done("files", `${filesMoved.length} moved`);
      } else {
        journal.skipped("files");
      }

      journal.start("unregister");
      const file = readVaultFile(vaultPath);
      file.targets = file.targets.filter((entry) => entry.id !== targetId);
      writeVaultFile(vaultPath, file);
      const state = readState(vaultPath);
      delete state.targets[targetId];
      writeState(vaultPath, state);
      journal.done("unregister");
      journal.finish();
      if (options.retention) planPrune(backupRootFor(targetId, options.backupRoot), options.retention);
      return { removed: targetId, backupPath, filesMoved };
    } catch (error) {
      journal.fail("failed", (error as Error).message);
      throw error;
    }
  });
}

export async function restoreBackup(
  inputPath: string,
  options: { targetId: string; backupPath: string; name: string; backupRoot?: string; retention?: number },
): Promise<{ restored: string; previousBackup?: string }> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault first.");
  const target = snapshot.targets.find((entry) => entry.id === options.targetId);
  if (!target) throw new VaultDeskError("unknown-target", `Unknown install target: ${options.targetId}`);
  const source = canonicalPath(options.backupPath);
  if (!exists(source)) throw new VaultDeskError("source-not-found", `Backup path does not exist: ${options.backupPath}`);

  return withWriteLock(vaultPath, async () => {
    const slot = path.join(target.expandedDest, options.name);
    let previousBackup: string | undefined;
    if (exists(slot) || isSymlink(slot)) {
      if (isSymlink(slot)) {
        fs.unlinkSync(slot);
      } else if (fs.existsSync(path.join(slot, MARKER))) {
        previousBackup = path.join(
          backupRootFor(options.targetId, options.backupRoot),
          `${timestampSlug()}-replaced`,
          options.name,
        );
        movePath(slot, previousBackup);
      } else {
        throw new VaultDeskError("conflict", `Refusing to overwrite an unmanaged directory: ${slot}`);
      }
    }
    fs.mkdirSync(path.dirname(slot), { recursive: true });
    fs.cpSync(source, slot, { recursive: true, dereference: false });
    fs.writeFileSync(
      path.join(slot, MARKER),
      JSON.stringify(
        { vault: vaultPath, skill: options.name, installed_at: nowIso(), hash: hashDirectory(slot) },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    if (options.retention) planPrune(backupRootFor(options.targetId, options.backupRoot), options.retention);
    return { restored: options.name, previousBackup };
  });
}

export async function listBackups(targetId?: string, base?: string): Promise<BackupEntry[]> {
  const roots = targetId
    ? [backupRootFor(targetId, base)]
    : listDirectory(base || defaultBackupBase()).filter((entry) => entry.isDirectory()).map((entry) => path.join(base || defaultBackupBase(), entry.name));
  const result: BackupEntry[] = [];
  for (const root of roots) {
    for (const stamp of listDirectory(root).filter((entry) => entry.isDirectory())) {
      const dir = path.join(root, stamp.name);
      const skills = listDirectory(dir)
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      result.push({ targetId: path.basename(root), timestamp: stamp.name, path: dir, skills });
    }
  }
  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function reinstallTargets(
  inputPath: string,
  names?: string[],
  options: { rebuild?: boolean; backupRoot?: string; retention?: number } = {},
): Promise<InstallResult[]> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault first.");
  const selected = names && names.length > 0 ? new Set(names) : null;

  const matches = snapshot.targets.filter((target) => {
    if (!target.installAfterUpdate) return false;
    if (!selected) return true;
    const resolved = new Set([...target.names, ...target.skills]);
    for (const name of selected) {
      if (resolved.has(name)) return true;
      const source = snapshot.sources.find((entry) => entry.name === name);
      if (source?.skills.some((skill) => target.skills.includes(skill.name))) return true;
    }
    return false;
  });

  const results: InstallResult[] = [];
  for (const target of matches) {
    results.push(
      await installSkills(vaultPath, {
        names: target.names,
        dest: target.dest,
        id: target.id,
        register: false,
        rebuild: options.rebuild,
        backupRoot: options.backupRoot,
        retention: options.retention,
      }),
    );
  }
  return results;
}

export function installedSlots(snapshot: VaultSnapshot): InstalledSkill[] {
  return snapshot.targets.flatMap((target) => target.installed);
}

export function targetOf(snapshot: VaultSnapshot, id: string): TargetRecord | undefined {
  return snapshot.targets.find((target) => target.id === id);
}

export function vaultFileOf(vaultPath: string): VaultFile {
  return readVaultFile(vaultPath);
}
