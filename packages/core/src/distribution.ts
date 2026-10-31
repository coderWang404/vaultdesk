import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VaultDeskError } from "./errors.js";
import { canonicalPath, expandHome, hashDirectory, nowIso, walkFiles } from "./fsx.js";
import { defaultBackupBase } from "./install.js";
import { readVaultFile, writeVaultFile } from "./vault/config.js";
import { loadVault } from "./vault/model.js";

const MARKER = ".vault-managed";
const PLUGIN_MARKER = ".vaultdesk-plugin-managed";
const IGNORE_FILES = new Set([MARKER, PLUGIN_MARKER, ".source.yml", ".source-commit", ".DS_Store"]);
const IGNORE_DIRS = new Set([".git", ".vault", "node_modules", "__pycache__", ".DS_Store"]);

export interface DistributionOptions {
  agentsSkillsDir?: string;
  backupRoot?: string;
  retention?: number;
  retentionDays?: number;
}

export interface DistributionTransaction {
  changedPaths: string[];
  rollback(): void;
  finalize(): void;
}

interface TargetLink { id: string; path: string; mode: "symlink" | "copy" }
interface Marker {
  vault?: string;
  target_id?: string;
  skill?: string;
  plugin?: string;
  hash?: string;
  installed_at?: string;
  targets?: TargetLink[];
}
interface PlannedSlot { slot: string; stage: string; existed: boolean; backup?: string }

function hasEntry(file: string): boolean {
  try { fs.lstatSync(file); return true; } catch { return false; }
}

function isLink(file: string): boolean {
  try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
}

function readMarker(file: string): Marker | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Marker : undefined;
  } catch { return undefined; }
}

function writeMarker(file: string, marker: Marker): void {
  fs.writeFileSync(file, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

function contentHash(root: string): string {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return "";
  const hash = createHash("sha256");
  for (const file of walkFiles(root, { excludeFiles: IGNORE_FILES, excludeDirs: IGNORE_DIRS })) {
    if (file.rel.endsWith(".pyc")) continue;
    hash.update(file.rel); hash.update("\0");
    if (file.kind === "symlink") {
      hash.update("symlink\0"); hash.update(fs.readlinkSync(file.abs));
    } else {
      hash.update(String(file.mode & 0o111)); hash.update("\0"); hash.update(fs.readFileSync(file.abs));
    }
    hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}

function copyContent(source: string, destination: string): void {
  if (!fs.lstatSync(source).isDirectory()) {
    throw new VaultDeskError("path-escape", "Managed source must be a real directory: " + source);
  }
  const sourceRoot = fs.realpathSync(source);
  for (const file of walkFiles(source, { excludeFiles: IGNORE_FILES, excludeDirs: IGNORE_DIRS })) {
    if (file.kind !== "symlink") continue;
    const link = fs.readlinkSync(file.abs);
    let resolved: string;
    try { resolved = fs.realpathSync(file.abs); }
    catch { throw new VaultDeskError("path-escape", "Skill symlink is unresolved: " + file.rel); }
    if (path.isAbsolute(link) || (resolved !== sourceRoot && !resolved.startsWith(sourceRoot + path.sep))) {
      throw new VaultDeskError("path-escape", "Skill symlink escapes its root: " + file.rel);
    }
  }
  fs.cpSync(source, destination, {
    recursive: true, dereference: false,
    filter: (file) => {
      if (file === source) return true;
      const name = path.basename(file);
      return !IGNORE_FILES.has(name) && !IGNORE_DIRS.has(name) && !name.endsWith(".pyc");
    },
  });
}

function assertOwnedDir(slot: string, vault: string, name: string, markerName: string, targetId?: string, allowLegacyTarget = false): Marker {
  if (isLink(slot) || !fs.existsSync(slot) || !fs.statSync(slot).isDirectory()) {
    throw new VaultDeskError("conflict", "Unowned distribution slot: " + slot);
  }
  const marker = readMarker(path.join(slot, markerName));
  if (!marker?.vault || canonicalPath(marker.vault) !== vault ||
      (markerName === MARKER && marker.skill !== name) ||
      (markerName === PLUGIN_MARKER && marker.plugin !== name) ||
      (targetId && marker.target_id !== targetId && !(allowLegacyTarget && marker.target_id === undefined))) {
    throw new VaultDeskError("conflict", "Distribution slot belongs to another owner: " + slot);
  }
  const current = contentHash(slot);
  if (!marker.hash || (marker.hash !== current && marker.hash !== hashDirectory(slot))) {
    throw new VaultDeskError("conflict", "Managed distribution slot was manually modified: " + slot);
  }
  return marker;
}

function agentsRoot(options: DistributionOptions): string {
  return canonicalPath(options.agentsSkillsDir || process.env.VAULTDESK_AGENTS_SKILLS_DIR || expandHome("~/.agents/skills"));
}

export function managedAgentsSkillsRoot(): string {
  return agentsRoot({});
}

export type ManagedMasterStatus = "missing" | "unmanaged" | "current" | "modified";

export type ManagedPluginTargetStatus = "missing" | "unmanaged" | "current" | "modified";

export function inspectManagedPluginTarget(
  inputPath: string,
  pluginName: string,
  targetId: string,
  slot: string,
): ManagedPluginTargetStatus {
  const vault = canonicalPath(inputPath);
  if (!hasEntry(slot)) return "missing";
  if (isLink(slot) || !fs.statSync(slot).isDirectory()) return "unmanaged";
  const marker = readMarker(path.join(slot, PLUGIN_MARKER));
  if (!marker?.vault || canonicalPath(marker.vault) !== vault ||
      marker.plugin !== pluginName || marker.target_id !== targetId) return "unmanaged";
  const actual = contentHash(slot);
  return marker.hash && marker.hash === actual ? "current" : "modified";
}

export function inspectManagedMaster(inputPath: string, skillName: string, agentsSkillsDir?: string): ManagedMasterStatus {
  const vault = canonicalPath(inputPath);
  const slot = path.join(agentsRoot({ agentsSkillsDir }), safeName(skillName));
  if (!hasEntry(slot)) return "missing";
  if (isLink(slot) || !fs.statSync(slot).isDirectory()) return "unmanaged";
  const marker = readMarker(path.join(slot, MARKER));
  if (!marker?.vault || canonicalPath(marker.vault) !== vault || marker.skill !== skillName) return "unmanaged";
  const actual = contentHash(slot);
  return marker.hash && (marker.hash === actual || marker.hash === hashDirectory(slot)) ? "current" : "modified";
}

export function managedSkillLink(
  inputPath: string,
  targetId: string,
  skillName: string,
  slot: string,
): { master: string; contentMatches: boolean } | undefined {
  const vault = canonicalPath(inputPath);
  const master = path.join(managedAgentsSkillsRoot(), safeName(skillName));
  if (!isLink(slot) || !hasEntry(master) || isLink(master)) return undefined;
  let resolved: string;
  try { resolved = fs.realpathSync(slot); } catch { return undefined; }
  if (resolved !== master) return undefined;
  const marker = readMarker(path.join(master, MARKER));
  const normalizedSlot = path.join(canonicalPath(path.dirname(slot)), skillName);
  if (!marker?.vault || canonicalPath(marker.vault) !== vault || marker.skill !== skillName ||
      !Array.isArray(marker.targets) || !marker.targets.some((link) =>
        link.id === targetId && link.path === normalizedSlot && link.mode === "symlink")) {
    return undefined;
  }
  const actual = contentHash(master);
  return { master, contentMatches: Boolean(marker.hash && (marker.hash === actual || marker.hash === hashDirectory(master))) };
}

export function forgetManagedTargetLinks(inputPath: string, targetId: string, dest: string, skillNames: string[]): void {
  const vault = canonicalPath(inputPath);
  const targetRoot = canonicalPath(expandHome(dest));
  for (const name of skillNames) {
    const master = path.join(managedAgentsSkillsRoot(), safeName(name));
    const markerFile = path.join(master, MARKER);
    const marker = readMarker(markerFile);
    if (!marker?.vault || canonicalPath(marker.vault) !== vault || marker.skill !== name || !Array.isArray(marker.targets)) continue;
    const slot = path.join(targetRoot, name);
    const kept = marker.targets.filter((link) => !(link.id === targetId && link.path === slot));
    if (kept.length !== marker.targets.length) writeMarker(markerFile, { ...marker, targets: kept });
  }
}

function safeName(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new VaultDeskError("invalid-input", "Invalid managed name: " + name);
  return name;
}

function backupSlot(slot: string, backup: string): void {
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (isLink(slot)) fs.symlinkSync(fs.readlinkSync(slot), backup);
  else fs.cpSync(slot, backup, { recursive: true, dereference: false });
}

function pruneBackups(root: string, keep: number, days: number): void {
  if (!fs.existsSync(root)) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ path: path.join(root, entry.name), time: fs.statSync(path.join(root, entry.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  dirs.forEach((entry, index) => {
    if (index >= keep || entry.time < cutoff) fs.rmSync(entry.path, { recursive: true, force: true });
  });
}

function acquireLock(base: string): () => void {
  fs.mkdirSync(base, { recursive: true });
  const lock = path.join(base, ".distribution.lock");
  let fd: number;
  try { fd = fs.openSync(lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const old = readMarker(lock) as { pid?: number; started?: number } | undefined;
    let alive = false;
    if (old?.pid) { try { process.kill(old.pid, 0); alive = true; } catch { /* process ended */ } }
    if (alive || !old?.started || Date.now() - old.started < 2 * 60 * 60 * 1000) {
      throw new VaultDeskError("conflict", "Another distribution transaction is active.");
    }
    fs.rmSync(lock, { force: true });
    fd = fs.openSync(lock, "wx", 0o600);
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started: Date.now() }) + "\n");
  fs.closeSync(fd);
  return () => fs.rmSync(lock, { force: true });
}

export async function beginManagedDistribution(
  inputPath: string,
  sourceName: string,
  options: DistributionOptions = {},
): Promise<DistributionTransaction> {
  const vault = canonicalPath(inputPath);
  const base = path.join(options.backupRoot || defaultBackupBase(), "distribution");
  const releaseLock = acquireLock(base);
  const staged: string[] = [];
  const changed: PlannedSlot[] = [];
  const vaultId = createHash("sha256").update(vault).digest("hex").slice(0, 12);
  const historyRoot = path.join(base, vaultId);
  const txnRoot = path.join(historyRoot, new Date().toISOString().replace(/[^0-9]/g, "") + "-" + randomUUID().slice(0, 8));
  let closed = false;
  const rollback = (): void => {
    if (closed) return;
    const errors: string[] = [];
    for (const plan of [...changed].reverse()) {
      try {
        fs.rmSync(plan.slot, { recursive: true, force: true });
        if (plan.existed && plan.backup) backupSlot(plan.backup, plan.slot);
      } catch (error) { errors.push((error as Error).message); }
    }
    for (const stage of staged) fs.rmSync(stage, { recursive: true, force: true });
    if (errors.length === 0) fs.rmSync(txnRoot, { recursive: true, force: true });
    closed = true;
    releaseLock();
    if (errors.length) throw new VaultDeskError("operation-failed", "Distribution rollback failed: " + errors.join("; "));
  };
  try {
    const snapshot = await loadVault(vault);
    if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Distribution requires a v2 Vault.");
    const source = snapshot.sources.find((entry) => entry.name === sourceName);
    if (!source) throw new VaultDeskError("unknown-source", "Unknown source: " + sourceName);
    const plans: PlannedSlot[] = [];
    const nonce = randomUUID().slice(0, 8);
    const stageFor = (slot: string): string => {
      fs.mkdirSync(path.dirname(slot), { recursive: true });
      const stage = path.join(path.dirname(slot), "." + path.basename(slot) + ".vaultdesk-stage-" + nonce);
      if (hasEntry(stage)) throw new VaultDeskError("conflict", "Stage path already exists: " + stage);
      staged.push(stage);
      return stage;
    };
    const planSlot = (slot: string, stage: string): void => {
      plans.push({ slot, stage, existed: hasEntry(slot) });
    };

    if (source.shape === "plugin") {
      const config = readVaultFile(vault);
      const targets = (config.plugin_targets || []).filter((target) =>
        target.install_after_update && target.names.includes(sourceName),
      );
      for (const target of targets) {
        if (!fs.existsSync(source.workingPath)) throw new VaultDeskError("source-not-found", "Plugin root missing: " + sourceName);
        const dest = canonicalPath(expandHome(target.dest));
        if (dest === vault || dest.startsWith(vault + path.sep)) {
          throw new VaultDeskError("path-escape", "Plugin target is inside Vault: " + target.dest);
        }
        const slot = path.join(dest, safeName(sourceName));
        if (hasEntry(slot)) assertOwnedDir(slot, vault, sourceName, PLUGIN_MARKER, target.id);
        const stage = stageFor(slot);
        copyContent(source.workingPath, stage);
        writeMarker(path.join(stage, PLUGIN_MARKER), {
          vault, target_id: target.id, plugin: sourceName, hash: contentHash(stage), installed_at: nowIso(),
        });
        planSlot(slot, stage);
      }
    } else {
      const root = agentsRoot(options);
      if (root === vault || root.startsWith(vault + path.sep)) {
        throw new VaultDeskError("path-escape", "Agent master cannot be inside Vault.");
      }
      for (const skill of source.skills) {
        safeName(skill.name);
        if (!fs.existsSync(path.join(skill.workingPath, "SKILL.md"))) continue;
        const master = path.join(root, skill.name);
        const prior = hasEntry(master) ? assertOwnedDir(master, vault, skill.name, MARKER) : undefined;
        const links: TargetLink[] = Array.isArray(prior?.targets) ? [...prior.targets] : [];
        const masterStage = stageFor(master);
        copyContent(skill.workingPath, masterStage);
        const targetPlans: PlannedSlot[] = [];

        for (const recorded of links) {
          const registered = snapshot.targets.find((target) => target.id === recorded.id &&
            path.join(canonicalPath(expandHome(target.dest)), skill.name) === recorded.path);
          if (!registered && recorded.mode === "symlink" && isLink(recorded.path)) {
            throw new VaultDeskError("conflict", "Unregistered linked target still points to master: " + recorded.path);
          }
        }
        for (const target of snapshot.targets.filter((entry) => entry.skills.includes(skill.name))) {
          const dest = canonicalPath(expandHome(target.dest));
          if (dest === root) continue;
          if (dest === vault || dest.startsWith(vault + path.sep)) {
            throw new VaultDeskError("path-escape", "Skill target is inside Vault: " + target.dest);
          }
          const slot = path.join(dest, skill.name);
          const recordIndex = links.findIndex((item) => item.id === target.id && item.path === slot);
          const oldLink = isLink(slot);
          if (!target.installAfterUpdate && !oldLink) continue;
          if (hasEntry(slot)) {
            if (oldLink) {
              const resolved = path.resolve(path.dirname(slot), fs.readlinkSync(slot));
              if (resolved !== master || recordIndex < 0 || links[recordIndex]?.mode !== "symlink") {
                throw new VaultDeskError("conflict", "Unowned target symlink: " + slot);
              }
            } else {
              const registeredOwners = snapshot.targets.filter((candidate) => candidate.skills.includes(skill.name) &&
                path.join(canonicalPath(expandHome(candidate.dest)), skill.name) === slot);
              assertOwnedDir(slot, vault, skill.name, MARKER, target.id,
                registeredOwners.length === 1 && registeredOwners[0]?.id === target.id);
            }
          }
          if (!target.installAfterUpdate && !hasEntry(master)) {
            throw new VaultDeskError("conflict", "Cannot freeze missing master for target: " + target.id);
          }
          const stage = stageFor(slot);
          let mode: TargetLink["mode"] = "copy";
          if (target.installAfterUpdate) {
            try { fs.symlinkSync(master, stage); mode = "symlink"; }
            catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw error;
            }
          }
          if (mode === "copy") {
            copyContent(target.installAfterUpdate ? masterStage : master, stage);
            writeMarker(path.join(stage, MARKER), {
              vault, target_id: target.id, skill: skill.name,
              hash: contentHash(stage), installed_at: nowIso(),
            });
          }
          if (recordIndex >= 0) links.splice(recordIndex, 1);
          links.push({ id: target.id, path: slot, mode });
          targetPlans.push({ slot, stage, existed: hasEntry(slot) });
        }
        writeMarker(path.join(masterStage, MARKER), {
          vault, target_id: "agents-master", skill: skill.name,
          hash: contentHash(masterStage), installed_at: nowIso(), targets: links,
        });
        planSlot(master, masterStage);
        plans.push(...targetPlans);
      }
    }

    if (plans.length === 0) {
      for (const stage of staged) fs.rmSync(stage, { recursive: true, force: true });
      closed = true;
      releaseLock();
      return { changedPaths: [], rollback: () => {}, finalize: () => {} };
    }
    fs.mkdirSync(txnRoot, { recursive: true });
    for (const [index, plan] of plans.entries()) {
      if (plan.existed) {
        plan.backup = path.join(txnRoot, String(index).padStart(3, "0") + "-" + path.basename(plan.slot));
        backupSlot(plan.slot, plan.backup);
      }
    }
    for (const plan of plans) {
      changed.push(plan);
      if (plan.existed) fs.rmSync(plan.slot, { recursive: true, force: true });
      fs.renameSync(plan.stage, plan.slot);
    }
    return {
      changedPaths: plans.map((plan) => plan.slot),
      rollback,
      finalize: () => {
        if (closed) return;
        for (const stage of staged) fs.rmSync(stage, { recursive: true, force: true });
        closed = true;
        releaseLock();
        try { pruneBackups(historyRoot, options.retention ?? 3, options.retentionDays ?? 7); }
        catch { /* backup pruning must not invalidate a committed source update */ }
      },
    };
  } catch (error) {
    try { rollback(); }
    catch (rollbackError) {
      throw new VaultDeskError("operation-failed", "Distribution and rollback failed: " + (rollbackError as Error).message, { cause: error });
    }
    throw error;
  }
}

export async function adoptMasterSkills(
  inputPath: string,
  names: string[],
  options: Pick<DistributionOptions, "agentsSkillsDir"> = {},
): Promise<string[]> {
  const vault = canonicalPath(inputPath);
  const snapshot = await loadVault(vault);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Adoption requires a v2 Vault.");
  const root = agentsRoot(options);
  const writes: Array<{ file: string; previous?: string; marker: Marker }> = [];
  for (const name of names) {
    const skill = snapshot.skills.find((entry) => entry.name === name);
    if (!skill) throw new VaultDeskError("unknown-skill", "Skill not in Vault: " + name);
    const slot = path.join(root, safeName(name));
    if (!hasEntry(slot) || isLink(slot) || !fs.statSync(slot).isDirectory()) {
      throw new VaultDeskError("conflict", "Cannot adopt missing or linked master skill: " + slot);
    }
    const actual = contentHash(slot);
    if (actual !== contentHash(skill.workingPath)) {
      throw new VaultDeskError("conflict", "Agent skill differs from Vault copy: " + name);
    }
    const file = path.join(slot, MARKER);
    const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    const old = previous ? readMarker(file) : undefined;
    if (previous && (!old?.vault || canonicalPath(old.vault) !== vault || old.skill !== name)) {
      throw new VaultDeskError("conflict", "Agent skill already belongs to another Vault: " + name);
    }
    writes.push({ file, previous, marker: {
      vault, target_id: "agents-master", skill: name, hash: actual,
      installed_at: old?.installed_at || nowIso(), targets: old?.targets || [],
    } });
  }
  const completed: typeof writes = [];
  try {
    for (const item of writes) { writeMarker(item.file, item.marker); completed.push(item); }
  } catch (error) {
    for (const item of completed.reverse()) {
      if (item.previous === undefined) fs.rmSync(item.file, { force: true });
      else fs.writeFileSync(item.file, item.previous);
    }
    throw error;
  }
  return names;
}

export async function registerPluginTarget(
  inputPath: string,
  target: { id: string; dest: string; names: string[]; installAfterUpdate?: boolean },
): Promise<void> {
  const vault = canonicalPath(inputPath);
  const snapshot = await loadVault(vault);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Plugin target requires a v2 Vault.");
  for (const name of target.names) {
    if (!snapshot.sources.some((source) => source.name === name && source.shape === "plugin")) {
      throw new VaultDeskError("unknown-plugin", "Unknown plugin source: " + name);
    }
  }
  const config = readVaultFile(vault);
  if ((config.plugin_targets || []).some((entry) => entry.id === target.id)) {
    throw new VaultDeskError("conflict", "Plugin target ID already exists: " + target.id);
  }
  config.plugin_targets = [...(config.plugin_targets || []), {
    id: target.id,
    dest: target.dest,
    names: target.names,
    install_after_update: target.installAfterUpdate ?? true,
  }];
  writeVaultFile(vault, config);
}

export async function removePluginTarget(
  inputPath: string,
  id: string,
  options: { deleteFiles?: boolean; backupRoot?: string } = {},
): Promise<{ removed: string; filesMoved: string[] }> {
  const vault = canonicalPath(inputPath);
  const snapshot = await loadVault(vault);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Plugin target requires a v2 Vault.");
  const config = readVaultFile(vault);
  const target = (config.plugin_targets || []).find((entry) => entry.id === id);
  if (!target) throw new VaultDeskError("unknown-target", "Unknown plugin target: " + id);
  const slots: string[] = [];
  if (options.deleteFiles) {
    const dest = canonicalPath(expandHome(target.dest));
    if (dest === vault || dest.startsWith(vault + path.sep)) {
      throw new VaultDeskError("path-escape", "Plugin target is inside Vault: " + target.dest);
    }
    for (const name of target.names) {
      const slot = path.join(dest, safeName(name));
      if (!hasEntry(slot)) continue;
      assertOwnedDir(slot, vault, name, PLUGIN_MARKER, id);
      slots.push(slot);
    }
  }
  const backupBase = path.join(options.backupRoot || defaultBackupBase(), "plugin-removals");
  const backup = path.join(backupBase, createHash("sha256").update(vault + "\0" + id).digest("hex").slice(0, 16),
    new Date().toISOString().replace(/[^0-9]/g, "") + "-" + randomUUID().slice(0, 8));
  const moved: Array<{ slot: string; backup: string }> = [];
  try {
    for (const slot of slots) {
      const saved = path.join(backup, path.basename(slot));
      backupSlot(slot, saved);
      moved.push({ slot, backup: saved });
      fs.rmSync(slot, { recursive: true, force: true });
    }
    config.plugin_targets = (config.plugin_targets || []).filter((entry) => entry.id !== id);
    writeVaultFile(vault, config);
  } catch (error) {
    const restoreErrors: string[] = [];
    for (const item of [...moved].reverse()) {
      try {
        fs.rmSync(item.slot, { recursive: true, force: true });
        backupSlot(item.backup, item.slot);
      }
      catch (restoreError) { restoreErrors.push((restoreError as Error).message); }
    }
    if (restoreErrors.length === 0) fs.rmSync(backup, { recursive: true, force: true });
    if (restoreErrors.length > 0) {
      throw new VaultDeskError("operation-failed", "Plugin target removal and rollback failed: " + restoreErrors.join("; "), { cause: error });
    }
    throw error;
  }
  if (moved.length > 0) {
    try { pruneBackups(path.dirname(backup), 3, 7); }
    catch { /* pruning must not undo a successful removal */ }
  }
  return { removed: id, filesMoved: moved.map((item) => item.backup) };
}
