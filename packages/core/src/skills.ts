import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { sourceFileSchema, type VaultFile } from "@vaultdesk/schema";
import {
  canonicalPath,
  copyDirectory,
  ensureDir,
  exists,
  isDirectory,
  isFile,
  isInside,
  readText,
  removePath,
  writeTextAtomic,
  nowIso,
} from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import { openVault, validateVault } from "./vault/validate.js";
import { buildVault } from "./build.js";
import { withWriteLock } from "./vault/lockfile.js";
import { Journal } from "./journal.js";
import { readVaultFile, writeVaultFile } from "./vault/config.js";
import { readLock, writeLock, readState, writeState } from "./vault/state.js";
import type { ForkPreview, SkillRecord, VaultSnapshot } from "./types.js";

function findSkill(snapshot: VaultSnapshot, name: string): { skill: SkillRecord; source: VaultSnapshot["sources"][number] } {
  for (const source of snapshot.sources) {
    const skill = source.skills.find((entry) => entry.name === name);
    if (skill) return { skill, source };
  }
  throw new VaultDeskError("unknown-skill", `Unknown skill: ${name}`);
}

function sourceMetadataPath(vaultPath: string, name: string): string {
  return path.join(vaultPath, "sources", `${name}.yml`);
}

function writeSourceMetadata(vaultPath: string, data: Record<string, unknown>): void {
  const file = sourceMetadataPath(vaultPath, String(data.name));
  ensureDir(path.dirname(file));
  writeTextAtomic(file, YAML.stringify(data, { lineWidth: 0 }));
}

function replaceForkedTargets(vaultPath: string, from: string, to: string): void {
  const file = readVaultFile(vaultPath);
  let changed = false;
  for (const target of file.targets) {
    const next = target.names.map((name) => (name === from ? to : name));
    if (next.some((name, index) => name !== target.names[index])) {
      target.names = [...new Set(next)];
      changed = true;
    }
  }
  if (changed) writeVaultFile(vaultPath, file);
}

function stripNameFrontmatter(content: string, newName: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;
  const block = match[1] ?? "";
  const updated = /^name:\s*.*$/m.test(block)
    ? block.replace(/^name:\s*.*$/m, `name: ${newName}`)
    : `name: ${newName}\n${block}`;
  return content.replace(match[0], `---\n${updated}\n---`);
}

export async function readSkillContent(
  inputPath: string,
  skillName: string,
): Promise<{ skill: SkillRecord; content: string; editable: boolean; reason?: string }> {
  const snapshot = await openVault(inputPath);
  const { skill, source } = findSkill(snapshot, skillName);
  const file = path.join(skill.workingPath, "SKILL.md");
  if (!isFile(file)) throw new VaultDeskError("source-not-found", `SKILL.md is missing for ${skillName}`);
  const editable = snapshot.format === "v2" && source.origin === "local";
  return {
    skill,
    content: readText(file),
    editable,
    reason: editable ? undefined : "GitHub-origin skills are read-only. Fork to edit.",
  };
}

export async function writeSkillContent(
  inputPath: string,
  skillName: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before editing.");
  const { skill, source } = findSkill(snapshot, skillName);
  if (source.origin !== "local") {
    throw new VaultDeskError("unsupported", "GitHub-origin skills are read-only. Fork the skill first.");
  }
  const parsed = (await import("./frontmatter.js")).parseFrontmatter(content);
  if (parsed.error) throw new VaultDeskError("invalid-input", parsed.error);
  const name = parsed.data.name;
  if (typeof name !== "string" || name !== path.basename(skill.workingPath)) {
    throw new VaultDeskError("invalid-input", "Frontmatter name must match the skill directory name.");
  }
  if (typeof parsed.data.description !== "string" || !parsed.data.description.trim()) {
    throw new VaultDeskError("invalid-input", "Frontmatter description must not be empty.");
  }
  return withWriteLock(vaultPath, async () => {
    const file = path.join(skill.workingPath, "SKILL.md");
    writeTextAtomic(file, content);
    return { path: path.relative(vaultPath, file), bytes: Buffer.byteLength(content, "utf8") };
  });
}

export async function previewFork(inputPath: string, skillName: string, asName?: string): Promise<ForkPreview> {
  const snapshot = await openVault(inputPath);
  const { skill, source } = findSkill(snapshot, skillName);
  if (source.origin === "local") {
    throw new VaultDeskError("unsupported", `${skillName} is already local and can be edited directly.`);
  }
  const newName = asName ?? skill.name;
  const removeFromPackage = skill.shape === "package-skill" && newName === skill.name;
  const warnings: string[] = [];
  if (removeFromPackage && source.kind === "suite" && source.entrypoint === skill.name) {
    throw new VaultDeskError(
      "unsupported",
      "Forking a suite entrypoint with the same name would break the package. Use --as <new-name>.",
    );
  }
  if (removeFromPackage && source.name === newName) {
    throw new VaultDeskError(
      "unsupported",
      "The package has the same name as this skill, so a same-name fork would overwrite the package metadata. Use --as <new-name>.",
    );
  }
  if (removeFromPackage) {
    warnings.push(`The skill will be detached from ${source.name}; the remaining package skills stay unchanged.`);
  }
  if (newName !== skill.name) {
    warnings.push(`The forked copy will be named ${newName} and the original stays in ${source.name}.`);
  }
  const targetPath = path.join(snapshot.path, "skills", newName);
  if (exists(targetPath)) {
    warnings.push(`Target already exists: skills/${newName}`);
  }
  if (exists(sourceMetadataPath(snapshot.path, newName)) && newName !== source.name) {
    warnings.push(`Source metadata already exists: sources/${newName}.yml`);
  }
  const otherSource = snapshot.sources.find((entry) => entry.name === newName && entry.name !== source.name);
  const otherSkill = snapshot.skills.find((entry) => entry.name === newName && entry !== skill);
  if (otherSource || otherSkill) warnings.push(`The name ${newName} is already used in this vault.`);
  return {
    skill: skill.name,
    sourceName: source.name,
    newSourceName: newName,
    targetPath,
    from: {
      repo: source.repo ?? "",
      ref: source.ref,
      source_path: skill.sourcePath ?? "",
      commit: source.locked?.commit,
    },
    removesFromPackage: removeFromPackage,
    warnings,
  };
}

export async function forkSkill(inputPath: string, skillName: string, asName?: string): Promise<ForkPreview> {
  const vaultPath = canonicalPath(inputPath);
  const preview = await previewFork(vaultPath, skillName, asName);
  if (exists(preview.targetPath)) {
    throw new VaultDeskError("path-conflict", `Target already exists: ${preview.targetPath}`);
  }
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before forking.");
  const { skill, source } = findSkill(snapshot, skillName);
  const newName = preview.newSourceName;
  const otherSource = snapshot.sources.find((entry) => entry.name === newName && entry.name !== source.name);
  const otherSkill = snapshot.skills.find((entry) => entry.name === newName && entry !== skill);
  if (otherSource || otherSkill) {
    throw new VaultDeskError("conflict", `The name ${newName} is already used in this vault.`);
  }

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "fork", [
      { id: "copy", label: "Copy skill into local workspace" },
      { id: "metadata", label: "Write source metadata" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "copy";
    try {
      journal.start("copy");
      copyDirectory(skill.workingPath, preview.targetPath);
      if (newName !== skill.name) {
        const skillFile = path.join(preview.targetPath, "SKILL.md");
        writeTextAtomic(skillFile, stripNameFrontmatter(readText(skillFile), newName));
      }
      journal.done("copy");

      active = "metadata";
      journal.start("metadata");
      const metadata: Record<string, unknown> = {
        schema: 1,
        name: newName,
        shape: "standalone",
        origin: "local",
        update_mode: "review-before-apply",
        forked_from: {
          repo: source.repo,
          ref: source.ref,
          source_path: skill.sourcePath,
          ...(source.locked?.commit ? { commit: source.locked.commit } : {}),
        },
        skills: [{ name: newName, target_path: `skills/${newName}` }],
      };
      writeSourceMetadata(vaultPath, metadata);
      if (newName === source.name) {
        const lock = readLock(vaultPath);
        if (lock) {
          delete lock.sources[newName];
          writeLock(vaultPath, lock);
        }
        const state = readState(vaultPath);
        delete state.sources[newName];
        writeState(vaultPath, state);
      }

      if (preview.removesFromPackage) {
        const sourceFile = source.metadataPath as string;
        const parsed = YAML.parse(readText(sourceFile)) as Record<string, unknown>;
        const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
        const remaining = skills.filter((entry) => (entry as { name?: string }).name !== skill.name);
        if (remaining.length > 0) {
          parsed.skills = remaining;
          writeTextAtomic(sourceFile, YAML.stringify(parsed, { lineWidth: 0 }));
        } else {
          if (sourceFile !== sourceMetadataPath(vaultPath, newName)) fs.unlinkSync(sourceFile);
          replaceForkedTargets(vaultPath, source.name, newName);
          const lock = readLock(vaultPath);
          if (lock) {
            delete lock.sources[source.name];
            writeLock(vaultPath, lock);
          }
        }
        if (skill.vendorPath) removePath(skill.vendorPath);
        removePath(skill.workingPath);
      }
      journal.done("metadata");

      active = "build";
      journal.start("build");
      const build = await buildVault(vaultPath);
      journal.done("build", `${build.skills.length} skills`);

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Forked vault failed validation.", {
          details: validation.errors,
        });
      }
      journal.done("validate");
      journal.finish();
      return preview;
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

function pruneEmptySourceDirs(start: string, vaultPath: string, removedPaths: string[]): void {
  let current = path.dirname(start);
  while (isInside(current, vaultPath)) {
    const relative = path.relative(vaultPath, current);
    if (!relative || relative.split(path.sep).length < 2) return;
    if (!isDirectory(current) || fs.readdirSync(current).length > 0) return;
    fs.rmdirSync(current);
    removedPaths.push(current);
    current = path.dirname(current);
  }
}

export async function removeSource(
  inputPath: string,
  sourceName: string,
  options: { deleteFiles?: boolean } = {},
): Promise<{ name: string; removedPaths: string[] }> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before removing sources.");
  const source = snapshot.sources.find((entry) => entry.name === sourceName);
  if (!source) throw new VaultDeskError("unknown-source", `Unknown source: ${sourceName}`);

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "remove", [
      { id: "metadata", label: "Remove source metadata" },
      { id: "files", label: "Remove workspace copies" },
      { id: "references", label: "Clean target and lock references" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "metadata";
    try {
      journal.start("metadata");
      if (source.metadataPath && isFile(source.metadataPath)) fs.unlinkSync(source.metadataPath);
      journal.done("metadata");

      active = "files";
      journal.start("files");
      const removedPaths: string[] = [];
      if (options.deleteFiles) {
        const deleted: string[] = [];
        for (const skill of source.skills) {
          if (isDirectory(skill.workingPath)) {
            removePath(skill.workingPath);
            removedPaths.push(skill.workingPath);
            deleted.push(skill.workingPath);
          }
          if (skill.vendorPath && isDirectory(skill.vendorPath)) {
            removePath(skill.vendorPath);
            removedPaths.push(skill.vendorPath);
            deleted.push(skill.vendorPath);
          }
        }
        for (const entry of deleted) pruneEmptySourceDirs(entry, vaultPath, removedPaths);
      } else {
        journal.skipped("files", "workspace copies kept");
      }
      journal.done("files", `${removedPaths.length} paths`);

      active = "references";
      journal.start("references");
      const file: VaultFile = readVaultFile(vaultPath);
      const skillNames = new Set(source.skills.map((skill) => skill.name));
      file.targets = file.targets
        .map((target) => ({
          ...target,
          names: target.names.filter((name) => name !== source.name && !skillNames.has(name)),
        }))
        .filter((target) => target.names.length > 0);
      writeVaultFile(vaultPath, file);
      const lock = readLock(vaultPath);
      if (lock) {
        delete lock.sources[source.name];
        writeLock(vaultPath, lock);
      }
      const state = readState(vaultPath);
      delete state.sources[source.name];
      writeState(vaultPath, state);
      journal.done("references");

      active = "build";
      journal.start("build");
      const build = await buildVault(vaultPath);
      journal.done("build", `${build.skills.length} skills`);

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Vault failed validation after removing the source.", {
          details: validation.errors,
        });
      }
      journal.done("validate");
      journal.finish();
      return { name: sourceName, removedPaths };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

export function activeSourceFile(vaultPath: string, name: string): string {
  return sourceMetadataPath(vaultPath, name);
}

export function parseSourceFile(content: string): Record<string, unknown> {
  const parsed = sourceFileSchema.safeParse(YAML.parse(content));
  if (!parsed.success) {
    throw new VaultDeskError("invalid-input", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data as unknown as Record<string, unknown>;
}

export function now(): string {
  return nowIso();
}
