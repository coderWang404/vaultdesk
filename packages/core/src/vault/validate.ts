import path from "node:path";
import YAML from "yaml";
import { sourceFileSchema, vaultFileSchema, type SourceFile } from "@vaultdesk/schema";
import {
  canonicalPath,
  exists,
  expandHome,
  hashDirectory,
  isDirectory,
  isFile,
  isInside,
  listDirectory,
  nowIso,
  readText,
} from "../fsx.js";
import { parseFrontmatter, frontmatterDescription, frontmatterName } from "../frontmatter.js";
import type { PluginRecord, SourceRecord, ValidationIssue, ValidationReport, VaultSnapshot } from "../types.js";
import { loadVault } from "./model.js";

const V2_VAULT_KEYS = new Set(["schema", "name", "defaults", "targets"]);
const V2_SOURCE_KEYS = new Set([
  "schema",
  "name",
  "shape",
  "kind",
  "entrypoint",
  "origin",
  "repo",
  "remote_url",
  "ref",
  "content_path",
  "version",
  "description",
  "update_mode",
  "skills",
  "script_deps",
  "forked_from",
]);
const V2_TARGET_KEYS = new Set(["id", "dest", "names", "install_after_update"]);
const V2_SKILL_KEYS = new Set(["name", "source_path", "vendor_path", "target_path", "user_invocable", "description"]);
const V1_SOURCE_SKILL_KEYS = new Set([
  "name",
  "origin",
  "repo",
  "remote_url",
  "ref",
  "source_path",
  "vendor_path",
  "target_path",
  "update_mode",
]);
const V1_PACKAGE_KEYS = new Set([
  "name",
  "version",
  "description",
  "kind",
  "entrypoint",
  "origin",
  "repo",
  "remote_url",
  "ref",
  "update_mode",
  "skills",
  "script_deps",
]);
const V1_TARGET_KEYS = new Set(["id", "dest", "names", "install_after_update"]);

function push(
  issues: ValidationIssue[],
  severity: ValidationIssue["severity"],
  code: string,
  message: string,
  issuePath?: string,
): void {
  issues.push({ severity, code, message, path: issuePath });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function unknownKeys(record: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

function parseYamlContent(content: string): { value?: unknown; error?: string } {
  try {
    return { value: YAML.parse(content) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export function frontmatterIssues(skill: SourceRecord["skills"][number], vaultPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const skillFile = path.join(skill.workingPath, "SKILL.md");
  if (!isDirectory(skill.workingPath)) {
    push(issues, "error", "skill.missing-directory", `Skill directory is missing for ${skill.name}`, skill.relativePath);
    return issues;
  }
  if (!isFile(skillFile)) {
    push(issues, "error", "skill.missing-file", `SKILL.md is missing for ${skill.name}`, skill.relativePath);
    return issues;
  }
  let content: string;
  try {
    content = readText(skillFile);
  } catch (error) {
    push(issues, "error", "skill.unreadable", `Cannot read ${skill.relativePath}/SKILL.md: ${(error as Error).message}`);
    return issues;
  }
  const parsed = parseFrontmatter(content);
  if (parsed.error) {
    push(issues, "error", "frontmatter.invalid", `${skill.relativePath}/SKILL.md: ${parsed.error}`);
    return issues;
  }
  const name = frontmatterName(parsed.data);
  if (!name) {
    push(issues, "error", "frontmatter.name-missing", `${skill.relativePath}/SKILL.md: frontmatter name is missing`);
  } else {
    const dir = path.basename(skill.workingPath);
    if (name !== dir) {
      push(
        issues,
        "error",
        "frontmatter.name-mismatch",
        `${skill.relativePath}/SKILL.md: name ${JSON.stringify(name)} does not match directory ${JSON.stringify(dir)}`,
      );
    }
    if (name !== skill.name) {
      push(
        issues,
        "error",
        "frontmatter.skill-name-mismatch",
        `${skill.relativePath}/SKILL.md: name ${JSON.stringify(name)} does not match metadata skill ${JSON.stringify(skill.name)}`,
      );
    }
  }
  const description = frontmatterDescription(parsed.data);
  if (!description) {
    push(issues, "error", "frontmatter.description-missing", `${skill.relativePath}/SKILL.md: description is missing`);
  } else if (description.toLowerCase().includes("(internal") && skill.userInvocable !== false) {
    push(
      issues,
      "error",
      "skill.internal-invocable",
      `${skill.name}: description marks the skill internal but user_invocable is not false`,
    );
  }
  return issues;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suiteReferenceIssues(source: SourceRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const entrypoint = source.skills.find((skill) => skill.name === source.entrypoint);
  if (!entrypoint) return issues;
  const entryFile = path.join(entrypoint.workingPath, "SKILL.md");
  if (!isFile(entryFile)) return issues;
  let content: string;
  try {
    content = readText(entryFile);
  } catch {
    return issues;
  }
  for (const member of source.skills) {
    if (member.name === entrypoint.name) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(member.name)}([^A-Za-z0-9_-]|$)`, "i");
    if (!pattern.test(content)) {
      push(
        issues,
        "warning",
        "suite.member-unreferenced",
        `Suite ${source.name} entrypoint ${entrypoint.name} does not mention member ${member.name}`,
        entrypoint.relativePath,
      );
    }
  }
  return issues;
}

function checkTargets(snapshot: VaultSnapshot, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  const knownNames = new Set<string>([
    ...snapshot.sources.map((source) => source.name),
    ...snapshot.skills.map((skill) => skill.name),
  ]);
  const pluginNames = new Set(snapshot.plugins.map((plugin) => plugin.name));
  const pluginSkillNames = new Set(snapshot.plugins.flatMap((plugin) => plugin.skills.map((skill) => skill.name)));
  for (const target of snapshot.targets) {
    if (ids.has(target.id)) {
      push(issues, "error", "target.duplicate-id", `Duplicate install target id: ${target.id}`);
    }
    ids.add(target.id);
    if (!target.names.length) {
      push(issues, "error", "target.empty", `Install target ${target.id} has no names`);
    }
    const pluginNames = new Set(snapshot.plugins.map((plugin) => plugin.name));
    const pluginSkillNames = new Set(snapshot.plugins.flatMap((plugin) => plugin.skills.map((skill) => skill.name)));
    for (const name of target.names) {
      if (pluginNames.has(name) || pluginSkillNames.has(name)) {
        push(
          issues,
          "error",
          "target.plugin-not-installable",
          `Install target ${target.id} references plugin content ${name}; plugins are installed by the agent, not VaultDesk`,
        );
      } else if (!knownNames.has(name)) {
        push(issues, "error", "target.unknown-name", `Install target ${target.id} references unknown source or skill: ${name}`);
      }
    }
    if (!target.dest.startsWith("/") && target.dest !== "~" && !target.dest.startsWith("~/")) {
      push(issues, "error", "target.invalid-dest", `Install target ${target.id} dest must be absolute or start with ~/`);
    } else {
      const expanded = expandHome(target.dest);
      if (!path.isAbsolute(expanded)) {
        push(issues, "error", "target.invalid-dest", `Install target ${target.id} dest is not absolute`);
      } else if (isInside(expanded, snapshot.path)) {
        push(issues, "error", "target.inside-vault", `Install target ${target.id} points inside the vault`);
      }
    }
    if (!target.installAfterUpdate) {
      continue;
    }
  }
}

function checkSourceCommon(source: SourceRecord, vaultPath: string, issues: ValidationIssue[]): void {
  if (source.shape === "package") {
    if (!source.kind) {
      push(issues, "error", "source.kind-missing", `Package ${source.name} is missing kind`, source.metadataPath);
    }
    if (source.kind === "suite") {
      if (!source.entrypoint) {
        push(issues, "error", "source.entrypoint-missing", `Suite ${source.name} requires entrypoint`, source.metadataPath);
      } else if (!source.skills.some((skill) => skill.name === source.entrypoint)) {
        push(
          issues,
          "error",
          "source.entrypoint-unknown",
          `Suite ${source.name} entrypoint ${source.entrypoint} is not a declared skill`,
          source.metadataPath,
        );
      } else {
        issues.push(...suiteReferenceIssues(source));
      }
    }
    if (source.kind === "collection" && source.entrypoint) {
      push(issues, "error", "source.entrypoint-forbidden", `Collection ${source.name} must not declare entrypoint`);
    }
    if (!isDirectory(source.workingPath)) {
      push(issues, "error", "source.missing-package", `Package directory is missing for ${source.name}`, source.workingPath);
    } else {
      const skillsDir = path.join(source.workingPath, "skills");
      for (const entry of listDirectory(skillsDir)) {
        if (!entry.isDirectory()) continue;
        if (!source.skills.some((skill) => skill.name === entry.name)) {
          push(
            issues,
            "error",
            "package.undeclared-skill",
            `Package ${source.name} has an undeclared skill directory: ${entry.name}`,
          );
        }
      }
    }
    const declared = new Set(source.skills.map((skill) => skill.name));
    for (const [depSkill, files] of Object.entries(source.scriptDeps ?? {})) {
      if (!declared.has(depSkill)) {
        push(issues, "error", "script-deps.unknown-skill", `${source.name}: script_deps references undeclared skill ${depSkill}`);
        continue;
      }
      if (!Array.isArray(files)) {
        push(issues, "error", "script-deps.invalid", `${source.name}: script_deps.${depSkill} must be a list`);
        continue;
      }
      const skill = source.skills.find((entry) => entry.name === depSkill);
      for (const file of files) {
        if (typeof file !== "string" || !file) {
          push(issues, "error", "script-deps.invalid", `${source.name}: script_deps.${depSkill} contains an invalid path`);
          continue;
        }
        if (skill && !exists(path.join(skill.workingPath, file))) {
          push(
            issues,
            "error",
            "script-deps.missing-file",
            `${source.name}: script_deps file not found: ${depSkill}/${file}`,
          );
        }
      }
    }
  } else if (source.shape === "standalone") {
    if (source.skills.length !== 1) {
      push(issues, "error", "source.standalone-skills", `Standalone source ${source.name} must declare exactly one skill`);
    }
    if (source.kind) {
      push(issues, "error", "source.standalone-kind", `Standalone source ${source.name} must not set kind`);
    }
  } else {
    if (source.kind) {
      push(issues, "error", "source.plugin-kind", `Plugin source ${source.name} must not set kind`, source.metadataPath);
    }
    if (source.entrypoint) {
      push(
        issues,
        "error",
        "source.plugin-entrypoint",
        `Plugin source ${source.name} must not set entrypoint`,
        source.metadataPath,
      );
    }
    if (source.skills.length > 0) {
      push(
        issues,
        "error",
        "source.plugin-skills",
        `Plugin source ${source.name} must not declare skills; members are discovered from the plugin root`,
        source.metadataPath,
      );
    }
    if (!isDirectory(source.workingPath)) {
      push(issues, "error", "plugin.missing-root", `Plugin directory is missing for ${source.name}`, source.workingPath);
    }
    if (source.origin === "github") {
      if (!source.repo) {
        push(issues, "error", "source.repo-missing", `GitHub plugin ${source.name} is missing repo`);
      }
      if (!isInside(source.workingPath, vaultPath)) {
        push(issues, "error", "path.escape", `Plugin ${source.name} working path escapes the vault`, source.workingPath);
      }
      const vendor = path.join(vaultPath, "third_party", source.name);
      if (!isDirectory(vendor)) {
        push(issues, "warning", "source.vendor-missing", `Vendor copy is missing for plugin ${source.name}`);
      }
    } else if (source.repo || source.remoteUrl) {
      push(issues, "warning", "source.local-upstream-fields", `Local plugin ${source.name} still declares upstream fields`);
    }
  }

  for (const skill of source.skills) {
    if (!isInside(skill.workingPath, vaultPath)) {
      push(issues, "error", "path.escape", `Skill ${skill.name} working path escapes the vault`, skill.relativePath);
    }
    if (skill.vendorPath && !isInside(skill.vendorPath, vaultPath)) {
      push(issues, "error", "path.escape", `Skill ${skill.name} vendor path escapes the vault`);
    }
    if (source.origin === "github") {
      if (!source.repo) {
        push(issues, "error", "source.repo-missing", `GitHub source ${source.name} is missing repo`);
      }
      if (!skill.sourcePath) {
        push(issues, "error", "source.source-path-missing", `GitHub skill ${skill.name} is missing source_path`);
      }
      if (!skill.vendorPath) {
        push(issues, "error", "source.vendor-path-missing", `GitHub skill ${skill.name} is missing vendor_path`);
      } else if (!isDirectory(skill.vendorPath)) {
        push(issues, "warning", "source.vendor-missing", `Vendor copy is missing for ${skill.name}`);
      }
    }
    if (source.origin === "local") {
      if (source.repo || source.remoteUrl || skill.sourcePath || skill.vendorPath) {
        push(issues, "warning", "source.local-upstream-fields", `Local source ${source.name} still declares upstream fields`);
      }
    }
    issues.push(...frontmatterIssues(skill, vaultPath));
  }
}

function checkPlugin(plugin: PluginRecord, snapshot: VaultSnapshot, issues: ValidationIssue[]): void {
  if (!isDirectory(plugin.workingPath)) return;
  if (!isInside(plugin.workingPath, snapshot.path)) {
    push(issues, "error", "path.escape", `Plugin ${plugin.name} working path escapes the vault`, plugin.workingPath);
    return;
  }
  if (plugin.manifests.length === 0) {
    push(issues, "error", "plugin.manifest-missing", `Plugin ${plugin.name} has no recognizable manifest`, plugin.workingPath);
  }
  const names = new Set<string>();
  const versions = new Set<string>();
  for (const manifest of plugin.manifests) {
    if (manifest.parseError) {
      push(issues, "error", "plugin.manifest-invalid", `${manifest.relativePath}: ${manifest.parseError}`, plugin.metadataPath);
    }
    if (!isInside(manifest.path, plugin.workingPath)) {
      push(issues, "error", "plugin.manifest-escape", `${manifest.relativePath} escapes the plugin root`, plugin.metadataPath);
    }
    if (manifest.name) names.add(manifest.name);
    if (manifest.version) versions.add(manifest.version);
    if (manifest.name && manifest.name !== plugin.name) {
      push(
        issues,
        "warning",
        "plugin.manifest-name-mismatch",
        `Plugin ${plugin.name} manifest ${manifest.relativePath} declares name ${manifest.name}`,
        plugin.metadataPath,
      );
    }
  }
  if (names.size > 1) {
    push(issues, "warning", "plugin.manifest-name-conflict", `Plugin ${plugin.name} manifests disagree on name`, plugin.metadataPath);
  }
  if (versions.size > 1) {
    push(
      issues,
      "warning",
      "plugin.manifest-version-conflict",
      `Plugin ${plugin.name} manifests disagree on version`,
      plugin.metadataPath,
    );
  }
  if (plugin.hasHooks) {
    push(issues, "warning", "plugin.hooks", `Plugin ${plugin.name} contains hooks; VaultDesk never executes them`, plugin.metadataPath);
  }
  const kinds = new Set(plugin.assets.map((asset) => asset.kind));
  for (const kind of ["commands", "agents", "mcp"] as const) {
    if (kinds.has(kind)) {
      push(
        issues,
        "warning",
        "plugin.executable-assets",
        `Plugin ${plugin.name} contains ${kind}; review them before installing in an agent`,
        plugin.metadataPath,
      );
    }
  }
  if (!plugin.license) {
    push(issues, "warning", "plugin.license-missing", `Plugin ${plugin.name} has no license`, plugin.metadataPath);
  }
  if (plugin.otherCount > 0) {
    push(issues, "warning", "plugin.other-assets", `Plugin ${plugin.name} has ${plugin.otherCount} unrecognized top-level entries`, plugin.metadataPath);
  }
  for (const skill of plugin.skills) {
    issues.push(...frontmatterIssues(skill, snapshot.path));
    if (snapshot.skills.some((entry) => entry.name === skill.name)) {
      push(
        issues,
        "warning",
        "plugin.skill-duplicate",
        `Plugin ${plugin.name} contains skill ${skill.name}, which collides with an installable skill`,
        skill.relativePath,
      );
    }
  }
}

function checkNameNamespace(snapshot: VaultSnapshot, issues: ValidationIssue[]): void {
  const owners = new Map<string, { kind: "package" | "skill" | "plugin"; sourceName: string }>();
  for (const source of snapshot.sources) {
    if (source.shape === "package" || source.shape === "plugin") {
      const existing = owners.get(source.name);
      if (existing) {
        push(
          issues,
          "error",
          "name.duplicate",
          `Name ${source.name} is used by both ${existing.sourceName} and ${source.name}`,
        );
      } else {
        owners.set(source.name, { kind: source.shape, sourceName: source.name });
      }
    }
  }
  for (const skill of snapshot.skills) {
    const existing = owners.get(skill.name);
    if (existing) {
      const allowedEntrypoint = existing.kind === "package" && existing.sourceName === skill.sourceName;
      if (!allowedEntrypoint) {
        push(
          issues,
          "error",
          "name.duplicate",
          `Skill name ${skill.name} collides with ${existing.kind === "package" ? "package" : "plugin"} ${existing.sourceName}`,
        );
      }
      continue;
    }
    owners.set(skill.name, { kind: "skill", sourceName: skill.sourceName });
  }
}

async function checkV2Files(snapshot: VaultSnapshot, issues: ValidationIssue[]): Promise<void> {
  const vaultFile = path.join(snapshot.path, "vault.yml");
  if (!isFile(vaultFile)) {
    push(issues, "error", "vault.missing-config", "vault.yml is missing");
    return;
  }
  const rawVault = parseYamlContent(readText(vaultFile));
  if (rawVault.error) {
    push(issues, "error", "vault.invalid-yaml", `vault.yml: ${rawVault.error}`);
    return;
  }
  const vaultRecord = asRecord(rawVault.value);
  for (const key of unknownKeys(vaultRecord, V2_VAULT_KEYS)) {
    push(issues, "warning", "vault.unknown-key", `vault.yml has an unknown key: ${key}`);
  }
  const parsedVault = vaultFileSchema.safeParse(rawVault.value);
  if (!parsedVault.success) {
    for (const issue of parsedVault.error.issues) {
      push(issues, "error", "schema.invalid", `vault.yml ${issue.path.join(".")}: ${issue.message}`);
    }
  }
  const defaults = asRecord(vaultRecord.defaults);
  for (const key of unknownKeys(defaults, new Set(["ref", "update_mode"]))) {
    push(issues, "warning", "vault.unknown-default", `vault.yml defaults has an unknown key: ${key}`);
  }
  if (Array.isArray(vaultRecord.targets)) {
    for (const [index, rawTarget] of vaultRecord.targets.entries()) {
      const target = asRecord(rawTarget);
      for (const key of unknownKeys(target, V2_TARGET_KEYS)) {
        push(issues, "warning", "target.unknown-key", `vault.yml targets[${index}] has an unknown key: ${key}`);
      }
    }
  }

  const sourcesDir = path.join(snapshot.path, "sources");
  if (!isDirectory(sourcesDir)) {
    push(issues, "error", "sources.missing-directory", "sources/ directory is missing");
    return;
  }
  const seen = new Set<string>();
  for (const entry of listDirectory(sourcesDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const filePath = path.join(sourcesDir, entry.name);
    const raw = parseYamlContent(readText(filePath));
    if (raw.error) {
      push(issues, "error", "source.invalid-yaml", `sources/${entry.name}: ${raw.error}`);
      continue;
    }
    const record = asRecord(raw.value);
    for (const key of unknownKeys(record, V2_SOURCE_KEYS)) {
      push(issues, "warning", "source.unknown-key", `sources/${entry.name} has an unknown key: ${key}`);
    }
    if (Array.isArray(record.skills)) {
      for (const [index, rawSkill] of record.skills.entries()) {
        const skill = asRecord(rawSkill);
        for (const key of unknownKeys(skill, V2_SKILL_KEYS)) {
          push(issues, "warning", "skill.unknown-key", `sources/${entry.name} skills[${index}] has an unknown key: ${key}`);
        }
      }
    }
    const parsed = sourceFileSchema.safeParse(raw.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        push(
          issues,
          "error",
          "schema.invalid",
          `sources/${entry.name} ${issue.path.join(".")}: ${issue.message}`,
        );
      }
    }
    const expectedName = entry.name.replace(/\.yml$/, "");
    const actualName = typeof record.name === "string" ? record.name : expectedName;
    if (actualName !== expectedName) {
      push(
        issues,
        "error",
        "source.filename-mismatch",
        `sources/${entry.name}: name ${JSON.stringify(actualName)} does not match file name`,
      );
    }
    if (seen.has(actualName)) {
      push(issues, "error", "source.duplicate-name", `Duplicate source name: ${actualName}`);
    }
    seen.add(actualName);
  }
}

async function checkV1Files(snapshot: VaultSnapshot, issues: ValidationIssue[]): Promise<void> {
  const sourcesFile = path.join(snapshot.path, "sources.yml");
  if (!isFile(sourcesFile)) {
    push(issues, "error", "v1.sources-missing", "sources.yml is missing");
  } else {
    const raw = parseYamlContent(readText(sourcesFile));
    if (raw.error) {
      push(issues, "error", "v1.sources-invalid", `sources.yml: ${raw.error}`);
    } else {
      const record = asRecord(raw.value);
      for (const key of unknownKeys(record, new Set(["skills", "packages"]))) {
        push(issues, "warning", "v1.unknown-key", `sources.yml has an unknown key: ${key}`);
      }
      const seen = new Set<string>();
      for (const [index, rawSource] of (Array.isArray(record.skills) ? record.skills : []).entries()) {
        const source = asRecord(rawSource);
        for (const key of unknownKeys(source, V1_SOURCE_SKILL_KEYS)) {
          push(issues, "warning", "v1.unknown-key", `sources.yml skills[${index}] has an unknown key: ${key}`);
        }
        if (typeof source.name !== "string" || !source.name) {
          push(issues, "error", "v1.source-name", `sources.yml skills[${index}] is missing name`);
          continue;
        }
        if (source.origin !== "github" && source.origin !== "local") {
          push(issues, "error", "source.origin", `Source ${source.name} origin must be github or local`);
        }
        if (seen.has(source.name)) push(issues, "error", "source.duplicate-name", `Duplicate source name: ${source.name}`);
        seen.add(source.name);
        if (source.origin === "github") {
          for (const key of ["repo", "ref", "source_path", "vendor_path"] as const) {
            if (typeof source[key] !== "string" || !source[key]) {
              push(issues, "error", "v1.github-fields", `GitHub source ${source.name} is missing ${key}`);
            }
          }
        }
        if (typeof source.target_path === "string" && path.basename(source.target_path) !== source.name) {
          push(issues, "error", "v1.target-path-name", `Source ${source.name} target_path basename must match name`);
        }
      }
      for (const [index, rawPackage] of (Array.isArray(record.packages) ? record.packages : []).entries()) {
        const packageRef = asRecord(rawPackage);
        if (typeof packageRef.name !== "string" || !packageRef.name) {
          push(issues, "error", "v1.package-name", `sources.yml packages[${index}] is missing name`);
          continue;
        }
        if (seen.has(packageRef.name)) {
          push(issues, "error", "source.duplicate-name", `Duplicate source name: ${packageRef.name}`);
        }
        seen.add(packageRef.name);
        const manifestRel = typeof packageRef.manifest === "string" ? packageRef.manifest : `packages/${packageRef.name}/package.yml`;
        const manifestPath = path.join(snapshot.path, manifestRel);
        if (!isFile(manifestPath)) {
          push(issues, "error", "v1.manifest-missing", `Package manifest not found: ${manifestRel}`);
          continue;
        }
        const manifestRaw = parseYamlContent(readText(manifestPath));
        if (manifestRaw.error) {
          push(issues, "error", "v1.manifest-invalid", `${manifestRel}: ${manifestRaw.error}`);
          continue;
        }
        const manifest = asRecord(manifestRaw.value);
        for (const key of unknownKeys(manifest, V1_PACKAGE_KEYS)) {
          push(issues, "warning", "v1.unknown-key", `${manifestRel} has an unknown key: ${key}`);
        }
        if (manifest.name !== packageRef.name) {
          push(
            issues,
            "error",
            "v1.manifest-name",
            `${manifestRel}: name ${JSON.stringify(manifest.name)} does not match sources.yml entry ${JSON.stringify(packageRef.name)}`,
          );
        }
        if (manifest.kind !== "suite" && manifest.kind !== "collection") {
          push(issues, "error", "source.kind-missing", `${manifestRel}: kind must be suite or collection`);
        }
        if (manifest.origin !== "github" && manifest.origin !== "local") {
          push(issues, "error", "source.origin", `${manifestRel}: origin must be github or local`);
        }
        if (manifest.origin === "github") {
          for (const key of ["repo", "ref"] as const) {
            if (typeof manifest[key] !== "string" || !manifest[key]) {
              push(issues, "error", "v1.github-fields", `${manifestRel}: github package is missing ${key}`);
            }
          }
          for (const [skillIndex, rawSkill] of (Array.isArray(manifest.skills) ? manifest.skills : []).entries()) {
            const skill = asRecord(rawSkill);
            for (const key of ["name", "source_path", "vendor_path"] as const) {
              if (typeof skill[key] !== "string" || !skill[key]) {
                push(
                  issues,
                  "error",
                  "v1.github-fields",
                  `${manifestRel}: skills[${skillIndex}] is missing ${key}`,
                );
              }
            }
          }
        }
        if (manifest.kind === "suite" && typeof manifest.entrypoint !== "string") {
          push(issues, "error", "source.entrypoint-missing", `${manifestRel}: suite requires entrypoint`);
        }
        if (manifest.kind === "collection" && manifest.entrypoint) {
          push(issues, "error", "source.entrypoint-forbidden", `${manifestRel}: collection must not set entrypoint`);
        }
        for (const [skillIndex, rawSkill] of (Array.isArray(manifest.skills) ? manifest.skills : []).entries()) {
          const skill = asRecord(rawSkill);
          for (const key of unknownKeys(skill, new Set(["name", "source_path", "vendor_path", "user_invocable"]))) {
            push(issues, "warning", "v1.unknown-key", `${manifestRel} skills[${skillIndex}] has an unknown key: ${key}`);
          }
          if (skill.user_invocable !== undefined && typeof skill.user_invocable !== "boolean") {
            push(issues, "error", "v1.user-invocable", `${manifestRel}: skills[${skillIndex}].user_invocable must be boolean`);
          }
        }
      }
    }
  }

  const targetsFile = path.join(snapshot.path, "install-targets.yml");
  if (isFile(targetsFile)) {
    const raw = parseYamlContent(readText(targetsFile));
    if (raw.error) {
      push(issues, "error", "v1.targets-invalid", `install-targets.yml: ${raw.error}`);
    } else {
      const record = asRecord(raw.value);
      for (const key of unknownKeys(record, new Set(["targets"]))) {
        push(issues, "warning", "v1.unknown-key", `install-targets.yml has an unknown key: ${key}`);
      }
      for (const [index, rawTarget] of (Array.isArray(record.targets) ? record.targets : []).entries()) {
        const target = asRecord(rawTarget);
        for (const key of unknownKeys(target, V1_TARGET_KEYS)) {
          push(issues, "warning", "v1.target-key", `install-targets.yml targets[${index}] has an unknown key: ${key}`);
        }
        if (typeof target.id !== "string" || !target.id) {
          push(issues, "error", "target.id-missing", `install-targets.yml targets[${index}] is missing id`);
        }
        if (typeof target.dest !== "string" || !target.dest) {
          push(issues, "error", "target.dest-missing", `install-targets.yml targets[${index}] is missing dest`);
        }
        if (!Array.isArray(target.names) || target.names.length === 0) {
          push(issues, "error", "target.empty", `install-targets.yml targets[${index}] is missing names`);
        }
        if (target.install_after_update !== undefined && typeof target.install_after_update !== "boolean") {
          push(
            issues,
            "error",
            "target.install-after-update",
            `install-targets.yml targets[${index}].install_after_update must be boolean`,
          );
        }
      }
    }
  }
}

export async function collectIssues(snapshot: VaultSnapshot): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (snapshot.format === "v2") {
    await checkV2Files(snapshot, issues);
  } else {
    await checkV1Files(snapshot, issues);
  }

  const sourceNames = new Set<string>();
  for (const source of snapshot.sources) {
    if (sourceNames.has(source.name)) {
      push(issues, "error", "source.duplicate-name", `Duplicate source name: ${source.name}`);
    }
    sourceNames.add(source.name);
    checkSourceCommon(source, snapshot.path, issues);
  }
  for (const plugin of snapshot.plugins) {
    checkPlugin(plugin, snapshot, issues);
  }

  if (!snapshot.name.trim()) {
    push(issues, "error", "vault.name-missing", "Vault name is empty");
  }
  checkNameNamespace(snapshot, issues);
  checkTargets(snapshot, issues);

  for (const warning of snapshot.warnings) {
    if (!issues.some((issue) => issue.message === warning)) {
      push(issues, "warning", "vault.warning", warning);
    }
  }

  return issues;
}

export function reportFromIssues(issues: ValidationIssue[]): ValidationReport {
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
    checkedAt: nowIso(),
  };
}

export async function openVault(inputPath: string): Promise<VaultSnapshot> {
  const snapshot = await loadVault(inputPath);
  const issues = await collectIssues(snapshot);
  return { ...snapshot, issues };
}

export async function validateVault(inputPath: string): Promise<ValidationReport> {
  const snapshot = await openVault(inputPath);
  return reportFromIssues(snapshot.issues);
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function countManagedInstalls(snapshot: VaultSnapshot): number {
  return snapshot.targets.reduce(
    (total, target) => total + target.installed.filter((entry) => entry.managed).length,
    0,
  );
}

export function installedHash(skillPath: string): string {
  return hashDirectory(skillPath);
}

export function normalizedSourceMetadata(source: SourceFile): Record<string, unknown> {
  return {
    schema: 1,
    name: source.name,
    shape: source.shape,
    kind: source.kind,
    entrypoint: source.entrypoint,
    origin: source.origin,
    repo: source.repo,
    ref: source.ref,
    content_path: source.content_path,
    skills: source.skills,
  };
}

export function sourceMetadataPath(vaultPath: string, name: string): string {
  return path.join(canonicalPath(vaultPath), "sources", `${name}.yml`);
}
