import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { createTwoFilesPatch } from "diff";
import { ensureDir, isFile, listDirectory, relativeSlash, writeTextAtomic } from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { git, isWorktreeClean, createBranch, commitPaths, currentBranch, currentCommit } from "../git.js";
import { openVault, validateVault } from "./validate.js";
import { loadVault } from "./model.js";
import { withWriteLock } from "./lockfile.js";
import { Journal } from "../journal.js";
import { buildVault } from "../build.js";
import type { MigrationPlan, MigrationResult, MigrationWrite, VaultSnapshot } from "../types.js";
import type { LockFile } from "@vaultdesk/schema";

const BRANCH = "vault-v2";

function sourceYaml(snapshot: VaultSnapshot, source: VaultSnapshot["sources"][number]): string {
  const record: Record<string, unknown> = {
    schema: 1,
    name: source.name,
    shape: source.shape,
  };
  if (source.kind) record.kind = source.kind;
  if (source.entrypoint) record.entrypoint = source.entrypoint;
  record.origin = source.origin;
  if (source.repo) record.repo = source.repo;
  if (source.remoteUrl) record.remote_url = source.remoteUrl;
  if (source.origin === "github") record.ref = source.ref;
  if (source.shape === "package") record.content_path = source.contentPath;
  if (source.version) record.version = source.version;
  if (source.description) record.description = source.description;
  record.update_mode = source.updateMode;
  record.skills = source.skills.map((skill) => {
    const entry: Record<string, unknown> = { name: skill.name };
    if (skill.sourcePath) entry.source_path = skill.sourcePath;
    if (skill.vendorPath) entry.vendor_path = relativeSlash(snapshot.path, skill.vendorPath);
    if (source.shape === "standalone" && skill.targetPath) {
      entry.target_path = relativeSlash(snapshot.path, skill.targetPath);
    }
    entry.user_invocable = skill.userInvocable;
    return entry;
  });
  if (source.scriptDeps && Object.keys(source.scriptDeps).length > 0) {
    record.script_deps = source.scriptDeps;
  }
  return YAML.stringify(record, { lineWidth: 0 });
}

function vaultYaml(snapshot: VaultSnapshot): string {
  return YAML.stringify(
    {
      schema: 1,
      name: snapshot.name,
      defaults: {
        ref: "main",
        update_mode: "review-before-apply",
      },
      targets: snapshot.targets.map((target) => ({
        id: target.id,
        dest: target.dest,
        names: target.names,
        install_after_update: target.installAfterUpdate,
      })),
    },
    { lineWidth: 0 },
  );
}

function lockYaml(snapshot: VaultSnapshot): string {
  const sources: LockFile["sources"] = {};
  for (const source of [...snapshot.sources].sort((a, b) => a.name.localeCompare(b.name))) {
    if (source.origin !== "github") continue;
    const entry: LockFile["sources"][string] = {};
    if (source.locked?.commit) entry.commit = source.locked.commit;
    if (source.locked?.hash) entry.hash = source.locked.hash;
    entry.skills = Object.fromEntries(
      [...source.skills]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((skill) => [skill.name, skill.contentHash]),
    );
    sources[source.name] = entry;
  }
  return YAML.stringify({ schema: 1, sources }, { lineWidth: 0 });
}

function oldFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildDiff(vaultPath: string, writes: MigrationWrite[], deletes: string[]): string {
  const chunks: string[] = [];
  for (const write of [...writes].sort((a, b) => a.path.localeCompare(b.path))) {
    chunks.push(createTwoFilesPatch("/dev/null", `b/${write.path}`, "", write.content, undefined, undefined));
  }
  for (const deleted of [...deletes].sort((a, b) => a.localeCompare(b))) {
    const abs = path.join(vaultPath, deleted);
    if (!isFile(abs)) continue;
    chunks.push(createTwoFilesPatch(`a/${deleted}`, "/dev/null", oldFileContent(abs), "", undefined, undefined));
  }
  return chunks.join("");
}

export async function planMigration(inputPath: string): Promise<MigrationPlan> {
  const snapshot = await openVault(inputPath);
  if (snapshot.format !== "v1") {
    throw new VaultDeskError("unsupported", "This vault already uses v2 metadata.");
  }
  const errors = snapshot.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new VaultDeskError("validation-failed", "Fix validation errors before migrating.", { details: errors });
  }

  const warnings = [...snapshot.warnings];
  for (const source of snapshot.sources) {
    if (source.origin === "github" && !source.locked?.commit) {
      warnings.push(`${source.name} has no vendor commit; the lock file will not pin a revision for it.`);
    }
  }
  if (!snapshot.git.isRepo) {
    warnings.push("This vault is not a Git repository. Migration apply requires Git.");
  } else if (snapshot.git.dirty) {
    warnings.push("The worktree has uncommitted changes. Commit or stash them before applying.");
  }

  const writes: MigrationWrite[] = [];
  for (const source of [...snapshot.sources].sort((a, b) => a.name.localeCompare(b.name))) {
    writes.push({ path: `sources/${source.name}.yml`, content: sourceYaml(snapshot, source) });
  }
  writes.push({ path: "vault.yml", content: vaultYaml(snapshot) });
  writes.push({ path: "vault.lock", content: lockYaml(snapshot) });
  writes.push({ path: ".vault/.gitignore", content: "state.json\noperation.json\n" });
  const rootIgnore = path.join(snapshot.path, ".gitignore");
  if (!isFile(rootIgnore)) {
    writes.push({ path: ".gitignore", content: "build/\n.DS_Store\n" });
  } else {
    const lines = oldFileContent(rootIgnore).split(/\r?\n/).map((line) => line.trim());
    if (!lines.some((line) => line === "build/" || line === "build" || line === "/build/")) {
      warnings.push("The root .gitignore does not ignore build/; regenerated artifacts will show as untracked.");
    }
  }
  writes.sort((a, b) => a.path.localeCompare(b.path));

  const deletes = new Set<string>();
  if (isFile(path.join(snapshot.path, "sources.yml"))) deletes.add("sources.yml");
  if (isFile(path.join(snapshot.path, "install-targets.yml"))) deletes.add("install-targets.yml");
  const packagesDir = path.join(snapshot.path, "packages");
  for (const entry of listDirectory(packagesDir)) {
    if (!entry.isDirectory()) continue;
    if (isFile(path.join(packagesDir, entry.name, "package.yml"))) {
      deletes.add(`packages/${entry.name}/package.yml`);
    }
  }

  const diff = buildDiff(snapshot.path, writes, [...deletes]);
  return {
    from: "v1",
    vaultPath: snapshot.path,
    name: snapshot.name,
    branch: BRANCH,
    writes,
    deletes: [...deletes].sort(),
    unaffected: ["third_party/", "skills/", "packages/*/skills/", "build/ (regenerated)"],
    warnings,
    diff,
    cleanWorktree: snapshot.git.isRepo && !snapshot.git.dirty,
    skillCount: snapshot.skills.length,
    sourceCount: snapshot.sources.length,
  };
}

export async function applyMigration(inputPath: string): Promise<MigrationResult> {
  const vaultPath = path.resolve(inputPath);
  return withWriteLock(vaultPath, async () => {
    const plan = await planMigration(vaultPath);
    if (!plan.cleanWorktree) {
      throw new VaultDeskError(
        "git-not-clean",
        "Commit or stash all changes before migrating. Migration writes to a new branch.",
      );
    }
    const branchExists = await git(["rev-parse", "--verify", `refs/heads/${plan.branch}`], vaultPath, {
      allowFailure: true,
    });
    if (branchExists.code === 0) {
      throw new VaultDeskError("conflict", `Branch ${plan.branch} already exists. Rename or delete it first.`);
    }

    const journal = Journal.begin(vaultPath, "migrate", [
      { id: "write", label: "Write v2 metadata" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate migrated vault" },
      { id: "commit", label: "Commit migration branch" },
    ]);
    let active = "write";
    try {
      const beforeBranch = await currentBranch(vaultPath);
      await createBranch(vaultPath, plan.branch);

      journal.start("write");
      for (const write of plan.writes) {
        const target = path.join(vaultPath, write.path);
        ensureDir(path.dirname(target));
        writeTextAtomic(target, write.content);
      }
      for (const deleted of plan.deletes) {
        const target = path.join(vaultPath, deleted);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      journal.done("write", `${plan.writes.length} files`);

      active = "build";
      journal.start("build");
      const build = await buildVault(vaultPath);
      journal.done("build", `${build.skills.length} skills`);

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Migrated vault failed validation.", {
          details: validation.errors,
        });
      }
      journal.done("validate", `${validation.warnings.length} warnings`);

      active = "commit";
      journal.start("commit");
      const paths = [...plan.writes.map((write) => write.path), ...plan.deletes];
      const commit = await commitPaths(vaultPath, paths, "chore: migrate vault metadata to v2");
      journal.done("commit", commit);
      journal.finish();

      return { branch: plan.branch, commit, plan, validation };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

export async function migrationStatus(inputPath: string): Promise<{
  branch?: string;
  head?: string;
  applied: boolean;
  clean: boolean;
}> {
  const snapshot = await loadVault(inputPath);
  const clean = snapshot.git.isRepo ? await isWorktreeClean(snapshot.path) : false;
  return {
    branch: snapshot.git.branch,
    head: await currentCommit(snapshot.path),
    applied: snapshot.format === "v2",
    clean,
  };
}
