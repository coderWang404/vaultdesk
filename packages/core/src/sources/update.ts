import fs from "node:fs";
import path from "node:path";
import {
  canonicalPath,
  copyDirectory,
  hashDirectory,
  hashText,
  isDirectory,
  isInside,
  relativeSlash,
  removePath,
} from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { commitPaths, isGitRepo, isWorktreeClean } from "../git.js";
import { openVault, validateVault } from "../vault/validate.js";
import { withWriteLock } from "../vault/lockfile.js";
import { Journal } from "../journal.js";
import { buildVault } from "../build.js";
import { writeLock, recordCheck, recordSourceApplied } from "../vault/state.js";
import { reinstallTargets } from "../install.js";
import type { DiffFile, SourceDiff, UpdateChange, UpdateResult, VaultSnapshot } from "../types.js";
import type { LockFile } from "@vaultdesk/schema";
import { selectSources } from "./select.js";
import { fetchUpstream } from "./fetch.js";
import { diffSourceRecord } from "./diff.js";
import { inspectPlugin } from "../plugins/discover.js";
import { refreshPluginSourceMetadata } from "../plugins/import.js";
import { resolvePluginUpstreamRoot } from "../plugins/upstream.js";

export interface UpdateOptions {
  names?: string[];
  commit?: boolean;
  install?: boolean;
  force?: boolean;
  commitMessage?: string;
  backupRoot?: string;
  retention?: number;
  /** The caller holds the vault write lock for an outer transaction. */
  alreadyLocked?: boolean;
  /** Automatic transactions preflight only the paths they will change. */
  allowUnrelatedDirty?: boolean;
}

function lockEntry(snapshot: VaultSnapshot, source: VaultSnapshot["sources"][number]): LockFile["sources"][string] {
  if (source.shape === "plugin") {
    return {
      ...(source.locked?.commit ? { commit: source.locked.commit } : {}),
      ...(isDirectory(source.workingPath) ? { hash: hashDirectory(source.workingPath) } : {}),
      skills: Object.fromEntries(
        Object.entries(source.locked?.skills ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }
  return {
    ...(source.locked?.commit ? { commit: source.locked.commit } : {}),
    ...(source.locked?.hash ? { hash: source.locked.hash } : {}),
    skills: Object.fromEntries(
      [...source.skills]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => [skill.name, skill.contentHash]),
    ),
  };
}

function buildLock(snapshot: VaultSnapshot): LockFile {
  const sources: LockFile["sources"] = {};
  for (const source of [...snapshot.sources].sort((a, b) => a.name.localeCompare(b.name))) {
    if (source.origin !== "github") continue;
    sources[source.name] = lockEntry(snapshot, source);
  }
  return { schema: 1, sources };
}

function modifiedSkills(snapshot: VaultSnapshot, source: VaultSnapshot["sources"][number]): string[] {
  const modified: string[] = [];
  for (const skill of source.skills) {
    const locked = source.locked?.skills?.[skill.name];
    if (locked && skill.contentHash !== locked) modified.push(skill.name);
  }
  return modified;
}

function modifiedVendors(source: VaultSnapshot["sources"][number]): string[] {
  return source.skills
    .filter((skill) => {
      const locked = source.locked?.skills?.[skill.name];
      return !locked || !skill.vendorPath || hashDirectory(skill.vendorPath) !== locked;
    })
    .map((skill) => skill.name);
}

function copyUpstreamSkill(
  skill: VaultSnapshot["sources"][number]["skills"][number],
  fetchedRoot: string,
): { vendorWritten: boolean; workingWritten: boolean } {
  if (!skill.sourcePath) {
    throw new VaultDeskError("source-not-found", `Skill ${skill.name} has no source_path`);
  }
  const upstream = path.join(fetchedRoot, skill.sourcePath);
  if (!isInside(upstream, fetchedRoot)) {
    throw new VaultDeskError("path-escape", `source_path escapes the upstream checkout for ${skill.name}`);
  }
  if (!isDirectory(upstream)) {
    throw new VaultDeskError("upstream-not-found", `Upstream path not found for ${skill.name}: ${skill.sourcePath}`);
  }
  let vendorWritten = false;
  if (skill.vendorPath) {
    removePath(skill.vendorPath);
    fs.mkdirSync(path.dirname(skill.vendorPath), { recursive: true });
    fs.cpSync(upstream, skill.vendorPath, { recursive: true, dereference: false });
    vendorWritten = true;
  }
  removePath(skill.workingPath);
  fs.mkdirSync(path.dirname(skill.workingPath), { recursive: true });
  fs.cpSync(upstream, skill.workingPath, { recursive: true, dereference: false });
  return { vendorWritten, workingWritten: true };
}

function copyUpstreamPlugin(
  source: VaultSnapshot["sources"][number],
  upstreamRoot: string,
): void {
  if (source.vendorRoot) {
    removePath(source.vendorRoot);
    fs.mkdirSync(path.dirname(source.vendorRoot), { recursive: true });
    copyDirectory(upstreamRoot, source.vendorRoot);
  }
  removePath(source.workingPath);
  fs.mkdirSync(path.dirname(source.workingPath), { recursive: true });
  copyDirectory(upstreamRoot, source.workingPath);
}

export async function updateSources(inputPath: string, options: UpdateOptions = {}): Promise<UpdateResult> {
  const vaultPath = canonicalPath(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") {
    throw new VaultDeskError("not-writable-v1", "Updates require a v2 vault. Migrate this vault first.");
  }
  if (snapshot.issues.some((issue) => issue.severity === "error")) {
    throw new VaultDeskError("validation-failed", "Fix validation errors before updating.", {
      details: snapshot.issues.filter((issue) => issue.severity === "error"),
    });
  }
  if (!(await isGitRepo(vaultPath))) {
    throw new VaultDeskError("git-failed", "Updates require the vault to be a Git repository.");
  }
  if (!options.allowUnrelatedDirty && !(await isWorktreeClean(vaultPath))) {
    throw new VaultDeskError("git-not-clean", "Commit or stash local changes before updating.");
  }

  const selected = selectSources(snapshot, options.names);
  const warnings: string[] = [];
  const github = selected.filter((source) => source.origin === "github");
  for (const source of selected) {
    if (source.origin === "local") warnings.push(`${source.name}: local source, nothing to update.`);
  }
  if (github.length === 0) {
    return { applied: false, names: selected.map((source) => source.name), changes: [], warnings };
  }

  const blocked: string[] = [];
  for (const source of github) {
    if (options.force) continue;
    if (source.shape === "plugin") {
      const pluginRoots = [source.workingPath, source.vendorRoot].filter(
        (root): root is string => typeof root === "string" && isDirectory(root),
      );
      if (!source.locked?.hash && pluginRoots.length > 0) {
        blocked.push(`${source.name}: no plugin lock hash`);
      } else if (
        source.locked?.hash &&
        pluginRoots.some((root) => hashDirectory(root) !== source.locked?.hash)
      ) {
        blocked.push(`${source.name}: plugin root modified since the last apply (copy or revert first)`);
      }
      continue;
    }
    if (!source.locked?.skills && source.skills.some((skill) => isDirectory(skill.workingPath))) {
      blocked.push(`${source.name}: no per-skill lock entry`);
      continue;
    }
    const modified = modifiedSkills(snapshot, source);
    if (modified.length > 0) {
      blocked.push(`${source.name}: ${modified.join(", ")} modified since the last apply (fork or revert first)`);
    }
    const vendorModified = modifiedVendors(source);
    if (vendorModified.length > 0) {
      blocked.push(`${source.name}: pristine vendor copy for ${vendorModified.join(", ")} modified or missing since the last apply (revert first)`);
    }
  }
  if (blocked.length > 0) {
    throw new VaultDeskError("conflict", "Source copies have local changes. Use --force to overwrite.", {
      details: blocked,
    });
  }

  const fetched = new Map<string, { root: string; commit: string }>();
  const changes: UpdateChange[] = [];
  for (const source of github) {
    const upstream = await fetchUpstream(source);
    fetched.set(source.name, { root: upstream.root, commit: upstream.commit });
    const diff = await diffSourceRecord(source, upstream.root, upstream.commit);
    if (diff.files.length > 0 || source.locked?.commit !== upstream.commit) {
      changes.push({ name: source.name, commit: upstream.commit, files: diff.files });
    }
  }

  if (changes.length === 0) {
    return { applied: false, names: github.map((source) => source.name), changes: [], warnings };
  }

  const apply = async (): Promise<UpdateResult> => {
    const journal = Journal.begin(vaultPath, "update", [
      { id: "write", label: "Write vendor and working copies" },
      { id: "lock", label: "Update lock file" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate vault" },
      { id: "install", label: "Reinstall affected targets" },
      { id: "commit", label: "Commit changes" },
    ]);
    let active = "write";
    try {
      const fresh = await openVault(vaultPath);
      const freshChanged = new Set(changes.map((change) => change.name));
      const changedSkills = new Set<string>();
      const changedPlugins = new Set<string>();
      const writePaths = new Set<string>();

      journal.start("write");
      for (const source of fresh.sources) {
        if (!freshChanged.has(source.name)) continue;
        const upstream = fetched.get(source.name);
        if (!upstream) continue;
        if (source.shape === "plugin") {
          const upstreamRoot = resolvePluginUpstreamRoot(source, upstream.root);
          copyUpstreamPlugin(source, upstreamRoot);
          const inspected = inspectPlugin({
            root: source.workingPath,
            vaultPath,
            sourceName: source.name,
            origin: "github",
            repo: source.repo,
            ref: source.ref,
            warnings: [],
          });
          source.locked = {
            commit: upstream.commit,
            hash: hashDirectory(source.workingPath),
            skills: Object.fromEntries(inspected.skills.map((skill) => [skill.name, skill.contentHash])),
          };
          source.status = "current";
          refreshPluginSourceMetadata(vaultPath, source, inspected.manifests);
          changedPlugins.add(source.name);
          if (source.vendorRoot) writePaths.add(relativeSlash(vaultPath, canonicalPath(source.vendorRoot)));
          writePaths.add(relativeSlash(vaultPath, canonicalPath(source.workingPath)));
          if (source.metadataPath) writePaths.add(relativeSlash(vaultPath, canonicalPath(source.metadataPath)));
          continue;
        }
        for (const skill of source.skills) {
          copyUpstreamSkill(skill, upstream.root);
          skill.contentHash = hashDirectory(skill.workingPath);
          changedSkills.add(skill.name);
          if (skill.vendorPath) writePaths.add(relativeSlash(vaultPath, canonicalPath(skill.vendorPath)));
          writePaths.add(relativeSlash(vaultPath, canonicalPath(skill.workingPath)));
        }
        source.locked = {
          commit: upstream.commit,
          hash: hashText(
            JSON.stringify(
              source.skills
                .map((skill) => [skill.name, skill.contentHash] as const)
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
          skills: Object.fromEntries(source.skills.map((skill) => [skill.name, skill.contentHash])),
        };
        source.status = "current";
      }
      journal.done("write", `${changedSkills.size} skills, ${changedPlugins.size} plugins`);

      journal.start("lock");
      writeLock(vaultPath, buildLock(fresh));
      writePaths.add("vault.lock");
      for (const change of changes) recordSourceApplied(vaultPath, change.name);
      recordCheck(vaultPath, {
        checkedAt: new Date().toISOString(),
        results: changes.map((change) => ({
          name: change.name,
          origin: "github",
          status: "current",
          remoteCommit: change.commit,
        })),
        warnings: [],
      });
      journal.done("lock");

      const hasSkillChanges = fresh.sources.some(
        (source) => freshChanged.has(source.name) && source.shape !== "plugin",
      );
      active = "build";
      let buildSkills: string[] = [];
      if (hasSkillChanges) {
        journal.start("build");
        const build = await buildVault(vaultPath);
        buildSkills = build.skills;
        journal.done("build", `${buildSkills.length} skills`);
      } else {
        journal.skipped("build", "plugin-only update");
      }

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Updated vault failed validation.", {
          details: validation.errors,
        });
      }
      journal.done("validate", `${validation.warnings.length} warnings`);

      let install: UpdateResult["install"];
      const installNames = changes
        .map((change) => change.name)
        .filter((name) => fresh.sources.find((source) => source.name === name)?.shape !== "plugin");
      if (options.install && installNames.length > 0) {
        active = "install";
        journal.start("install");
        install = await reinstallTargets(vaultPath, installNames, {
          rebuild: false,
          backupRoot: options.backupRoot,
          retention: options.retention,
          alreadyLocked: true,
        });
        journal.done("install", `${install.length} targets`);
      } else {
        journal.skipped("install", options.install ? "no installable changes" : undefined);
      }

      let commit: string | undefined;
      if (options.commit) {
        active = "commit";
        journal.start("commit");
        const message =
          options.commitMessage?.trim() ||
          `chore: update ${changes.map((change) => change.name).join(", ")}`;
        commit = await commitPaths(vaultPath, [...writePaths], message);
        journal.done("commit", commit);
      } else {
        journal.skipped("commit");
      }

      journal.finish();
      return {
        applied: true,
        names: changes.map((change) => change.name),
        changes,
        validation,
        build: { skills: buildSkills },
        install,
        commit,
        warnings,
      };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  };
  return options.alreadyLocked ? apply() : withWriteLock(vaultPath, apply);
}

export async function previewUpdate(
  inputPath: string,
  names?: string[],
): Promise<{ changes: { name: string; commit: string; diff: SourceDiff }[]; warnings: string[] }> {
  const snapshot = await openVault(inputPath);
  const selected = selectSources(snapshot, names).filter((source) => source.origin === "github");
  const changes: { name: string; commit: string; diff: SourceDiff }[] = [];
  const warnings: string[] = [];
  for (const source of selected) {
    const upstream = await fetchUpstream(source);
    const diff = await diffSourceRecord(source, upstream.root, upstream.commit);
    if (diff.files.length > 0 || source.locked?.commit !== upstream.commit) {
      changes.push({ name: source.name, commit: upstream.commit, diff });
    }
  }
  return { changes, warnings };
}

export function updateSummary(changes: UpdateChange[]): { files: number; binary: number } {
  const files = changes.flatMap((change) => change.files as DiffFile[]);
  return { files: files.length, binary: files.filter((file) => file.binary).length };
}
