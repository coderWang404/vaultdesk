import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ToolCard } from "@vaultdesk/schema";
import { detectVaultFormat } from "./vault/model.js";
import {
  canonicalPath,
  expandHome,
  hashDirectory,
  isDirectory,
  isFile,
  readText,
  walkFiles,
} from "./fsx.js";
import { managedAgentsSkillsRoot } from "./distribution.js";
import { settingsPath as defaultSettingsPath } from "./settings.js";
import type {
  ExternalSkillRecord,
  PluginRecord,
  SkillRecord,
  SourceRecord,
  TargetRecord,
  ToolRecord,
  VaultSnapshot,
} from "./types.js";

/** A registered Vault entry from the desktop recent-vaults registry. */
export interface RegisteredVault {
  path: string;
  name?: string;
  openedAt?: string;
  exists: boolean;
  isDirectory: boolean;
  format: "v1" | "v2" | null;
  status: "ready" | "missing" | "not-directory" | "not-vault";
}

export type CatalogFileStatus =
  | "missing"
  | "current"
  | "outdated"
  | "modified"
  | "unmanaged"
  | "foreign"
  | "invalid"
  | "symlink";

export interface CatalogFileState {
  path: string;
  exists: boolean;
  isSymlink: boolean;
  markerPath?: string;
  markerPresent: boolean;
  markerOwnedByVault: boolean;
  expectedHash?: string;
  observedHash?: string;
  hashMatches?: boolean;
  sourceHash?: string;
  sourceMatches?: boolean;
  status: CatalogFileStatus;
  linkTarget?: string;
}

export interface AgentCatalogSource {
  name: string;
  shape: SourceRecord["shape"];
  origin: SourceRecord["origin"];
  repo?: string;
  remoteUrl?: string;
  ref: string;
  updateMode: SourceRecord["updateMode"];
  automaticUpdates: boolean;
  status: SourceRecord["status"];
  remoteCommit?: string;
  skillNames: string[];
}

export interface AgentCatalogSkill {
  name: string;
  description?: string;
  shape: SkillRecord["shape"];
  origin: SkillRecord["origin"];
  sourceName: string;
  pluginName?: string;
  packageName?: string;
  contentHash: string;
  lockedHash?: string;
  sourcePath?: string;
  master: CatalogFileState;
  installedTargets: Array<CatalogFileState & { targetId: string; installAfterUpdate: boolean }>;
  agentLoaded: "unknown";
}

export interface AgentCatalogTarget {
  id: string;
  path: string;
  exists: boolean;
  installAfterUpdate: boolean;
  skillsOnly: boolean;
  selectors: string[];
  skillNames: string[];
  files: Array<CatalogFileState & { skillName: string }>;
}

export interface AgentCatalogPluginTarget {
  id: string;
  path: string;
  pluginName: string;
  exists: boolean;
  installAfterUpdate: boolean;
  file: CatalogFileState;
}

export interface AgentCatalogPlugin {
  name: string;
  origin: PluginRecord["origin"];
  repo?: string;
  ref: string;
  version?: string;
  vaultRoot: string;
  vaultFile: CatalogFileState;
  containedSkills: string[];
  assetKinds: string[];
  targetFiles: AgentCatalogPluginTarget[];
  agentLoaded: "unknown";
  agentConnected: "unknown";
}

export interface AgentCatalogTool {
  name: string;
  title: string;
  kind: ToolCard["kind"];
  capabilities: Array<ToolCard["kind"] | "mcp">;
  summary: string;
  homepage: string;
  docs?: string;
  recordedVersion?: string;
  install: ToolCard["install"];
  run?: string;
  requirements: string[];
  relatedSkills: string[];
  checks: ToolCard["checks"];
  tags: string[];
  notes?: string;
  installState: "unknown";
  enabledState: "unknown";
  connectedState: "unknown";
  readiness: "unknown";
}

export interface AgentCatalogExternalSkill {
  name: string;
  owner: string;
  path: string;
  relatedTool?: string;
  expectedHash?: string;
  observedHash?: string;
  observedVersion?: string;
  status: ExternalSkillRecord["status"];
  readOnly: true;
  agentLoaded: "unknown";
}

export interface AgentCatalogMaster {
  path: string;
  exists: boolean;
  skillFiles: Array<{ skillName: string; file: CatalogFileState }>;
}

export interface AgentCatalog {
  schema: 1;
  vault: { path: string; name: string; format: VaultSnapshot["format"]; readOnly: boolean };
  sources: AgentCatalogSource[];
  skills: AgentCatalogSkill[];
  master: AgentCatalogMaster;
  targets: AgentCatalogTarget[];
  plugins: AgentCatalogPlugin[];
  tools: AgentCatalogTool[];
  externalSkills: AgentCatalogExternalSkill[];
  agent: { loaded: "unknown"; connected: "unknown" };
}

interface RecentVaultEntry {
  path?: unknown;
  name?: unknown;
  openedAt?: unknown;
}

function redactRemoteUrl(value: string): string {
  return value
    .replace(/\b(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
    .replace(/\b(token|api[_-]?key|secret|password|access[_-]?key)\s*([=:])\s*([^\s&,'";]+)/gi, "$1$2[redacted]");
}

function registryPathFor(settingsFile: string): string {
  return path.join(path.dirname(settingsFile), "recent-vaults.json");
}

function recentEntries(raw: unknown): RecentVaultEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const values = Array.isArray(record.vaults)
    ? record.vaults
    : Array.isArray(record.recentVaults)
      ? record.recentVaults
      : [];
  return values.filter((value): value is RecentVaultEntry => Boolean(value) && typeof value === "object");
}

/**
 * Read only the desktop's registered Vault list. This deliberately does not
 * search the filesystem and does not load Vaults or invoke Git.
 *
 * `settingsFile` is the settings.json path; recent-vaults.json lives beside
 * it in the desktop app. Passing a path ending in recent-vaults.json also
 * works and is useful for callers/tests that already have the registry path.
 */
export function listRegisteredVaults(settingsFile?: string): RegisteredVault[] {
  const settings = settingsFile ?? defaultSettingsPath();
  const registry = path.basename(settings) === "recent-vaults.json" ? settings : registryPathFor(settings);
  let raw: unknown;
  try {
    const settingsRaw: unknown = JSON.parse(readText(settings));
    if (recentEntries(settingsRaw).length > 0) raw = settingsRaw;
  } catch {
    // Fall through to the desktop registry beside settings.json.
  }
  if (!raw) {
    try {
      raw = JSON.parse(readText(registry));
    } catch {
      return [];
    }
  }
  const seen = new Set<string>();
  const result: RegisteredVault[] = [];
  for (const entry of recentEntries(raw)) {
    if (typeof entry.path !== "string" || entry.path.trim() === "") continue;
    const vaultPath = canonicalPath(entry.path);
    if (seen.has(vaultPath)) continue;
    seen.add(vaultPath);
    const exists = fs.existsSync(vaultPath);
    const isDir = exists && isDirectory(vaultPath);
    const format = isDir ? detectVaultFormat(vaultPath) : null;
    result.push({
      path: vaultPath,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.openedAt === "string" ? { openedAt: entry.openedAt } : {}),
      exists,
      isDirectory: isDir,
      format,
      status: !exists ? "missing" : !isDir ? "not-directory" : !format ? "not-vault" : "ready",
    });
  }
  return result;
}

function markerFor(slot: string, markerName: string): { path: string; data?: Record<string, unknown> } {
  const markerPath = path.join(slot, markerName);
  if (!isFile(markerPath)) return { path: markerPath };
  try {
    const value: unknown = JSON.parse(readText(markerPath));
    return { path: markerPath, data: value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined };
  } catch {
    return { path: markerPath, data: undefined };
  }
}

function sameVault(value: unknown, vaultPath: string): boolean {
  return typeof value === "string" && canonicalPath(value) === canonicalPath(vaultPath);
}

function managedHash(root: string, plugin: boolean): string {
  if (!isDirectory(root)) return "";
  if (!plugin) return hashDirectory(root);
  const hash = createHash("sha256");
  for (const entry of walkFiles(root, {
    excludeFiles: new Set([".vault-managed", ".vaultdesk-plugin-managed", ".source.yml", ".source-commit", ".DS_Store"]),
    excludeDirs: new Set([".git", ".vault", "node_modules", "__pycache__", ".DS_Store"]),
  })) {
    hash.update(entry.rel);
    hash.update("\0");
    if (entry.kind === "symlink") {
      hash.update("symlink\0");
      hash.update(fs.readlinkSync(entry.abs));
    } else {
      hash.update(String(entry.mode & 0o111));
      hash.update("\0");
      hash.update(fs.readFileSync(entry.abs));
    }
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function inspectManagedFile(
  slot: string,
  vaultPath: string,
  markerName: string,
  ownerKey: "skill" | "plugin",
  ownerName: string,
  expectedTargetId?: string,
  plugin = false,
): CatalogFileState {
  const marker = markerFor(slot, markerName);
  let stat: fs.Stats | undefined;
  try { stat = fs.lstatSync(slot); } catch { /* missing */ }
  const exists = Boolean(stat);
  const isSymlink = Boolean(stat?.isSymbolicLink());
  const base: CatalogFileState = {
    path: slot,
    exists,
    isSymlink,
    markerPath: marker.path,
    markerPresent: isFile(marker.path),
    markerOwnedByVault: sameVault(marker.data?.vault, vaultPath),
    ...(isSymlink ? { linkTarget: fs.readlinkSync(slot) } : {}),
    status: "missing",
  };
  if (!stat) return base;
  if (isSymlink) return { ...base, status: "symlink" };
  if (!stat.isDirectory()) return { ...base, status: "invalid" };
  if (!marker.data) return { ...base, status: "unmanaged" };
  if (!base.markerOwnedByVault || marker.data[ownerKey] !== ownerName ||
      (expectedTargetId && marker.data.target_id !== expectedTargetId)) {
    return { ...base, status: "foreign" };
  }
  const expectedHash = typeof marker.data.hash === "string" ? marker.data.hash : undefined;
  const observedHash = managedHash(slot, plugin);
  const hashMatches = Boolean(expectedHash && expectedHash === observedHash);
  return {
    ...base,
    ...(expectedHash ? { expectedHash } : {}),
    observedHash,
    hashMatches,
    status: hashMatches ? "current" : "modified",
  };
}

function targetFileState(
  target: TargetRecord,
  skillName: string,
  vaultPath: string,
  masterRoot: string,
): CatalogFileState {
  const targetRoot = canonicalPath(expandHome(target.dest));
  const slot = path.join(targetRoot, skillName);
  if (targetRoot === canonicalPath(masterRoot)) {
    return inspectManagedFile(slot, vaultPath, ".vault-managed", "skill", skillName);
  }
  const state = inspectManagedFile(slot, vaultPath, ".vault-managed", "skill", skillName, target.id);
  if (state.status !== "symlink") return state;
  let resolved: string | undefined;
  try { resolved = fs.realpathSync(slot); } catch { /* broken link */ }
  const master = path.join(masterRoot, skillName);
  if (!resolved || canonicalPath(resolved) !== canonicalPath(master)) return state;
  const masterState = inspectManagedFile(master, vaultPath, ".vault-managed", "skill", skillName);
  const masterMarker = markerFor(master, ".vault-managed").data;
  const targetRegistered = Array.isArray(masterMarker?.targets) && masterMarker.targets.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const link = item as Record<string, unknown>;
    return link.id === target.id && link.mode === "symlink" &&
      typeof link.path === "string" &&
      path.join(canonicalPath(path.dirname(link.path)), path.basename(link.path)) === slot;
  });
  if (!targetRegistered) return { ...state, status: "foreign" };
  return {
    ...state,
    markerPath: masterState.markerPath,
    markerPresent: masterState.markerPresent,
    markerOwnedByVault: masterState.markerOwnedByVault,
    expectedHash: masterState.expectedHash,
    observedHash: masterState.observedHash,
    hashMatches: masterState.hashMatches,
    status: masterState.status === "current" ? "current" : masterState.status,
  };
}

function compareWithSource(state: CatalogFileState, sourceHash: string | undefined): CatalogFileState {
  if (!sourceHash) return state;
  const sourceMatches = Boolean(state.observedHash && state.observedHash === sourceHash);
  return {
    ...state,
    sourceHash,
    sourceMatches,
    status: state.status === "current" && !sourceMatches ? "outdated" : state.status,
  };
}

function inspectVaultContent(root: string, expectedHash: string | undefined): CatalogFileState {
  let stat: fs.Stats | undefined;
  try { stat = fs.lstatSync(root); } catch { /* missing */ }
  const isSymlink = Boolean(stat?.isSymbolicLink());
  const base: CatalogFileState = {
    path: root,
    exists: Boolean(stat),
    isSymlink,
    markerPresent: false,
    markerOwnedByVault: false,
    ...(isSymlink ? { linkTarget: fs.readlinkSync(root) } : {}),
    status: "missing",
  };
  if (!stat) return base;
  if (isSymlink || !stat.isDirectory()) return { ...base, status: isSymlink ? "symlink" : "invalid" };
  const observedHash = managedHash(root, true);
  const hashMatches = Boolean(expectedHash && expectedHash === observedHash);
  return {
    ...base,
    ...(expectedHash ? { expectedHash } : {}),
    observedHash,
    hashMatches,
    status: expectedHash ? (hashMatches ? "current" : "modified") : "current",
  };
}

function toolCatalog(tool: ToolRecord): AgentCatalogTool {
  const capabilities = Array.from(new Set<ToolCard["kind"] | "mcp">([
    tool.kind,
    ...(tool.tags.includes("mcp") ? ["mcp" as const] : []),
  ]));
  return {
    name: tool.name,
    title: tool.title,
    kind: tool.kind,
    capabilities,
    summary: tool.summary,
    homepage: tool.homepage,
    ...(tool.docs ? { docs: tool.docs } : {}),
    ...(tool.recorded_version ? { recordedVersion: tool.recorded_version } : {}),
    install: tool.install,
    ...(tool.run ? { run: tool.run } : {}),
    requirements: tool.requirements,
    relatedSkills: tool.related_skills,
    checks: tool.checks,
    tags: tool.tags,
    ...(tool.notes ? { notes: tool.notes } : {}),
    installState: "unknown",
    enabledState: "unknown",
    connectedState: "unknown",
    readiness: "unknown",
  };
}

/** Build a read-only, agent-facing catalog from an already loaded Vault. */
export function buildAgentCatalog(
  snapshot: VaultSnapshot,
  options: { agentsSkillsDir?: string } = {},
): AgentCatalog {
  const vaultPath = canonicalPath(snapshot.path);
  const masterRoot = canonicalPath(options.agentsSkillsDir ?? managedAgentsSkillsRoot());
  const sources: AgentCatalogSource[] = snapshot.sources.map((source) => ({
    name: source.name,
    shape: source.shape,
    origin: source.origin,
    ...(source.repo ? { repo: source.repo } : {}),
    ...(source.remoteUrl ? { remoteUrl: redactRemoteUrl(source.remoteUrl) } : {}),
    ref: source.ref,
    updateMode: source.updateMode,
    automaticUpdates: source.origin === "github" && source.updateMode === "auto",
    status: source.status,
    ...(source.remoteCommit ? { remoteCommit: source.remoteCommit } : {}),
    skillNames: source.skills.map((skill) => skill.name),
  }));
  const targetBySkill = new Map<string, TargetRecord[]>();
  for (const target of snapshot.targets) {
    for (const name of target.skills) targetBySkill.set(name, [...(targetBySkill.get(name) ?? []), target]);
  }
  const skills: AgentCatalogSkill[] = snapshot.skills.map((skill) => {
    const master = compareWithSource(inspectManagedFile(path.join(masterRoot, skill.name), vaultPath, ".vault-managed", "skill", skill.name), skill.contentHash);
    const installedTargets = (targetBySkill.get(skill.name) ?? []).map((target) => ({
      ...compareWithSource(targetFileState(target, skill.name, vaultPath, masterRoot), skill.contentHash),
      targetId: target.id,
      installAfterUpdate: target.installAfterUpdate,
    }));
    return {
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      shape: skill.shape,
      origin: skill.origin,
      sourceName: skill.sourceName,
      ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
      ...(skill.packageName ? { packageName: skill.packageName } : {}),
      contentHash: skill.contentHash,
      ...(skill.lockedHash ? { lockedHash: skill.lockedHash } : {}),
      ...(skill.sourcePath ? { sourcePath: skill.sourcePath } : {}),
      master,
      installedTargets,
      agentLoaded: "unknown",
    };
  });
  const targets: AgentCatalogTarget[] = snapshot.targets.map((target) => {
    const targetPath = canonicalPath(expandHome(target.dest));
    return {
      id: target.id,
      path: targetPath,
      exists: isDirectory(targetPath),
      installAfterUpdate: target.installAfterUpdate,
      skillsOnly: target.skillsOnly === true,
      selectors: target.names,
      skillNames: target.skills,
      files: target.skills.map((skillName) => ({
        skillName,
        ...compareWithSource(targetFileState(target, skillName, vaultPath, masterRoot), snapshot.skills.find((skill) => skill.name === skillName)?.contentHash),
      })),
    };
  });
  const pluginTargets = Array.isArray(snapshot.metadata.plugin_targets) ? snapshot.metadata.plugin_targets : [];
  const plugins: AgentCatalogPlugin[] = snapshot.plugins.map((plugin) => {
    const vaultFile = inspectVaultContent(plugin.workingPath, plugin.locked?.hash);
    const targetFiles = pluginTargets
      .filter((target) => target.names.includes(plugin.name))
      .map((target) => {
        const targetRoot = canonicalPath(expandHome(target.dest));
        const file = compareWithSource(inspectManagedFile(path.join(targetRoot, plugin.name), vaultPath, ".vaultdesk-plugin-managed", "plugin", plugin.name, target.id, true), vaultFile.observedHash);
        return {
          id: target.id,
          path: targetRoot,
          pluginName: plugin.name,
          exists: isDirectory(targetRoot),
          installAfterUpdate: target.install_after_update,
          file,
        };
      });
    return {
      name: plugin.name,
      origin: plugin.origin,
      ...(plugin.repo ? { repo: plugin.repo } : {}),
      ref: plugin.ref,
      ...(plugin.version ? { version: plugin.version } : {}),
      vaultRoot: plugin.workingPath,
      vaultFile,
      containedSkills: plugin.skills.map((skill) => skill.name),
      assetKinds: [...new Set(plugin.assets.map((asset) => asset.kind))].sort(),
      targetFiles,
      agentLoaded: "unknown",
      agentConnected: "unknown",
    };
  });
  const masterSkillNames = new Set(snapshot.skills.map((skill) => skill.name));
  const master: AgentCatalogMaster = {
    path: masterRoot,
    exists: isDirectory(masterRoot),
    skillFiles: [...masterSkillNames].sort().map((skillName) => ({
      skillName,
      file: skills.find((skill) => skill.name === skillName)!.master,
    })),
  };
  return {
    schema: 1,
    vault: { path: vaultPath, name: snapshot.name, format: snapshot.format, readOnly: snapshot.readOnly },
    sources,
    skills,
    master,
    targets,
    plugins,
    tools: snapshot.tools.map(toolCatalog),
    externalSkills: snapshot.externalSkills.map((skill) => ({
      name: skill.name,
      owner: skill.owner,
      path: skill.skillPath,
      ...(skill.relatedTool ? { relatedTool: skill.relatedTool } : {}),
      ...(skill.expectedHash ? { expectedHash: skill.expectedHash } : {}),
      ...(skill.observedHash ? { observedHash: skill.observedHash } : {}),
      ...(skill.observedVersion ? { observedVersion: skill.observedVersion } : {}),
      status: skill.status,
      readOnly: true,
      agentLoaded: "unknown",
    })),
    agent: { loaded: "unknown", connected: "unknown" },
  };
}

