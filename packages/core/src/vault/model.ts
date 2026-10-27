import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  lockSchema,
  sourceFileSchema,
  vaultFileSchema,
  vaultStateSchema,
  type LockFile,
  type Operation,
  type SourceFile,
  type VaultFile,
  type VaultState,
} from "@vaultdesk/schema";
import {
  canonicalPath,
  exists,
  expandHome,
  hashDirectory,
  hashText,
  isDirectory,
  isFile,
  listDirectory,
  readJson,
  readText,
  relativeSlash,
  sha256,
} from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { getGitSummary } from "../git.js";
import { parseFrontmatter, frontmatterDescription, frontmatterName } from "../frontmatter.js";
import { readJournal } from "../journal.js";
import { inspectPlugin } from "../plugins/discover.js";
import type {
  CheckStatus,
  InstalledSkill,
  PluginRecord,
  SkillRecord,
  SourceRecord,
  TargetRecord,
  VaultFormat,
  VaultSnapshot,
} from "../types.js";

interface V1RawSource {
  name?: string;
  origin?: string;
  repo?: string;
  ref?: string;
  source_path?: string;
  vendor_path?: string;
  target_path?: string;
  update_mode?: string;
}

interface V1RawPackage {
  name?: string;
  version?: string;
  description?: string;
  kind?: string;
  entrypoint?: string;
  origin?: string;
  repo?: string;
  remote_url?: string;
  ref?: string;
  update_mode?: string;
  script_deps?: Record<string, string[]>;
  skills?: {
    name?: string;
    source_path?: string;
    vendor_path?: string;
    user_invocable?: boolean;
  }[];
}

interface V1RawSourcesFile {
  skills?: V1RawSource[];
  packages?: { name?: string; manifest?: string }[];
}

interface V1RawTargetsFile {
  targets?: {
    id?: string;
    dest?: string;
    names?: string[];
    install_after_update?: boolean;
  }[];
}

export function detectVaultFormat(vaultPath: string): VaultFormat | null {
  if (!isDirectory(vaultPath)) return null;
  if (isFile(path.join(vaultPath, "vault.yml"))) return "v2";
  if (
    isFile(path.join(vaultPath, "sources.yml")) ||
    isFile(path.join(vaultPath, "install-targets.yml")) ||
    isDirectory(path.join(vaultPath, "packages"))
  ) {
    return "v1";
  }
  return null;
}

function parseYamlFile(filePath: string): { value: unknown; error?: string } {
  try {
    return { value: YAML.parse(readText(filePath)) };
  } catch (error) {
    return { value: undefined, error: (error as Error).message };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function uniqueStrings(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function skillSetHash(skills: SkillRecord[]): string {
  const pairs = skills
    .map((skill) => [skill.name, skill.contentHash] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return hashText(JSON.stringify(pairs));
}

function sourceLockHash(skills: SkillRecord[]): string {
  return hashText(
    JSON.stringify(
      skills
        .map((skill) => [skill.name, skill.contentHash] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  );
}

function readSkillFrontmatter(workingPath: string, warnings: string[]): { description?: string } {
  const skillFile = path.join(workingPath, "SKILL.md");
  if (!isFile(skillFile)) return {};
  try {
    const parsed = parseFrontmatter(readText(skillFile));
    if (parsed.error) warnings.push(`${relativeSlash(path.dirname(workingPath), skillFile)}: ${parsed.error}`);
    return { description: frontmatterDescription(parsed.data) };
  } catch (error) {
    warnings.push(`${skillFile}: ${(error as Error).message}`);
    return {};
  }
}

function makeSkillRecord(input: {
  vaultPath: string;
  name: string;
  sourceName: string;
  shape: "standalone" | "package-skill";
  origin: SkillRecord["origin"];
  workingPath: string;
  sourcePath?: string;
  vendorPath?: string;
  targetPath?: string;
  repo?: string;
  ref?: string;
  version?: string;
  packageName?: string;
  packageKind?: SkillRecord["packageKind"];
  userInvocable?: boolean;
  isEntrypoint?: boolean;
  forkedFrom?: SkillRecord["forkedFrom"];
  warnings: string[];
}): SkillRecord {
  const described = readSkillFrontmatter(input.workingPath, input.warnings);
  return {
    name: input.name,
    description: described.description,
    shape: input.shape,
    origin: input.origin,
    sourceName: input.sourceName,
    packageName: input.packageName,
    packageKind: input.packageKind,
    workingPath: input.workingPath,
    relativePath: relativeSlash(input.vaultPath, input.workingPath),
    sourcePath: input.sourcePath,
    vendorPath: input.vendorPath,
    targetPath: input.targetPath,
    repo: input.repo,
    ref: input.ref,
    userInvocable: input.userInvocable ?? true,
    isEntrypoint: input.isEntrypoint ?? false,
    version: input.version,
    forkedFrom: input.forkedFrom,
    installed: [],
    contentHash: hashDirectory(input.workingPath),
  };
}

function deriveStatus(
  origin: SkillRecord["origin"],
  lockedCommit: string | undefined,
  remoteCommit: string | undefined,
  persistedStatus: CheckStatus | undefined,
): CheckStatus {
  if (origin === "local") return "local";
  if (persistedStatus === "error" || persistedStatus === "auth-failed") return persistedStatus;
  if (!lockedCommit) return "not-downloaded";
  if (!remoteCommit) return "unknown";
  return lockedCommit === remoteCommit ? "current" : "update-available";
}

function makePluginRecord(input: {
  vaultPath: string;
  name: string;
  origin: PluginRecord["origin"];
  repo?: string;
  ref: string;
  version?: string;
  description?: string;
  contentPath?: string;
  metadataPath: string;
  warnings: string[];
  locked?: PluginRecord["locked"];
  status: CheckStatus;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  remoteCommit?: string;
  lastError?: string;
}): PluginRecord {
  const workingPath = path.join(input.vaultPath, "plugins", input.name);
  const inspected = inspectPlugin({
    root: workingPath,
    vaultPath: input.vaultPath,
    sourceName: input.name,
    origin: input.origin,
    repo: input.repo,
    ref: input.ref,
    warnings: input.warnings,
  });
  for (const skill of inspected.skills) {
    skill.lockedHash = input.locked?.skills?.[skill.name] ?? input.locked?.hash;
  }
  return {
    name: input.name,
    origin: input.origin,
    repo: input.repo,
    ref: input.ref,
    version: input.version,
    description: input.description,
    license: inspected.license,
    contentPath: input.contentPath,
    workingPath,
    vendorRoot: input.origin === "github" ? path.join(input.vaultPath, "third_party", input.name) : undefined,
    metadataPath: input.metadataPath,
    manifests: inspected.manifests,
    assets: inspected.assets,
    otherCount: inspected.otherCount,
    hasHooks: inspected.hasHooks,
    skills: inspected.skills,
    locked: input.locked,
    status: input.status,
    lastCheckedAt: input.lastCheckedAt,
    lastAppliedAt: input.lastAppliedAt,
    remoteCommit: input.remoteCommit,
    lastError: input.lastError,
  };
}

async function loadV2(vaultPath: string): Promise<{
  snapshot: Omit<VaultSnapshot, "git" | "operation" | "issues">;
  rawWarnings: string[];
}> {
  const warnings: string[] = [];
  const vaultFile = path.join(vaultPath, "vault.yml");
  const parsedVault = parseYamlFile(vaultFile);
  let metadata: VaultFile;
  let schemaVersion = 1;
  if (parsedVault.error) {
    warnings.push(`vault.yml: ${parsedVault.error}`);
    metadata = {
      schema: 1,
      name: path.basename(vaultPath),
      defaults: { ref: "main", update_mode: "review-before-apply" },
      targets: [],
    };
  } else {
    const result = vaultFileSchema.safeParse(parsedVault.value);
    if (result.success) {
      metadata = result.data;
      schemaVersion = result.data.schema;
    } else {
      warnings.push(`vault.yml: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      const raw = asRecord(parsedVault.value);
      metadata = {
        schema: 1,
        name: typeof raw.name === "string" ? raw.name : path.basename(vaultPath),
        defaults: { ref: "main", update_mode: "review-before-apply" },
        targets: Array.isArray(raw.targets) ? (raw.targets as VaultFile["targets"]) : [],
      };
    }
  }

  let lock: LockFile | undefined;
  const lockFile = path.join(vaultPath, "vault.lock");
  if (isFile(lockFile)) {
    const parsed = parseYamlFile(lockFile);
    if (parsed.error) warnings.push(`vault.lock: ${parsed.error}`);
    else {
      const result = lockSchema.safeParse(parsed.value);
      if (result.success) lock = result.data;
      else warnings.push(`vault.lock: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
    }
  }

  let state: VaultState | undefined;
  const stateFile = path.join(vaultPath, ".vault", "state.json");
  if (isFile(stateFile)) {
    try {
      const raw = JSON.parse(readText(stateFile));
      const result = vaultStateSchema.safeParse(raw);
      if (result.success) state = result.data;
      else warnings.push(`.vault/state.json: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
    } catch (error) {
      warnings.push(`.vault/state.json: ${(error as Error).message}`);
    }
  }

  const sources: SourceRecord[] = [];
  const plugins: PluginRecord[] = [];
  const sourcesDir = path.join(vaultPath, "sources");
  const sourceFiles = isDirectory(sourcesDir)
    ? listDirectory(sourcesDir)
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
        .map((entry) => entry.name)
        .sort()
    : [];

  for (const fileName of sourceFiles) {
    const filePath = path.join(sourcesDir, fileName);
    const parsed = parseYamlFile(filePath);
    if (parsed.error) {
      warnings.push(`sources/${fileName}: ${parsed.error}`);
      continue;
    }
    const result = sourceFileSchema.safeParse(parsed.value);
    if (!result.success) {
      const raw = asRecord(parsed.value);
      const rawSkills = Array.isArray(raw.skills) ? raw.skills : [];
      const name = typeof raw.name === "string" ? raw.name : fileName.replace(/\.yml$/, "");
      const shape =
        raw.shape === "package" ? "package" : raw.shape === "plugin" ? "plugin" : "standalone";
      const origin = raw.origin === "github" ? "github" : "local";
      warnings.push(
        `sources/${fileName}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
      if (shape === "plugin") {
        const ref = typeof raw.ref === "string" ? raw.ref : "main";
        const locked = lock?.sources[name];
        const sourceState = state?.sources[name];
        const remoteCommit = sourceState?.remote_commit;
        const status = deriveStatus(origin, locked?.commit, remoteCommit, sourceState?.status);
        plugins.push(
          makePluginRecord({
            vaultPath,
            name,
            origin,
            repo: typeof raw.repo === "string" ? raw.repo : undefined,
            ref,
            version: typeof raw.version === "string" ? raw.version : undefined,
            description: typeof raw.description === "string" ? raw.description : undefined,
            contentPath: typeof raw.content_path === "string" ? raw.content_path : undefined,
            metadataPath: filePath,
            warnings,
            locked,
            status,
            lastCheckedAt: sourceState?.checked_at,
            lastAppliedAt: sourceState?.applied_at ?? state?.last_applied_at,
            remoteCommit,
            lastError: sourceState?.error,
          }),
        );
        sources.push({
          name,
          shape,
          origin,
          ref,
          updateMode: "review-before-apply",
          workingPath: path.join(vaultPath, "plugins", name),
          metadataPath: filePath,
          skills: [],
          locked,
          status,
        });
        continue;
      }
      const sourceSkills: SkillRecord[] = rawSkills
        .map((entry) => asRecord(entry))
        .filter((entry) => typeof entry.name === "string")
        .map((entry) => {
          const skillName = entry.name as string;
          const contentPath = typeof raw.content_path === "string" ? raw.content_path : `packages/${name}`;
          const working =
            shape === "standalone"
              ? path.join(vaultPath, "skills", skillName)
              : path.join(vaultPath, contentPath, "skills", skillName);
          return makeSkillRecord({
            vaultPath,
            name: skillName,
            sourceName: name,
            shape: shape === "standalone" ? "standalone" : "package-skill",
            origin,
            workingPath: working,
            sourcePath: typeof entry.source_path === "string" ? entry.source_path : undefined,
            vendorPath: typeof entry.vendor_path === "string" ? path.join(vaultPath, entry.vendor_path) : undefined,
            repo: typeof raw.repo === "string" ? raw.repo : undefined,
            ref: typeof raw.ref === "string" ? raw.ref : "main",
            warnings,
          });
        });
      sources.push({
        name,
        shape,
        origin,
        ref: typeof raw.ref === "string" ? raw.ref : "main",
        updateMode: "review-before-apply",
        workingPath:
          shape === "standalone"
            ? path.join(vaultPath, "skills", sourceSkills[0]?.name ?? name)
            : path.join(vaultPath, typeof raw.content_path === "string" ? raw.content_path : `packages/${name}`),
        metadataPath: filePath,
        skills: sourceSkills,
        status: "unknown",
      });
      continue;
    }

    const source = result.data;
    const locked = lock?.sources[source.name];
    const sourceState = state?.sources[source.name];
    const lastChecked = sourceState?.checked_at;
    const remoteCommit = sourceState?.remote_commit;
    if (source.shape === "plugin") {
      const status = deriveStatus(source.origin, locked?.commit, remoteCommit, sourceState?.status);
      const plugin = makePluginRecord({
        vaultPath,
        name: source.name,
        origin: source.origin,
        repo: source.repo,
        ref: source.ref,
        version: source.version,
        description: source.description,
        contentPath: source.content_path,
        metadataPath: filePath,
        warnings,
        locked,
        status,
        lastCheckedAt: lastChecked,
        lastAppliedAt: sourceState?.applied_at ?? state?.last_applied_at,
        remoteCommit,
        lastError: sourceState?.error,
      });
      plugins.push(plugin);
      sources.push({
        name: source.name,
        shape: source.shape,
        origin: source.origin,
        repo: source.repo,
        remoteUrl: source.remote_url,
        ref: source.ref,
        updateMode: source.update_mode,
        version: source.version,
        description: source.description,
        contentPath: source.content_path,
        workingPath: plugin.workingPath,
        vendorRoot: plugin.vendorRoot,
        metadataPath: filePath,
        skills: [],
        locked,
        lastCheckedAt: lastChecked,
        lastAppliedAt: sourceState?.applied_at ?? state?.last_applied_at,
        remoteCommit,
        lastError: sourceState?.error,
        status,
      });
      continue;
    }
    const contentPath =
      source.shape === "package" ? source.content_path ?? `packages/${source.name}` : undefined;
    const sourceSkills = source.skills.map((entry) =>
      makeSkillRecord({
        vaultPath,
        name: entry.name,
        sourceName: source.name,
        shape: source.shape === "standalone" ? "standalone" : "package-skill",
        origin: source.origin,
        workingPath:
          source.shape === "standalone"
            ? path.join(vaultPath, "skills", entry.name)
            : path.join(vaultPath, contentPath as string, "skills", entry.name),
        sourcePath: entry.source_path,
        vendorPath: entry.vendor_path ? path.join(vaultPath, entry.vendor_path) : undefined,
        targetPath: entry.target_path ? path.join(vaultPath, entry.target_path) : undefined,
        repo: source.repo,
        ref: source.ref,
        version: source.version,
        packageName: source.shape === "package" ? source.name : undefined,
        packageKind: source.kind,
        userInvocable: entry.user_invocable,
        isEntrypoint: source.entrypoint === entry.name,
        forkedFrom: source.forked_from,
        warnings,
      }),
    );
    for (const skill of sourceSkills) {
      skill.lockedHash = locked?.skills?.[skill.name] ?? locked?.hash;
    }
    sources.push({
      name: source.name,
      shape: source.shape,
      kind: source.kind,
      entrypoint: source.entrypoint,
      origin: source.origin,
      repo: source.repo,
      remoteUrl: source.remote_url,
      ref: source.ref,
      updateMode: source.update_mode,
      version: source.version,
      description: source.description,
      contentPath,
      workingPath:
        source.shape === "standalone"
          ? path.join(vaultPath, "skills", source.skills[0]?.name ?? source.name)
          : path.join(vaultPath, contentPath as string),
      vendorRoot: source.skills[0]?.vendor_path
        ? path.dirname(path.join(vaultPath, source.skills[0].vendor_path))
        : undefined,
      metadataPath: filePath,
      scriptDeps: source.script_deps,
      skills: sourceSkills,
      locked,
      lastCheckedAt: lastChecked,
      lastAppliedAt: sourceState?.applied_at ?? state?.last_applied_at,
      remoteCommit,
      lastError: sourceState?.error,
      status: deriveStatus(source.origin, locked?.commit, remoteCommit, sourceState?.status),
    });
  }

  const skills = sources.flatMap((source) => source.skills);
  const targets = metadata.targets.map((target) => ({
    id: target.id,
    dest: target.dest,
    expandedDest: canonicalPath(expandHome(target.dest)),
    names: target.names,
    installAfterUpdate: target.install_after_update,
    exists: exists(expandHome(target.dest)),
    skills: resolveTargetSkills(target.names, sources, skills),
    installed: [],
    lastInstalledAt: state?.targets[target.id]?.last_installed_at,
    installedHash: state?.targets[target.id]?.installed_hash,
  }));

  await scanTargets(vaultPath, targets, skills);

  return {
    snapshot: {
      path: vaultPath,
      name: metadata.name,
      format: "v2",
      schemaVersion,
      readOnly: false,
      sources,
      skills,
      plugins,
      targets,
      warnings,
      counts: countSnapshot(sources, skills, plugins, targets),
      metadata,
      locked: lock,
      state,
    },
    rawWarnings: warnings,
  };
}

function resolveTargetSkills(names: string[], sources: SourceRecord[], skills: SkillRecord[]): string[] {
  const resolved = new Set<string>();
  for (const name of names) {
    const source = sources.find((entry) => entry.name === name);
    if (source) {
      for (const skill of source.skills) resolved.add(skill.name);
      continue;
    }
    const skill = skills.find((entry) => entry.name === name);
    if (skill) resolved.add(skill.name);
  }
  return [...resolved].sort();
}

function readMarker(slotPath: string): Record<string, unknown> | null {
  const markerPath = path.join(slotPath, ".vault-managed");
  if (!isFile(markerPath)) return null;
  try {
    return asRecord(JSON.parse(readText(markerPath)));
  } catch {
    return { malformed: true };
  }
}

async function scanTargets(vaultPath: string, targets: TargetRecord[], skills: SkillRecord[]): Promise<void> {
  const skillByName = new Map<string, SkillRecord>();
  for (const skill of skills) {
    if (!skillByName.has(skill.name)) skillByName.set(skill.name, skill);
  }

  for (const target of targets) {
    const dest = expandHome(target.dest);
    if (!exists(dest)) continue;
    for (const entry of listDirectory(dest)) {
      if (entry.name.startsWith(".")) continue;
      const slotPath = path.join(dest, entry.name);
      const skill = skillByName.get(entry.name);
      if (!skill && !target.skills.includes(entry.name)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(slotPath);
      } catch {
        continue;
      }
      const isSymlink = stat.isSymbolicLink();
      if (!isSymlink && !stat.isDirectory()) continue;
      const marker = readMarker(slotPath);
      const markerVault = typeof marker?.vault === "string" ? canonicalPath(marker.vault) : undefined;
      const installed: InstalledSkill = {
        targetId: target.id,
        dest,
        path: slotPath,
        managed: Boolean(marker),
        managedByThisVault: markerVault ? markerVault === canonicalPath(vaultPath) : false,
        installedAt: typeof marker?.installed_at === "string" ? marker.installed_at : undefined,
        hash: typeof marker?.hash === "string" ? marker.hash : undefined,
        isSymlink,
        linkTarget: isSymlink ? fs.readlinkSync(slotPath) : undefined,
      };
      if (installed.hash && isDirectory(slotPath)) {
        try {
          installed.matches = hashDirectory(slotPath) === installed.hash;
        } catch {
          installed.matches = false;
        }
      }
      target.installed.push(installed);
      if (skill) skill.installed.push(installed);
    }
    if (!target.lastInstalledAt) {
      const times = target.installed
        .map((entry) => entry.installedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      target.lastInstalledAt = times.at(-1);
    }
  }
}

function countSnapshot(
  sources: SourceRecord[],
  skills: SkillRecord[],
  plugins: PluginRecord[],
  targets: TargetRecord[],
): VaultSnapshot["counts"] {
  return {
    sources: sources.length,
    packages: sources.filter((source) => source.shape === "package").length,
    skills: skills.length,
    plugins: plugins.length,
    pluginSkills: plugins.reduce((total, plugin) => total + plugin.skills.length, 0),
    targets: targets.length,
    managedInstalls: targets.reduce(
      (total, target) => total + target.installed.filter((entry) => entry.managed && entry.matches !== false).length,
      0,
    ),
  };
}

async function loadV1(vaultPath: string): Promise<{
  snapshot: Omit<VaultSnapshot, "git" | "operation" | "issues">;
}> {
  const warnings: string[] = [];
  const sourcesFile = path.join(vaultPath, "sources.yml");
  let rawSources: V1RawSourcesFile = {};
  if (isFile(sourcesFile)) {
    const parsed = parseYamlFile(sourcesFile);
    if (parsed.error) warnings.push(`sources.yml: ${parsed.error}`);
    else rawSources = asRecord(parsed.value) as V1RawSourcesFile;
  } else {
    warnings.push("sources.yml is missing");
  }

  const sources: SourceRecord[] = [];
  for (const raw of Array.isArray(rawSources.skills) ? rawSources.skills : []) {
    if (typeof raw.name !== "string") continue;
    const origin = raw.origin === "local" ? "local" : "github";
    const ref = raw.ref ?? "main";
    const workingPath = path.join(vaultPath, raw.target_path ?? `skills/${raw.name}`);
    const vendorPath = raw.vendor_path ? path.join(vaultPath, raw.vendor_path) : undefined;
    const skill = makeSkillRecord({
      vaultPath,
      name: raw.name,
      sourceName: raw.name,
      shape: "standalone",
      origin,
      workingPath,
      sourcePath: raw.source_path,
      vendorPath,
      targetPath: workingPath,
      repo: raw.repo,
      ref,
      warnings,
    });
    const commit = vendorPath && isFile(path.join(vendorPath, ".source-commit"))
      ? readText(path.join(vendorPath, ".source-commit")).trim()
      : undefined;
    const locked = { commit: commit || undefined, hash: sourceLockHash([skill]), skills: { [skill.name]: skill.contentHash } };
    skill.lockedHash = locked.hash;
    sources.push({
      name: raw.name,
      shape: "standalone",
      origin,
      repo: raw.repo,
      ref,
      updateMode: raw.update_mode === "auto" ? "auto" : "review-before-apply",
      workingPath,
      vendorRoot: vendorPath ? path.dirname(vendorPath) : undefined,
      metadataPath: sourcesFile,
      skills: [skill],
      locked,
      status: deriveStatus(origin, locked.commit, undefined, undefined),
    });
  }

  for (const rawRef of Array.isArray(rawSources.packages) ? rawSources.packages : []) {
    if (typeof rawRef.name !== "string") continue;
    const manifestRel = rawRef.manifest ?? `packages/${rawRef.name}/package.yml`;
    const manifestPath = path.join(vaultPath, manifestRel);
    if (!isFile(manifestPath)) {
      warnings.push(`${manifestRel}: manifest not found`);
      continue;
    }
    const parsedManifest = parseYamlFile(manifestPath);
    if (parsedManifest.error) {
      warnings.push(`${manifestRel}: ${parsedManifest.error}`);
      continue;
    }
    const manifest = asRecord(parsedManifest.value) as V1RawPackage;
    const name = typeof manifest.name === "string" ? manifest.name : rawRef.name;
    const origin = manifest.origin === "local" ? "local" : "github";
    const ref = manifest.ref ?? "main";
    const contentPath = path.dirname(manifestRel);
    const rawSkills = Array.isArray(manifest.skills) ? manifest.skills : [];
    const skills = rawSkills
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => {
        const vendorPath = entry.vendor_path ? path.join(vaultPath, entry.vendor_path) : undefined;
        return makeSkillRecord({
          vaultPath,
          name: entry.name as string,
          sourceName: name,
          shape: "package-skill",
          origin,
          workingPath: path.join(vaultPath, contentPath, "skills", entry.name as string),
          sourcePath: entry.source_path,
          vendorPath,
          repo: manifest.repo,
          ref,
          version: manifest.version,
          packageName: name,
          packageKind: manifest.kind === "suite" ? "suite" : manifest.kind === "collection" ? "collection" : undefined,
          userInvocable: entry.user_invocable,
          isEntrypoint: manifest.entrypoint === entry.name,
          warnings,
        });
      });
    const commits = uniqueStrings(
      skills.map((skill) =>
        skill.vendorPath && isFile(path.join(skill.vendorPath, ".source-commit"))
          ? readText(path.join(skill.vendorPath, ".source-commit")).trim()
          : undefined,
      ),
    );
    if (commits.length > 1) warnings.push(`${name}: vendor skills disagree on source commit`);
    const locked = {
      commit: commits[0],
      hash: sourceLockHash(skills),
      skills: Object.fromEntries(skills.map((skill) => [skill.name, skill.contentHash])),
    };
    for (const skill of skills) skill.lockedHash = locked.hash;
    sources.push({
      name,
      shape: "package",
      kind: manifest.kind === "suite" ? "suite" : manifest.kind === "collection" ? "collection" : undefined,
      entrypoint: manifest.entrypoint,
      origin,
      repo: manifest.repo,
      remoteUrl: manifest.remote_url,
      ref,
      updateMode: manifest.update_mode === "auto" ? "auto" : "review-before-apply",
      version: manifest.version,
      description: manifest.description,
      contentPath,
      workingPath: path.join(vaultPath, contentPath),
      vendorRoot: skills[0]?.vendorPath ? path.dirname(skills[0].vendorPath as string) : undefined,
      metadataPath: manifestPath,
      manifestPath,
      scriptDeps: manifest.script_deps,
      skills,
      locked,
      status: deriveStatus(origin, locked.commit, undefined, undefined),
    });
  }

  const skills = sources.flatMap((source) => source.skills);
  const targetsFile = path.join(vaultPath, "install-targets.yml");
  let rawTargets: V1RawTargetsFile = {};
  if (isFile(targetsFile)) {
    const parsed = parseYamlFile(targetsFile);
    if (parsed.error) warnings.push(`install-targets.yml: ${parsed.error}`);
    else rawTargets = asRecord(parsed.value) as V1RawTargetsFile;
  }
  const targets: TargetRecord[] = (Array.isArray(rawTargets.targets) ? rawTargets.targets : [])
    .filter((target) => typeof target.id === "string" && typeof target.dest === "string")
    .map((target) => ({
      id: target.id as string,
      dest: target.dest as string,
      expandedDest: canonicalPath(expandHome(target.dest as string)),
      names: Array.isArray(target.names) ? target.names.filter((name): name is string => typeof name === "string") : [],
      installAfterUpdate: target.install_after_update !== false,
      exists: exists(expandHome(target.dest as string)),
      skills: resolveTargetSkills(
        Array.isArray(target.names) ? target.names.filter((name): name is string => typeof name === "string") : [],
        sources,
        skills,
      ),
      installed: [],
    }));

  await scanTargets(vaultPath, targets, skills);

  return {
    snapshot: {
      path: vaultPath,
      name: path.basename(vaultPath),
      format: "v1",
      schemaVersion: 1,
      readOnly: true,
      sources,
      skills,
      plugins: [],
      targets,
      warnings,
      counts: countSnapshot(sources, skills, [], targets),
      metadata: {
        schema: 1,
        name: path.basename(vaultPath),
        defaults: { ref: "main", update_mode: "review-before-apply" },
        targets: targets.map((target) => ({
          id: target.id,
          dest: target.dest,
          names: target.names,
          install_after_update: target.installAfterUpdate,
        })),
      },
    },
  };
}

export async function loadVault(inputPath: string): Promise<VaultSnapshot> {
  const vaultPath = canonicalPath(inputPath);
  if (!exists(vaultPath)) {
    throw new VaultDeskError("vault-not-found", `Vault path does not exist: ${inputPath}`);
  }
  if (!isDirectory(vaultPath)) {
    throw new VaultDeskError("not-a-vault", `Not a directory: ${vaultPath}`);
  }
  const format = detectVaultFormat(vaultPath);
  if (!format) {
    throw new VaultDeskError("not-a-vault", `No vault metadata found at ${vaultPath}`);
  }

  const loaded = format === "v2" ? await loadV2(vaultPath) : await loadV1(vaultPath);
  const git = await getGitSummary(vaultPath);
  const operation = await readJournal(vaultPath);
  return {
    ...loaded.snapshot,
    git,
    operation,
    issues: [],
  };
}

export function countSkillsInDirectory(root: string): number {
  if (!isDirectory(root)) return 0;
  return listDirectory(root).filter((entry) => isDirectory(path.join(root, entry.name))).length;
}

export function skillHashOf(vaultPath: string, relativePath: string): string {
  return hashDirectory(path.join(vaultPath, relativePath));
}

export function hashString(value: string): string {
  return `sha256:${sha256(value)}`;
}

export function sourceHash(skills: SkillRecord[]): string {
  return skillSetHash(skills);
}

export function readOperation(vaultPath: string): Promise<Operation | null> {
  return readJournal(vaultPath);
}

export function readStateFallback(filePath: string): unknown {
  return readJson(filePath, null);
}

export function frontmatterOf(filePath: string): { name?: string; description?: string; error?: string } {
  const parsed = parseFrontmatter(readText(filePath));
  return {
    name: frontmatterName(parsed.data),
    description: frontmatterDescription(parsed.data),
    error: parsed.error,
  };
}
