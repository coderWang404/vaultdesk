import fs from "node:fs";
import path from "node:path";
import { ensureDir, isDirectory, isFile, listDirectory, movePath, removePath } from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import { loadVault } from "./vault/model.js";
import { detectVaultFormat } from "./vault/model.js";
import { hashDirectory } from "./fsx.js";
import type { VaultSnapshot } from "./types.js";

export interface BuildResult {
  skills: string[];
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

export function buildSnapshot(snapshot: VaultSnapshot): BuildResult {
  const vaultPath = snapshot.path;
  const buildRoot = path.join(vaultPath, "build", "skills");
  const staging = path.join(vaultPath, "build", `.staging-${process.pid}-${Date.now()}`);

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
      fs.cpSync(skill.workingPath, destination, {
        recursive: true,
        dereference: false,
        filter: (source) => {
          const base = path.basename(source);
          if ([".git", "node_modules", ".source.yml", ".source-commit", ".vault-managed", ".DS_Store"].includes(base)) {
            return false;
          }
          return true;
        },
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

  return { skills, artifacts, hashes };
}

export function listBuildArtifacts(vaultPath: string): string[] {
  const buildRoot = path.join(vaultPath, "build", "skills");
  return listDirectory(buildRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
