import type {
  LockFile,
  Operation,
  Origin,
  PackageKind,
  Shape,
  ToolCard,
  UpdateMode,
  VaultState,
  VaultFile,
} from "@vaultdesk/schema";
import type { GitSummary } from "./git.js";

export type VaultFormat = "v1" | "v2";

export type CheckStatus =
  | "local"
  | "current"
  | "update-available"
  | "not-downloaded"
  | "auth-failed"
  | "error"
  | "unknown";

export type InstallSlotState = "create" | "managed" | "symlink" | "unmanaged";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checkedAt: string;
}

export interface InstalledSkill {
  targetId: string;
  dest: string;
  path: string;
  managed: boolean;
  managedByThisVault: boolean;
  installedAt?: string;
  hash?: string;
  matches?: boolean;
  isSymlink: boolean;
  linkTarget?: string;
}

export type ExternalSkillStatus = "ok" | "observed" | "drift" | "missing" | "invalid" | "conflict";

export interface ExternalSkillRecord {
  name: string;
  owner: string;
  skillPath: string;
  title?: string;
  version?: string;
  expectedHash?: string;
  relatedTool?: string;
  description?: string;
  notes?: string;
  metadataPath: string;
  relativePath: string;
  exists: boolean;
  hasSkillFile: boolean;
  observedHash?: string;
  observedVersion?: string;
  modifiedAt?: string;
  hashMatches?: boolean;
  markerPresent: boolean;
  status: ExternalSkillStatus;
}

export interface SkillRecord {
  name: string;
  description?: string;
  shape: "standalone" | "package-skill" | "plugin-skill";
  origin: Origin;
  sourceName: string;
  pluginName?: string;
  packageName?: string;
  packageKind?: PackageKind;
  workingPath: string;
  relativePath: string;
  sourcePath?: string;
  vendorPath?: string;
  targetPath?: string;
  repo?: string;
  ref?: string;
  userInvocable: boolean;
  isEntrypoint: boolean;
  version?: string;
  forkedFrom?: { repo: string; ref: string; source_path: string; commit?: string };
  installed: InstalledSkill[];
  contentHash: string;
  lockedHash?: string;
}

export interface SourceRecord {
  name: string;
  shape: Shape;
  kind?: PackageKind;
  entrypoint?: string;
  origin: Origin;
  repo?: string;
  remoteUrl?: string;
  ref: string;
  updateMode: UpdateMode;
  version?: string;
  description?: string;
  contentPath?: string;
  workingPath: string;
  vendorRoot?: string;
  metadataPath?: string;
  manifestPath?: string;
  scriptDeps?: Record<string, string[]>;
  skills: SkillRecord[];
  locked?: { commit?: string; hash?: string; skills?: Record<string, string> };
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  remoteCommit?: string;
  lastError?: string;
  status: CheckStatus;
}

export interface TargetRecord {
  id: string;
  dest: string;
  expandedDest: string;
  names: string[];
  /** Exact skill selectors; absent for legacy source-or-skill targets. */
  skillsOnly?: boolean;
  installAfterUpdate: boolean;
  exists: boolean;
  skills: string[];
  installed: InstalledSkill[];
  otherManaged: InstalledSkill[];
  lastInstalledAt?: string;
  installedHash?: string;
}

export type PluginAgent = "claude" | "codex" | "qoder" | "generic";

export type PluginAssetKind =
  | "skills"
  | "commands"
  | "agents"
  | "hooks"
  | "mcp"
  | "rules"
  | "workflows"
  | "other";

export interface PluginManifest {
  agent: PluginAgent;
  path: string;
  relativePath: string;
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  parseError?: string;
}

export interface PluginAsset {
  kind: PluginAssetKind;
  path: string;
  relativePath: string;
}

export interface ToolRecord extends ToolCard {
  path: string;
  relativePath: string;
}

export interface PluginRecord {
  name: string;
  origin: Origin;
  repo?: string;
  ref: string;
  version?: string;
  description?: string;
  license?: string;
  contentPath?: string;
  workingPath: string;
  vendorRoot?: string;
  metadataPath: string;
  manifests: PluginManifest[];
  assets: PluginAsset[];
  otherCount: number;
  hasHooks: boolean;
  skills: SkillRecord[];
  locked?: { commit?: string; hash?: string; skills?: Record<string, string> };
  status: CheckStatus;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  remoteCommit?: string;
  lastError?: string;
}

export interface VaultSnapshot {
  path: string;
  name: string;
  format: VaultFormat;
  schemaVersion: number;
  readOnly: boolean;
  sources: SourceRecord[];
  skills: SkillRecord[];
  externalSkills: ExternalSkillRecord[];
  plugins: PluginRecord[];
  tools: ToolRecord[];
  targets: TargetRecord[];
  git: GitSummary;
  issues: ValidationIssue[];
  warnings: string[];
  counts: {
    sources: number;
    packages: number;
    skills: number;
    externalSkills: number;
    plugins: number;
    pluginSkills: number;
    tools: number;
    targets: number;
    managedInstalls: number;
  };
  metadata: VaultFile;
  locked?: LockFile;
  state?: VaultState;
  operation?: Operation | null;
}

export interface CheckResult {
  name: string;
  origin: Origin;
  status: CheckStatus;
  currentCommit?: string;
  remoteCommit?: string;
  message?: string;
}

export interface CheckReport {
  checkedAt: string;
  results: CheckResult[];
  warnings: string[];
}

export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified" | "type-changed";
  binary: boolean;
  bytesBefore: number;
  bytesAfter: number;
  patch?: string;
  truncated?: boolean;
}

export interface SourceDiff {
  name: string;
  workingPath: string;
  upstreamPath: string;
  fromCommit?: string;
  toCommit: string;
  files: DiffFile[];
  summary: { added: number; deleted: number; modified: number; binary: number };
  warnings: string[];
}

export interface InstallSlotPlan {
  skill: string;
  slot: string;
  state: InstallSlotState;
  action: "create" | "replace-managed" | "replace-symlink" | "backup-and-replace";
  backupPath?: string;
  linkTarget?: string;
}

export interface InstallPlan {
  targetId: string;
  dest: string;
  slots: InstallSlotPlan[];
  warnings: string[];
}

export interface InstallVerification {
  targetId: string;
  filesInPlace: boolean;
  checked: number;
  missing: string[];
  modified: string[];
}

export interface InstallResult {
  targetId: string;
  dest: string;
  installed: number;
  plan: InstallPlan;
  backups: { skill: string; from: string; to: string }[];
  verification: InstallVerification;
}

export interface MigrationWrite {
  path: string;
  content: string;
}

export interface MigrationPlan {
  from: "v1";
  vaultPath: string;
  name: string;
  branch: string;
  writes: MigrationWrite[];
  deletes: string[];
  unaffected: string[];
  warnings: string[];
  diff: string;
  cleanWorktree: boolean;
  skillCount: number;
  sourceCount: number;
}

export interface MigrationResult {
  branch: string;
  commit?: string;
  plan: MigrationPlan;
  validation: ValidationReport;
}

export interface ImportSkillCandidate {
  name: string;
  path: string;
  relativePath: string;
  description?: string;
}

export interface ImportPreview {
  inputPath: string;
  shape: "standalone" | "package";
  kind: PackageKind;
  suggestedName: string;
  entrypoint?: string;
  skills: ImportSkillCandidate[];
  targetRoot: string;
  conflicts: string[];
  warnings: string[];
}

export interface ImportResult {
  sourceName: string;
  shape: "standalone" | "package";
  kind?: PackageKind;
  skillNames: string[];
  wrote: string[];
}

export interface PluginImportPreview {
  inputPath: string;
  shape: "plugin";
  detectedBy: "manifest" | "composition" | "override";
  suggestedName: string;
  rootPath: string;
  relativePath: string;
  manifests: PluginManifest[];
  assets: PluginAsset[];
  skills: ImportSkillCandidate[];
  hasHooks: boolean;
  conflicts: string[];
  warnings: string[];
  repo?: string;
  ref?: string;
  commit?: string;
}

export interface PluginImportResult {
  sourceName: string;
  shape: "plugin";
  skillNames: string[];
  wrote: string[];
  commit?: string;
}

export interface AdoptPreview {
  skill: string;
  sourceName: string;
  owner: string;
  skillPath: string;
  cardPath: string;
  title?: string;
  version?: string;
  expectedHash?: string;
  relatedTool?: string;
  contentPath: string;
  vendorPath?: string;
  markerPath?: string;
  markerOwnedByThisVault: boolean;
  targetIds: string[];
  warnings: string[];
}

export interface ForkPreview {
  skill: string;
  sourceName: string;
  newSourceName: string;
  targetPath: string;
  from?: { repo: string; ref: string; source_path: string; commit?: string };
  removesFromPackage: boolean;
  warnings: string[];
}

export interface SearchHit {
  vaultPath: string;
  vaultName: string;
  skill: string;
  sourceName: string;
  pluginName?: string;
  origin: Origin | "external";
  shape: "standalone" | "package-skill" | "plugin-skill" | "plugin" | "tool" | "external-skill";
  toolKind?: ToolCard["kind"];
  description?: string;
  relativePath: string;
  installedTargets: string[];
  score: number;
}

export interface UpdateChange {
  name: string;
  commit: string;
  files: DiffFile[];
}

export interface UpdateResult {
  applied: boolean;
  names: string[];
  changes: UpdateChange[];
  validation?: ValidationReport;
  build?: { skills: string[] };
  install?: InstallResult[];
  commit?: string;
  warnings: string[];
}
