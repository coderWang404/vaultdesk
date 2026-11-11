import path from "node:path";
import { copyTree, ensureDir, isDirectory, isFile, isProcessAlive, listDirectory, movePath, removePath, writeJsonAtomic } from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import { loadVault } from "./vault/model.js";
import { detectVaultFormat } from "./vault/model.js";
import { hashDirectory } from "./fsx.js";
import { externalSkillsArtifact } from "./external-skills.js";
import { toolDocument } from "./tools.js";
import type { VaultSnapshot } from "./types.js";

export interface BuildResult {
  skills: string[];
  externalSkills: string[];
  tools: string[];
  artifacts: Record<string, string>;
  hashes: Record<string, string>;
}

export async function buildVault(inputPath: string, options: { allowV1?: boolean } = {}): Promise<BuildResult> {
  const vaultPath = path.resolve(inputPath);
  const format = detectVaultFormat(vaultPath);
  if (format === "v1" && !options.allowV1) {
    throw new VaultDeskError("not-writable-v1", "This vault uses v1 metadata. Migrate it before building.");
  }
  const snapshot = await loadVault(vaultPath);
  return buildSnapshot(snapshot);
}

const STALE_STAGING_MS = 60 * 60 * 1000;

/** Remove staging directories left behind by a build that crashed or was killed. */
function sweepStaleStaging(buildDir: string): void {
  for (const entry of listDirectory(buildDir)) {
    const match = /^\.staging-(\d+)-(\d+)$/.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const pid = Number(match[1]);
    const startedAt = Number(match[2]);
    if (pid === process.pid) continue;
    if (isProcessAlive(pid) && Date.now() - startedAt < STALE_STAGING_MS) continue;
    try {
      removePath(path.join(buildDir, entry.name));
    } catch {
      // A leftover staging directory must never fail the current build.
    }
  }
}

export function buildSnapshot(snapshot: VaultSnapshot): BuildResult {
  const vaultPath = snapshot.path;
  const buildRoot = path.join(vaultPath, "build", "skills");
  const staging = path.join(vaultPath, "build", `.staging-${process.pid}-${Date.now()}`);

  sweepStaleStaging(path.join(vaultPath, "build"));
  removePath(staging);
  ensureDir(staging);

  const skills: string[] = [];
  const artifacts: Record<string, string> = {};
  const hashes: Record<string, string> = {};

  try {
    for (const skill of [...snapshot.skills].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!isDirectory(skill.workingPath)) {
        throw new VaultDeskError("source-not-found", `Working copy is missing for ${skill.name}: ${skill.relativePath}`);
      }
      if (!isFile(path.join(skill.workingPath, "SKILL.md"))) {
        throw new VaultDeskError("validation-failed", `SKILL.md is missing for ${skill.name}`);
      }
      const destination = path.join(staging, skill.name);
      copyTree(skill.workingPath, destination, (source) => {
        const base = path.basename(source);
        return ![".git", "node_modules", ".source.yml", ".source-commit", ".vault-managed", ".DS_Store"].includes(base);
      });
      hashes[skill.name] = hashDirectory(destination);
      artifacts[skill.name] = path.join(buildRoot, skill.name);
      skills.push(skill.name);
    }

    removePath(buildRoot);
    ensureDir(path.dirname(buildRoot));
    movePath(staging, buildRoot);
  } catch (error) {
    removePath(staging);
    throw error;
  }

  writeToolsArtifact(snapshot);
  writeExternalSkillsArtifact(snapshot);
  const tools = snapshot.tools.map((tool) => tool.name);
  const externalSkills = snapshot.externalSkills.map((skill) => skill.name);

  return { skills, externalSkills, tools, artifacts, hashes };
}

export function writeToolsArtifact(snapshot: VaultSnapshot): string {
  const file = path.join(snapshot.path, "build", "tools.json");
  writeJsonAtomic(file, {
    schema: 1,
    vault: snapshot.name,
    tools: snapshot.tools.map((tool) => toolDocument(tool)),
  });
  return file;
}

export function writeExternalSkillsArtifact(snapshot: VaultSnapshot): string {
  const file = path.join(snapshot.path, "build", "external-skills.json");
  writeJsonAtomic(file, externalSkillsArtifact(snapshot));
  return file;
}

export function listBuildArtifacts(vaultPath: string): string[] {
  const buildRoot = path.join(vaultPath, "build", "skills");
  return listDirectory(buildRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
