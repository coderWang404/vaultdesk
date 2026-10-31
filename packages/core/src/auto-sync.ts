import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { sourceFileSchema } from "@vaultdesk/schema";
import { VaultDeskError } from "./errors.js";
import { canonicalPath, copyDirectory, expandHome, hashDirectory, hashText, INTERNAL_METADATA, isInside, readText, sha256, writeTextAtomic } from "./fsx.js";
import { commitPaths, currentCommit, getGitSummary, git, push } from "./git.js";
import { beginManagedDistribution, inspectManagedMaster, inspectManagedPluginTarget, managedAgentsSkillsRoot } from "./distribution.js";
import { withWriteLock } from "./vault/lockfile.js";
import { openVault, validateVault } from "./vault/validate.js";
import { readVaultFile } from "./vault/config.js";
import { readLock, recordCheck, writeLock } from "./vault/state.js";
import { buildVault } from "./build.js";
import { checkSources } from "./sources/check.js";
import { fetchUpstream } from "./sources/fetch.js";
import { updateSources } from "./sources/update.js";
import { inspectPlugin } from "./plugins/discover.js";
import { resolvePluginUpstreamRoot } from "./plugins/upstream.js";
import { parseFrontmatter } from "./frontmatter.js";
import { slugSchema } from "@vaultdesk/schema";
import { settingsPath } from "./settings.js";
import type { SourceRecord, VaultSnapshot } from "./types.js";

interface DistributionMarker {
  vault?: string;
  target_id?: string;
  skill?: string;
  hash?: string;
  targets?: Array<{ id?: string; path?: string; mode?: "symlink" | "copy" }>;
}

export interface AutoSyncOptions {
  agentsSkillsDir?: string;
  backupRoot?: string;
  retention?: number;
  retentionDays?: number;
  /** Optional local-only storage root for pending automatic pushes. */
  pendingRoot?: string;
}

export type AutoSyncSourceStatus = "updated" | "current" | "skipped" | "error" | "push-failed";

export interface AutoSyncSourceResult {
  name: string;
  status: AutoSyncSourceStatus;
  message?: string;
  commit?: string;
  pendingSkills?: string[];
}

export interface AutoSyncReport {
  vaultPath: string;
  checkedAt: string;
  sources: AutoSyncSourceResult[];
  updated: number;
  errors: number;
}

export interface PendingSkill {
  name: string;
  sourcePath: string;
}

interface PathBackup {
  restore(): void;
  dispose(): void;
}

interface PendingAutoPush {
  schema: 1;
  vaultPath: string;
  sourceName: string;
  branch: string;
  upstream: string;
  remoteHash: string;
  pushRef: string;
  pushUrlsHash: string;
  commit: string;
  createdAt: string;
}

function pendingFile(vaultPath: string, options: AutoSyncOptions): string {
  const root = options.pendingRoot ?? process.env.VAULTDESK_AUTO_SYNC_PENDING_DIR ??
    path.join(path.dirname(settingsPath()), "auto-sync-pending");
  return path.join(path.resolve(expandHome(root)), sha256(vaultPath).slice(0, 32) + ".json");
}

function readPending(vaultPath: string, options: AutoSyncOptions): PendingAutoPush | undefined {
  const file = pendingFile(vaultPath, options);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readText(file)) as PendingAutoPush;
    if (parsed?.schema !== 1 || parsed.vaultPath !== vaultPath || !parsed.sourceName ||
      !parsed.branch || !parsed.upstream || !parsed.pushRef ||
      !/^[a-f0-9]{64}$/.test(parsed.remoteHash) || !/^[a-f0-9]{64}$/.test(parsed.pushUrlsHash) ||
      !/^[a-f0-9]{40,64}$/.test(parsed.commit)) throw new Error("invalid record");
    return parsed;
  } catch {
    throw new VaultDeskError("conflict", "Pending automatic push record is invalid; review it manually before another sync.");
  }
}

function writePending(vaultPath: string, options: AutoSyncOptions, record: PendingAutoPush): void {
  const file = pendingFile(vaultPath, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeTextAtomic(file, JSON.stringify(record, null, 2) + "\n");
}

function clearPending(vaultPath: string, options: AutoSyncOptions): void {
  fs.rmSync(pendingFile(vaultPath, options), { force: true });
}

async function pushDestination(vaultPath: string): Promise<{ pushRef: string; pushUrlsHash: string }> {
  const target = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}"], vaultPath, { allowFailure: true });
  const pushRef = target.code === 0 ? target.stdout.trim() : "";
  const slash = pushRef.indexOf("/");
  if (slash <= 0) throw new VaultDeskError("conflict", "Automatic push target is not configured; set a Git upstream/push branch first.");
  const remoteName = pushRef.slice(0, slash);
  const urls = await git(["remote", "get-url", "--push", "--all", remoteName], vaultPath, { allowFailure: true });
  if (urls.code !== 0 || !urls.stdout.trim()) {
    throw new VaultDeskError("conflict", "Automatic push remote URL is not configured.");
  }
  return { pushRef, pushUrlsHash: sha256(urls.stdout.trim()) };
}

async function retryPendingPush(vaultPath: string, options: AutoSyncOptions): Promise<AutoSyncSourceResult | undefined> {
  if (!readPending(vaultPath, options)) return undefined;
  return withWriteLock(vaultPath, async () => {
    const pending = readPending(vaultPath, options);
    if (!pending) return undefined;
    const summary = await getGitSummary(vaultPath);
    const destination = await pushDestination(vaultPath);
    if (summary.head !== pending.commit || summary.branch !== pending.branch ||
      summary.upstream !== pending.upstream || sha256(summary.remote ?? "") !== pending.remoteHash ||
      destination.pushRef !== pending.pushRef || destination.pushUrlsHash !== pending.pushUrlsHash ||
      summary.ahead !== 1 || summary.behind !== 0) {
      return { name: pending.sourceName, status: "error", commit: pending.commit,
        message: "Pending automatic push no longer matches HEAD, branch, push URL, or tracking history; manual review required." };
    }
    try {
      await push(vaultPath);
      clearPending(vaultPath, options);
      return { name: pending.sourceName, status: "updated", commit: pending.commit,
        message: "Previously pending automatic commit pushed successfully." };
    } catch (error) {
      return { name: pending.sourceName, status: "push-failed", commit: pending.commit,
        message: "Previously pending automatic commit still could not be pushed: " + safeMessage(error) };
    }
  });
}

function uniqueRoots(paths: string[]): string[] {
  const ordered = [...new Set(paths.map((entry) => path.resolve(entry)))].sort((a, b) => a.length - b.length);
  return ordered.filter((entry, index) => !ordered.slice(0, index).some((parent) => entry.startsWith(parent + path.sep)));
}

function sourceWritePaths(vaultPath: string, source: SourceRecord): string[] {
  const paths = [
    source.workingPath,
    source.vendorRoot,
    source.metadataPath,
    ...source.skills.flatMap((skill) => [skill.workingPath, skill.vendorPath]),
    path.join(vaultPath, "vault.lock"),
    path.join(vaultPath, "build"),
    path.join(vaultPath, ".vault", "state.json"),
    path.join(vaultPath, ".vault", "operation.json"),
  ].filter((entry): entry is string => Boolean(entry));
  for (const entry of paths) {
    if (!isInside(entry, vaultPath)) {
      throw new VaultDeskError("path-escape", "Source write path escapes its vault: " + entry);
    }
  }
  return uniqueRoots(paths);
}

function relativePaths(vaultPath: string, paths: string[]): string[] {
  return paths.map((entry) => path.relative(vaultPath, entry).split(path.sep).join("/"));
}

function pathMatches(change: string, root: string): boolean {
  return change === root || change.startsWith(root + "/") || root.startsWith(change + "/");
}

async function assertNoDirtyWritePaths(vaultPath: string, paths: string[]): Promise<void> {
  const protectedPaths = relativePaths(vaultPath, paths).filter((entry) => !entry.startsWith(".vault/"));
  const summary = await getGitSummary(vaultPath);
  if (!summary.isRepo) throw new VaultDeskError("git-failed", "Automatic updates require a Git vault.");
  const conflicts = summary.changes.filter((change) =>
    [change.path, change.from].some((entry) => entry && protectedPaths.some((root) => pathMatches(entry, root))),
  );
  if (conflicts.length > 0) {
    throw new VaultDeskError("conflict", "This source has local changes in files needed for automatic update: " + conflicts.map((entry) => entry.path).join(", "));
  }
}

function backUp(paths: string[]): PathBackup {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdesk-auto-sync-"));
  const entries: Array<{ target: string; backup: string; existed: boolean }> = [];
  try {
    for (const [index, target] of paths.entries()) {
      const backup = path.join(root, String(index));
      const existed = fs.existsSync(target) || isSymlink(target);
      if (existed) fs.cpSync(target, backup, { recursive: true, dereference: false });
      entries.push({ target, backup, existed });
    }
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    restore() {
      for (const entry of entries) {
        fs.rmSync(entry.target, { recursive: true, force: true });
        if (entry.existed) {
          fs.mkdirSync(path.dirname(entry.target), { recursive: true });
          fs.cpSync(entry.backup, entry.target, { recursive: true, dereference: false });
        }
      }
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof VaultDeskError) {
    if (error.code === "auth-failed") return "Git authentication failed; local changes were preserved.";
    if (error.code === "network") return "Network unavailable; automatic update will retry.";
    if (error.code === "git-failed") return "Git operation failed; inspect the vault's Git configuration and remote.";
    if (error.code === "upstream-not-found") return "An upstream skill was removed; the local copy was preserved for review.";
  }
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) => {
      const cut = url.search(/[?#]/);
      const base = (cut < 0 ? url : url.slice(0, cut)).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1[redacted]@");
      return base + (cut < 0 ? "" : "?[redacted]");
    })
    .replace(/\b(token|api[_-]?key|secret|password|signature|access[_-]?key)=([^\s&]+)/gi, "$1=[redacted]");
}

function isRemovedUpstream(error: unknown): boolean {
  return error instanceof VaultDeskError && error.code === "upstream-not-found";
}

async function pendingUpstreamSkills(
  snapshot: VaultSnapshot,
  source: SourceRecord,
): Promise<PendingSkill[]> {
  if (source.shape === "standalone") return [];
  const fetched = await fetchUpstream(source);
  if (source.shape === "plugin") {
    const inspected = inspectPlugin({
      root: resolvePluginUpstreamRoot(source, fetched.root),
      vaultPath: snapshot.path,
      sourceName: source.name,
      origin: "github",
      repo: source.repo,
      ref: source.ref,
      warnings: [],
    });
    const existing = new Set(snapshot.plugins.find((plugin) => plugin.name === source.name)?.skills.map((skill) => skill.name) ?? []);
    const root = resolvePluginUpstreamRoot(source, fetched.root);
    return inspected.skills.filter((skill) => !existing.has(skill.name))
      .map((skill) => ({ name: skill.name, sourcePath: path.relative(root, skill.workingPath).split(path.sep).join("/") }))
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  }
  const registered = new Set(source.skills.map((skill) => skill.sourcePath?.replaceAll("\\", "/")).filter((entry): entry is string => Boolean(entry)));
  const tree = await git(["ls-tree", "-r", "--name-only", "HEAD"], fetched.root, { allowFailure: true });
  if (tree.code !== 0) throw new VaultDeskError("git-failed", "Could not inspect the upstream skill tree.");
  const discovered = new Map<string, PendingSkill>();
  for (const entry of tree.stdout.split("\n")) {
    if (!entry.endsWith("/SKILL.md")) continue;
    const skillPath = path.posix.dirname(entry);
    if ([...registered].some((known) => skillPath === known || skillPath.startsWith(known + "/"))) continue;
    discovered.set(skillPath, { name: path.posix.basename(skillPath), sourcePath: skillPath });
  }
  return [...discovered.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export async function listPendingSkills(inputPath: string, sourceName: string): Promise<PendingSkill[]> {
  const snapshot = await openVault(inputPath);
  const source = snapshot.sources.find((entry) => entry.name === sourceName);
  if (!source) throw new VaultDeskError("unknown-source", "Unknown source: " + sourceName);
  if (source.origin !== "github") throw new VaultDeskError("unsupported", "Local sources have no remote skills.");
  return pendingUpstreamSkills(snapshot, source);
}

export async function adoptPendingSkills(
  inputPath: string, sourceName: string, selectedPaths: string[], options: AutoSyncOptions = {},
): Promise<AutoSyncSourceResult> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  const source = snapshot.sources.find((entry) => entry.name === sourceName);
  if (!source || source.origin !== "github") throw new VaultDeskError("unknown-source", "Unknown Git source: " + sourceName);
  if (source.shape === "standalone") throw new VaultDeskError("unsupported", "Standalone sources cannot adopt additional skills.");
  const pending = await pendingUpstreamSkills(snapshot, source);
  const chosen = [...new Set(selectedPaths.map((entry) => entry.replaceAll("\\", "/").replace(/^\.\//, "")))];
  if (chosen.length === 0 || chosen.some((entry) => !pending.some((skill) => skill.sourcePath === entry))) {
    throw new VaultDeskError("invalid-input", "Select one or more exact pending source paths.");
  }
  if (source.shape === "plugin") {
    if (chosen.length !== pending.length) {
      throw new VaultDeskError("unsupported", "Plugin updates copy the whole root; select every pending skill before applying this plugin update.");
    }
    return updateOneSource(vaultPath, sourceName, options, [], { allowNonAuto: true, commitMessage: "chore: adopt plugin skills in " + sourceName });
  }
  const full = await fetchUpstream({ ...source, skills: [] });
  const additions = chosen.map((sourcePath) => {
    const upstream = path.join(full.root, sourcePath);
    if (!isInside(upstream, full.root) || !fs.existsSync(path.join(upstream, "SKILL.md"))) {
      throw new VaultDeskError("upstream-not-found", "Selected skill disappeared upstream: " + sourcePath);
    }
    const parsed = parseFrontmatter(readText(path.join(upstream, "SKILL.md")));
    const name = typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim() : path.posix.basename(sourcePath);
    if (!slugSchema.safeParse(name).success || snapshot.skills.some((skill) => skill.name === name)) {
      throw new VaultDeskError("conflict", "Selected skill name conflicts with the Vault: " + name);
    }
    const working = path.join(vaultPath, "packages", sourceName, "skills", name);
    const vendorRel = `third_party/${sourceName}/${name}`;
    const vendor = path.join(vaultPath, vendorRel);
    return { name, sourcePath, upstream, working, vendor, vendorRel };
  });
  if (new Set(additions.map((entry) => entry.name)).size !== additions.length) {
    throw new VaultDeskError("conflict", "Selected upstream skills share a name.");
  }
  const selected = new Set(chosen);
  const remaining = pending.filter((entry) => !selected.has(entry.sourcePath)).map((entry) => entry.sourcePath);
  return updateOneSource(vaultPath, sourceName, options, remaining, {
    allowNonAuto: true,
    extraPaths: additions.flatMap((entry) => [entry.working, entry.vendor]),
    commitMessage: "chore: adopt skills in " + sourceName,
    prepare: async (fresh) => {
      if (!fresh.metadataPath) throw new VaultDeskError("source-not-found", "Source metadata is missing.");
      for (const entry of additions) {
        if (fs.existsSync(entry.working) || fs.existsSync(entry.vendor)) {
          throw new VaultDeskError("conflict", "Selected skill slot already exists: " + entry.name);
        }
        fs.mkdirSync(path.dirname(entry.working), { recursive: true });
        fs.mkdirSync(path.dirname(entry.vendor), { recursive: true });
        copyDirectory(entry.upstream, entry.working);
        copyDirectory(entry.upstream, entry.vendor);
      }
      const raw = YAML.parse(readText(fresh.metadataPath)) as Record<string, unknown>;
      const skills = Array.isArray(raw.skills) ? raw.skills : [];
      const updated = { ...raw, skills: [...skills, ...additions.map((entry) => ({
        name: entry.name, source_path: entry.sourcePath, vendor_path: entry.vendorRel, user_invocable: true,
      }))] };
      if (!sourceFileSchema.safeParse(updated).success) throw new VaultDeskError("unsupported-schema", "New source metadata is invalid.");
      writeTextAtomic(fresh.metadataPath, YAML.stringify(updated, { lineWidth: 0 }));
      const lock = readLock(vaultPath);
      if (!lock?.sources[sourceName]?.skills) throw new VaultDeskError("conflict", "Source lock is missing skill hashes.");
      const hashes = { ...lock.sources[sourceName].skills };
      for (const entry of additions) hashes[entry.name] = hashDirectory(entry.working);
      lock.sources[sourceName] = { ...lock.sources[sourceName], skills: hashes,
        hash: hashText(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))) };
      writeLock(vaultPath, lock);
    },
  });
}

export async function distributeCurrentSource(
  inputPath: string, sourceName: string, options: AutoSyncOptions = {},
): Promise<string[]> {
  const vaultPath = canonicalPath(inputPath);
  return withWriteLock(vaultPath, async () => {
    const snapshot = await openVault(vaultPath);
    const source = snapshot.sources.find((entry) => entry.name === sourceName);
    if (!source) {
      throw new VaultDeskError("unknown-source", "Unknown source: " + sourceName);
    }
    const drift = source.origin === "github" ? githubWorkingDrift(source) : undefined;
    if (drift) throw new VaultDeskError("conflict", drift);
    const distribution = await beginManagedDistribution(vaultPath, sourceName, options);
    distribution.finalize();
    return distribution.changedPaths;
  });
}

function distributionContentHash(root: string): string {
  return hashDirectory(root, { excludeFiles: new Set([...INTERNAL_METADATA, ".vaultdesk-plugin-managed"]) });
}

/** Call only after ownership and manual-edit checks have passed. */
function needsDistributionRefresh(snapshot: VaultSnapshot, source: SourceRecord, options: AutoSyncOptions): boolean {
  if (source.shape === "plugin") {
    const expectedHash = distributionContentHash(source.workingPath);
    return (readVaultFile(snapshot.path).plugin_targets ?? []).some((target) => {
      if (!target.install_after_update || !target.names.includes(source.name)) return false;
      const slot = path.join(expandHome(target.dest), source.name);
      return !fs.existsSync(slot) || distributionContentHash(slot) !== expectedHash;
    });
  }
  const root = canonicalPath(options.agentsSkillsDir ?? managedAgentsSkillsRoot());
  return source.skills.some((skill) => {
    const expectedHash = distributionContentHash(skill.workingPath);
    const master = path.join(root, skill.name);
    if (!fs.existsSync(master) || distributionContentHash(master) !== expectedHash) return true;
    return snapshot.targets.some((target) => {
      if (!target.installAfterUpdate || !target.skills.includes(skill.name)) return false;
      const slot = path.join(target.expandedDest, skill.name);
      return !fs.existsSync(slot) || distributionContentHash(slot) !== expectedHash;
    });
  });
}

function localMasterDrift(snapshot: VaultSnapshot, source: SourceRecord, options: AutoSyncOptions): string | undefined {
  for (const skill of source.skills) {
    const state = inspectManagedMaster(snapshot.path, skill.name, options.agentsSkillsDir);
    if (state === "unmanaged") return `Local master ${skill.name} has unknown ownership; review before distribution.`;
    if (state === "modified") return `Local master ${skill.name} was manually modified; preserve it and review before syncing.`;
  }
  return undefined;
}

function githubWorkingDrift(source: SourceRecord): string | undefined {
  if (source.shape === "plugin") {
    if (!source.locked?.hash || hashDirectory(source.workingPath) !== source.locked.hash ||
      (source.vendorRoot && hashDirectory(source.vendorRoot) !== source.locked.hash)) {
      return `Git plugin ${source.name} differs from its locked copy; review local changes before distribution.`;
    }
    return undefined;
  }
  for (const skill of source.skills) {
    const locked = source.locked?.skills?.[skill.name];
    if (!locked || hashDirectory(skill.workingPath) !== locked ||
      (skill.vendorPath && hashDirectory(skill.vendorPath) !== locked)) {
      return `Git skill ${skill.name} differs from its locked copy; review local changes before distribution.`;
    }
  }
  return undefined;
}

function readDistributionMarker(slot: string): DistributionMarker | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(slot, ".vault-managed"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed as DistributionMarker : undefined;
  } catch {
    return undefined;
  }
}

function hasPath(slot: string): boolean {
  try { fs.lstatSync(slot); return true; } catch { return false; }
}

function managedDistributionDrift(
  snapshot: VaultSnapshot,
  source: SourceRecord,
  options: AutoSyncOptions,
): string[] {
  if (source.shape === "plugin") {
    const vault = canonicalPath(snapshot.path);
    const config = readVaultFile(vault);
    const drift: string[] = [];
    for (const target of (config.plugin_targets ?? []).filter((entry) =>
      entry.install_after_update && entry.names.includes(source.name))) {
      const slot = path.join(canonicalPath(expandHome(target.dest)), source.name);
      const state = inspectManagedPluginTarget(vault, source.name, target.id, slot);
      if (state === "unmanaged") {
        drift.push(`source ${source.name}, plugin target ${target.id} (${slot}): unknown ownership or invalid target`);
      } else if (state === "modified") {
        drift.push(`source ${source.name}, plugin target ${target.id} (${slot}): managed copy was modified`);
      }
    }
    return drift;
  }
  const vault = canonicalPath(snapshot.path);
  const root = canonicalPath(options.agentsSkillsDir ?? managedAgentsSkillsRoot());
  const drift: string[] = [];

  for (const skill of source.skills) {
    const master = path.join(root, skill.name);
    const masterState = inspectManagedMaster(vault, skill.name, options.agentsSkillsDir);
    if (masterState === "unmanaged") {
      drift.push(`source ${source.name}, skill ${skill.name}, master ${master}: unknown ownership`);
    } else if (masterState === "modified") {
      drift.push(`source ${source.name}, skill ${skill.name}, master ${master}: manually modified`);
    }

    for (const target of snapshot.targets.filter((entry) => entry.skills.includes(skill.name))) {
      const targetRoot = canonicalPath(target.expandedDest);
      if (targetRoot === root) continue;
      const slot = path.join(targetRoot, skill.name);
      if (!hasPath(slot)) {
        // Missing active targets are handled by the distribution refresh path.
        continue;
      }

      const linked = isSymlink(slot);
      if (!target.installAfterUpdate && !linked) {
        // An explicit frozen copy is allowed to diverge and must not block active targets.
        continue;
      }

      if (linked) {
        let resolved: string | undefined;
        try { resolved = fs.realpathSync(slot); } catch { /* report below */ }
        let expectedMaster = canonicalPath(master);
        try { if (hasPath(master)) expectedMaster = fs.realpathSync(master); } catch { /* report below */ }
        const marker = hasPath(master) ? readDistributionMarker(master) : undefined;
        const normalizedSlot = path.join(canonicalPath(path.dirname(slot)), skill.name);
        const linkedRecord = marker?.targets?.some((entry) =>
          entry.id === target.id && entry.path === normalizedSlot && entry.mode === "symlink");
        if (!resolved || resolved !== expectedMaster || !linkedRecord) {
          drift.push(`source ${source.name}, skill ${skill.name}, target ${target.id} (${slot}): unmanaged or incorrect symlink`);
        }
        continue;
      }

      if (!target.installAfterUpdate) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(slot); } catch { continue; }
      if (!stat.isDirectory()) {
        drift.push(`source ${source.name}, skill ${skill.name}, target ${target.id} (${slot}): target is not a directory`);
        continue;
      }
      const marker = readDistributionMarker(slot);
      const sameVault = Boolean(marker?.vault && canonicalPath(marker.vault) === vault);
      const sameSkill = marker?.skill === skill.name;
      const sameTarget = marker?.target_id === target.id;
      const hashMatches = Boolean(marker?.hash && marker.hash === hashDirectory(slot));
      if (!sameVault || !sameSkill || !sameTarget || !hashMatches) {
        drift.push(`source ${source.name}, skill ${skill.name}, target ${target.id} (${slot}): managed copy was modified or ownership is invalid`);
      }
    }
  }
  return drift;
}

function changedOwnedPaths(
  vaultPath: string,
  paths: string[],
  changes: Array<{ path: string; from?: string }>,
): string[] {
  const owned = relativePaths(vaultPath, paths).filter((entry) => !entry.startsWith(".vault/"));
  const result = new Set<string>();
  for (const change of changes) {
    if (!owned.some((entry) => pathMatches(change.path, entry))) continue;
    result.add(change.path);
    if (change.from) result.add(change.from);
  }
  return [...result].sort();
}

interface SensitivePathFinding {
  path: string;
  reason: string;
}

const GENERATED_SENSITIVE_SUFFIXES = [
  "/__pycache__",
  ".pyc",
  ".pyo",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".mobileprovision",
];

function sensitivePathReason(relative: string): string | undefined {
  const lower = relative.toLocaleLowerCase();
  if (lower.split("/").some((part) => part === ".env" || (part.startsWith(".env.") && ![".env.example", ".env.sample", ".env.template"].includes(part)) || part === ".secrets" || part === "credentials" || part === "secrets")) {
    return "credential-like filename";
  }
  if (GENERATED_SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return "private key or generated cache file";
  if (lower.includes("__pycache__")) return "generated Python cache";
  return undefined;
}

function sensitiveContentReason(content: string): string | undefined {
  if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(content)) return "private key material";
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(content)) return "AWS access key pattern";
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(content)) return "GitHub token pattern";
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i.test(content)) return "bearer token pattern";
  if (/\b(?:api[_-]?key|access[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}/i.test(content)) return "credential assignment pattern";
  return undefined;
}

function scanCommitFiles(vaultPath: string, files: string[]): void {
  const findings: SensitivePathFinding[] = [];
  for (const relative of files.map((entry) => entry.replaceAll("\\", "/"))) {
    const pathReason = sensitivePathReason(relative);
    if (pathReason) {
      findings.push({ path: relative, reason: pathReason });
      continue;
    }
    const absolute = path.join(vaultPath, relative);
    let content: string;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const contentReason = sensitiveContentReason(content);
    if (contentReason) findings.push({ path: relative, reason: contentReason });
  }
  if (findings.length > 0) {
    throw new VaultDeskError("conflict", "Automatic commit blocked by sensitive or generated files: " +
      findings.map((finding) => `${finding.path} (${finding.reason})`).join(", ") +
      ". Review or explicitly remove the files before retrying.");
  }
}

async function updateOneSource(
  vaultPath: string,
  name: string,
  options: AutoSyncOptions,
  pendingSkills: string[],
  control: {
    allowNonAuto?: boolean;
    extraPaths?: string[];
    prepare?: (source: SourceRecord) => Promise<void>;
    commitMessage?: string;
  } = {},
): Promise<AutoSyncSourceResult> {
  return withWriteLock(vaultPath, async () => {
    const fresh = await openVault(vaultPath);
    const source = fresh.sources.find((entry) => entry.name === name);
    if (!source || source.origin !== "github" || (!control.allowNonAuto && source.updateMode !== "auto")) {
      return { name, status: "skipped", message: "Source is no longer eligible for automatic update." };
    }
    const paths = uniqueRoots([...sourceWritePaths(vaultPath, source), ...(control.extraPaths ?? [])]);
    if (paths.some((entry) => !isInside(entry, vaultPath))) throw new VaultDeskError("path-escape", "Source write path escapes its vault.");
    await assertNoDirtyWritePaths(vaultPath, paths);
    if (readPending(vaultPath, options)) {
      throw new VaultDeskError("conflict", "Resolve the previous pending automatic push before another source update.");
    }
    const baseGit = await getGitSummary(vaultPath);
    if (!baseGit.head || !baseGit.branch || baseGit.branch === "HEAD" || !baseGit.upstream ||
      !baseGit.remote || baseGit.ahead !== 0 || baseGit.behind !== 0) {
      throw new VaultDeskError("conflict", "Automatic update requires a tracking branch with no existing unpushed or incoming Vault commits.");
    }
    const basePush = await pushDestination(vaultPath);
    const backup = backUp(paths);
    const oldHead = baseGit.head;
    let distribution: Awaited<ReturnType<typeof beginManagedDistribution>> | undefined;
    let commit: string | undefined;
    let finalizationError: string | undefined;
    try {
      await control.prepare?.(source);
      const result = await updateSources(vaultPath, {
        names: [name],
        commit: false,
        install: false,
        alreadyLocked: true,
        allowUnrelatedDirty: true,
      });
      if (!result.applied && !control.prepare) {
        backup.dispose();
        return { name, status: "current" };
      }
      if (!result.applied) {
        await buildVault(vaultPath);
        const validation = await validateVault(vaultPath);
        if (!validation.ok) throw new VaultDeskError("validation-failed", "Adopted skill failed Vault validation.");
      }
      distribution = await beginManagedDistribution(vaultPath, name, {
        agentsSkillsDir: options.agentsSkillsDir,
        backupRoot: options.backupRoot,
        retention: options.retention,
        retentionDays: options.retentionDays,
      });
      const summary = await getGitSummary(vaultPath);
      const commitFiles = changedOwnedPaths(vaultPath, paths, summary.changes);
      if (commitFiles.length === 0) {
        throw new VaultDeskError("git-failed", "Update changed no commit-eligible Vault files.");
      }
      scanCommitFiles(vaultPath, commitFiles);
      commit = await commitPaths(vaultPath, commitFiles, control.commitMessage ?? "chore: auto-update " + name);
    } catch (error) {
      const newHead = await currentCommit(vaultPath);
      if (newHead && newHead !== oldHead) {
        commit = newHead;
        finalizationError = "Commit completed but verification needs attention: " + safeMessage(error);
      } else {
        const rollbackErrors: string[] = [];
        try { distribution?.rollback(); } catch (failed) { rollbackErrors.push(safeMessage(failed)); }
        try { backup.restore(); } catch (failed) { rollbackErrors.push(safeMessage(failed)); }
        try {
          const protectedPaths = relativePaths(vaultPath, paths).filter((entry) => !entry.startsWith(".vault/"));
          const reset = await git(["reset", "--", ...protectedPaths], vaultPath, { allowFailure: true });
          if (reset.code !== 0) rollbackErrors.push(reset.stderr || "Git index reset failed.");
        } catch (failed) { rollbackErrors.push(safeMessage(failed)); }
        try { backup.dispose(); } catch (failed) { rollbackErrors.push(safeMessage(failed)); }
        if (rollbackErrors.length > 0) {
          throw new VaultDeskError("conflict", "Automatic update failed and rollback needs attention: " + rollbackErrors.join("; "), { cause: error });
        }
        throw error;
      }
    }
    try { distribution?.finalize(); } catch (error) { finalizationError = [finalizationError, safeMessage(error)].filter(Boolean).join("; "); }
    try { backup.dispose(); } catch (error) { finalizationError = [finalizationError, safeMessage(error)].filter(Boolean).join("; "); }

    try {
      await push(vaultPath);
    } catch (error) {
      try {
        if (!commit) throw new Error("Missing automatic commit ID.");
        writePending(vaultPath, options, {
          schema: 1, vaultPath, sourceName: name, branch: baseGit.branch, upstream: baseGit.upstream,
          remoteHash: sha256(baseGit.remote), pushRef: basePush.pushRef, pushUrlsHash: basePush.pushUrlsHash,
          commit, createdAt: new Date().toISOString(),
        });
      } catch (recordError) {
        return { name, status: "error", commit,
          message: "Automatic commit is local and push failed, but retry tracking could not be saved; manual review required: " + safeMessage(recordError),
          ...(pendingSkills.length > 0 ? { pendingSkills } : {}) };
      }
      return {
        name,
        status: "push-failed",
        commit,
        message: ["Update was committed locally, but push failed: " + safeMessage(error), finalizationError].filter(Boolean).join("; "),
        ...(pendingSkills.length > 0 ? { pendingSkills } : {}),
      };
    }
    if (finalizationError) {
      return { name, status: "error", commit, message: finalizationError, ...(pendingSkills.length > 0 ? { pendingSkills } : {}) };
    }
    return {
      name,
      status: "updated",
      commit,
      ...(pendingSkills.length > 0 ? { pendingSkills, message: "New upstream skills await adoption: " + pendingSkills.join(", ") } : {}),
    };
  });
}

export async function autoSyncVault(inputPath: string, options: AutoSyncOptions = {}): Promise<AutoSyncReport> {
  const vaultPath = canonicalPath(inputPath);
  const retried = await retryPendingPush(vaultPath, options);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") {
    throw new VaultDeskError("not-writable-v1", "Automatic updates require a v2 vault.");
  }
  if (retried && retried.status !== "updated") {
    const sources = snapshot.sources.map((source): AutoSyncSourceResult => source.name === retried.name
      ? retried
      : { name: source.name, status: "skipped", message: "Another automatic commit is still pending push." });
    if (!sources.some((source) => source.name === retried.name)) sources.unshift(retried);
    return { vaultPath, checkedAt: new Date().toISOString(), sources, updated: 0, errors: 1 };
  }
  const selected = snapshot.sources
    .filter((source) => source.origin === "github" && source.updateMode !== "frozen")
    .map((source) => source.name);
  const checked = selected.length > 0
    ? await checkSources(vaultPath, { names: selected, persist: false })
    : { checkedAt: new Date().toISOString(), results: [], warnings: [] };
  if (selected.length > 0) {
    try {
      recordCheck(vaultPath, {
        ...checked,
        results: checked.results.map((result) => result.message
          ? { ...result, message: safeMessage(new VaultDeskError(
            result.status === "auth-failed" ? "auth-failed" : "network", result.message,
          )) }
          : result),
        warnings: [],
      });
    } catch { /* Local check state is advisory; keep processing the sources. */ }
  }
  const byName = new Map(checked.results.map((result) => [result.name, result]));
  const results: AutoSyncSourceResult[] = [];
  let pendingBlocked = false;

  for (const source of [...snapshot.sources].sort((a, b) => a.name.localeCompare(b.name))) {
    if (pendingBlocked) {
      results.push({ name: source.name, status: "skipped", message: "Another automatic commit is still pending push." });
      continue;
    }
    if (source.origin === "local") {
      const drift = localMasterDrift(snapshot, source, options);
      results.push(drift
        ? { name: source.name, status: "error", message: drift }
        : { name: source.name, status: "skipped", message: "Local source has no remote Git update." });
      continue;
    }
    if (source.updateMode === "frozen") {
      results.push({ name: source.name, status: "skipped", message: "Source is paused." });
      continue;
    }
    const check = byName.get(source.name);
    if (!check || check.status === "error" || check.status === "auth-failed") {
      results.push({ name: source.name, status: "error", message: safeMessage(new VaultDeskError(check?.status === "auth-failed" ? "auth-failed" : "network", check?.message ?? "Source check failed.")) });
      continue;
    }
    if (check.status === "current") {
      const drift = githubWorkingDrift(source);
      if (drift) {
        results.push({ name: source.name, status: "error", message: drift });
        continue;
      }
      const distributionDrift = managedDistributionDrift(snapshot, source, options);
      if (distributionDrift.length > 0) {
        results.push({
          name: source.name,
          status: "error",
          message: `Managed distribution drift detected: ${distributionDrift.join("; ")}`,
        });
        continue;
      }
      let pendingSkills: string[] = [];
      try {
        pendingSkills = (await pendingUpstreamSkills(snapshot, source)).map((entry) => entry.sourcePath);
      } catch (error) {
        results.push({ name: source.name, status: "error", message: safeMessage(error) });
        continue;
      }
      const pendingMessage = pendingSkills.length > 0 ? "New upstream skills await adoption: " + pendingSkills.join(", ") : undefined;
      if (source.updateMode === "auto" && needsDistributionRefresh(snapshot, source, options)) {
        try {
          const changed = await distributeCurrentSource(vaultPath, source.name, options);
          results.push({ name: source.name, status: "current", message: [`Distributed current source to ${changed.length} managed paths.`, pendingMessage].filter(Boolean).join(" "), ...(pendingSkills.length > 0 ? { pendingSkills } : {}) });
        } catch (error) {
          results.push({ name: source.name, status: "error", message: safeMessage(error), ...(pendingSkills.length > 0 ? { pendingSkills } : {}) });
        }
      } else {
        results.push({ name: source.name, status: "current", ...(pendingSkills.length > 0 ? { pendingSkills, message: pendingMessage } : {}) });
      }
      continue;
    }
    if (source.updateMode !== "auto") {
      results.push({ name: source.name, status: "skipped", message: "Upstream change awaits manual review." });
      continue;
    }
    try {
      const pendingSkills = (await pendingUpstreamSkills(snapshot, source)).map((entry) => entry.sourcePath);
      if (source.shape === "plugin" && pendingSkills.length > 0) {
        results.push({
          name: source.name,
          status: "skipped",
          pendingSkills,
          message: "Entire plugin update paused, including registered skills, until new upstream skills are reviewed: " + pendingSkills.join(", "),
        });
        continue;
      }
      const updated = await updateOneSource(vaultPath, source.name, options, pendingSkills);
      results.push(updated);
      if (updated.status === "push-failed") pendingBlocked = true;
    } catch (error) {
      results.push({
        name: source.name,
        status: isRemovedUpstream(error) ? "skipped" : "error",
        message: safeMessage(error),
      });
    }
  }
  if (retried?.status === "updated") {
    const recovered = results.find((entry) => entry.name === retried.name);
    if (recovered) {
      recovered.message = [retried.message, recovered.message].filter(Boolean).join(" " );
      recovered.commit ??= retried.commit;
      if (recovered.status === "current") recovered.status = "updated";
    } else {
      results.push(retried);
    }
  }

  return {
    vaultPath,
    checkedAt: checked.checkedAt,
    sources: results,
    updated: results.filter((entry) => entry.status === "updated" || entry.status === "push-failed").length,
    errors: results.filter((entry) => entry.status === "error" || entry.status === "push-failed").length,
  };
}

export async function setSourceUpdateMode(
  inputPath: string,
  sourceName: string,
  mode: "auto" | "review-before-apply" | "frozen",
): Promise<void> {
  if (mode !== "auto" && mode !== "review-before-apply" && mode !== "frozen") {
    throw new VaultDeskError("invalid-input", "Unsupported source update mode.");
  }
  const vaultPath = canonicalPath(inputPath);
  await withWriteLock(vaultPath, async () => {
    const snapshot = await openVault(vaultPath);
    if (snapshot.format !== "v2") {
      throw new VaultDeskError("not-writable-v1", "Source update mode requires a v2 vault.");
    }
    const source = snapshot.sources.find((entry) => entry.name === sourceName);
    if (!source || !source.metadataPath) throw new VaultDeskError("unknown-source", "Unknown source: " + sourceName);
    if (source.origin !== "github" && mode === "auto") {
      throw new VaultDeskError("unsupported", "Local sources cannot auto-pull Git updates.");
    }
    if (!isInside(source.metadataPath, vaultPath)) {
      throw new VaultDeskError("path-escape", "Source metadata escapes its vault.");
    }
    await assertNoDirtyWritePaths(vaultPath, [source.metadataPath]);
    const original = readText(source.metadataPath);
    let parsed: unknown;
    try {
      parsed = YAML.parse(original);
    } catch (error) {
      throw new VaultDeskError("unsupported-schema", "Source metadata is invalid: " + safeMessage(error));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new VaultDeskError("unsupported-schema", "Source metadata must be an object.");
    }
    const raw = parsed as Record<string, unknown>;
    if (raw.update_mode === mode) return;
    const updated = { ...raw, update_mode: mode };
    const validation = sourceFileSchema.safeParse(updated);
    if (!validation.success) {
      throw new VaultDeskError("unsupported-schema", "Source update mode failed validation.");
    }
    if (readPending(vaultPath, {})) {
      throw new VaultDeskError("conflict", "Resolve the previous pending automatic push before changing source mode.");
    }
    const gitState = await getGitSummary(vaultPath);
    if (!gitState.head || !gitState.branch || gitState.branch === "HEAD" || !gitState.upstream ||
      !gitState.remote || gitState.ahead !== 0 || gitState.behind !== 0) {
      throw new VaultDeskError("conflict", "Changing source mode requires a tracking branch with no existing unpushed or incoming Vault commits.");
    }
    const relative = path.relative(vaultPath, source.metadataPath).split(path.sep).join("/");
    let committed = false;
    try {
      writeTextAtomic(source.metadataPath, YAML.stringify(updated, { lineWidth: 0 }));
      await openVault(vaultPath);
      await commitPaths(vaultPath, [relative], "chore: set " + sourceName + " update mode to " + mode);
      committed = true;
    } catch (error) {
      if (!committed) {
        writeTextAtomic(source.metadataPath, original);
        await git(["reset", "--", relative], vaultPath, { allowFailure: true });
      }
      throw error;
    }
    try { await push(vaultPath); }
    catch (error) {
      throw new VaultDeskError("git-failed", "Source mode was committed locally but could not be pushed: " + safeMessage(error), { cause: error });
    }
  });
}
