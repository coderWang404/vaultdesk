import fs from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { exists, isDirectory, isProbablyBinary, sha256, walkFiles } from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { loadVault } from "../vault/model.js";
import type { DiffFile, SourceDiff, SourceRecord, VaultSnapshot } from "../types.js";
import { findSource } from "./select.js";
import { fetchUpstream } from "./fetch.js";
import { resolvePluginUpstreamRoot } from "../plugins/upstream.js";

const MAX_PATCH_BYTES = 400_000;

interface ContentEntry {
  kind: "file" | "symlink";
  content: Buffer;
  mode: number;
  size: number;
}

function readEntry(root: string, relative: string): ContentEntry | null {
  const abs = path.join(root, relative);
  try {
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      return {
        kind: "symlink",
        content: Buffer.from(fs.readlinkSync(abs), "utf8"),
        mode: 0,
        size: 0,
      };
    }
    if (!stat.isFile()) return null;
    return { kind: "file", content: fs.readFileSync(abs), mode: stat.mode & 0o111, size: stat.size };
  } catch {
    return null;
  }
}

function compareTrees(beforeRoot: string, afterRoot: string, displayPrefix: string): DiffFile[] {
  const beforeFiles = new Map(walkFiles(beforeRoot).map((entry) => [entry.rel, entry]));
  const afterFiles = new Map(walkFiles(afterRoot).map((entry) => [entry.rel, entry]));
  const allPaths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort();
  const files: DiffFile[] = [];

  for (const relative of allPaths) {
    const beforeEntry = beforeFiles.has(relative) ? readEntry(beforeRoot, relative) : null;
    const afterEntry = afterFiles.has(relative) ? readEntry(afterRoot, relative) : null;
    if (!beforeEntry && !afterEntry) continue;

    const displayPath = displayPrefix ? `${displayPrefix}/${relative}` : relative;
    let status: DiffFile["status"];
    if (!beforeEntry) status = "added";
    else if (!afterEntry) status = "deleted";
    else if (beforeEntry.kind !== afterEntry.kind) status = "type-changed";
    else if (
      beforeEntry.mode !== afterEntry.mode ||
      !beforeEntry.content.equals(afterEntry.content)
    ) {
      status = "modified";
    } else {
      continue;
    }

    const binary =
      (beforeEntry?.kind === "symlink" || afterEntry?.kind === "symlink") ||
      isProbablyBinary(beforeEntry?.content ?? Buffer.alloc(0)) ||
      isProbablyBinary(afterEntry?.content ?? Buffer.alloc(0));

    let patch: string | undefined;
    let truncated = false;
    if (!binary) {
      const beforeText = (beforeEntry?.content ?? Buffer.alloc(0)).toString("utf8");
      const afterText = (afterEntry?.content ?? Buffer.alloc(0)).toString("utf8");
      if (beforeText.length + afterText.length <= MAX_PATCH_BYTES) {
        patch = createTwoFilesPatch(
          beforeEntry ? `a/${displayPath}` : "/dev/null",
          afterEntry ? `b/${displayPath}` : "/dev/null",
          beforeText,
          afterText,
          undefined,
          undefined,
        );
      } else {
        truncated = true;
      }
    }

    files.push({
      path: displayPath,
      status,
      binary,
      bytesBefore: beforeEntry?.size ?? 0,
      bytesAfter: afterEntry?.size ?? 0,
      patch,
      truncated,
    });
  }

  return files;
}

function compareSkill(
  source: SourceRecord,
  skill: SourceRecord["skills"][number],
  upstreamRoot: string,
  onlySkill: boolean,
): DiffFile[] {
  if (!skill.sourcePath) {
    throw new VaultDeskError("source-not-found", `Skill ${skill.name} has no source_path`);
  }
  const upstreamPath = path.join(upstreamRoot, skill.sourcePath);
  if (!isDirectory(upstreamPath)) {
    throw new VaultDeskError("upstream-not-found", `Upstream path not found for ${skill.name}: ${skill.sourcePath}`, {
      details: { source: source.name, sourcePath: skill.sourcePath },
    });
  }
  if (!isDirectory(skill.workingPath)) {
    throw new VaultDeskError("source-not-found", `Working copy not found for ${skill.name}: ${skill.workingPath}`);
  }
  return compareTrees(skill.workingPath, upstreamPath, onlySkill ? "" : skill.name);
}

export async function diffSourceRecord(
  source: SourceRecord,
  fetchedRoot: string,
  commit: string,
): Promise<SourceDiff> {
  const upstreamPath =
    source.shape === "plugin" ? resolvePluginUpstreamRoot(source, fetchedRoot) : fetchedRoot;
  const files: DiffFile[] = [];
  if (source.shape === "plugin") {
    const beforeRoot =
      source.vendorRoot && isDirectory(source.vendorRoot) ? source.vendorRoot : source.workingPath;
    if (!isDirectory(beforeRoot)) {
      throw new VaultDeskError("source-not-found", `Plugin copy not found for ${source.name}: ${beforeRoot}`);
    }
    files.push(...compareTrees(beforeRoot, upstreamPath, ""));
  } else {
    const onlySkill = source.skills.length === 1;
    for (const skill of source.skills) {
      files.push(...compareSkill(source, skill, upstreamPath, onlySkill));
    }
  }
  const warnings: string[] = [];
  const summary = {
    added: files.filter((file) => file.status === "added").length,
    deleted: files.filter((file) => file.status === "deleted").length,
    modified: files.filter((file) => file.status === "modified" || file.status === "type-changed").length,
    binary: files.filter((file) => file.binary).length,
  };
  return {
    name: source.name,
    workingPath: source.workingPath,
    upstreamPath,
    fromCommit: source.locked?.commit,
    toCommit: commit,
    files,
    summary,
    warnings,
  };
}

export async function sourceDiff(vaultPath: string, name: string): Promise<SourceDiff> {
  const snapshot = await loadVault(vaultPath);
  return diffForSnapshot(snapshot, name);
}

export async function diffForSnapshot(snapshot: VaultSnapshot, name: string): Promise<SourceDiff> {
  const source = findSource(snapshot, name);
  if (source.origin !== "github") {
    throw new VaultDeskError("unsupported", `Source ${source.name} is local and has no upstream diff`);
  }
  const fetched = await fetchUpstream(source);
  if (!exists(fetched.root)) {
    throw new VaultDeskError("upstream-not-found", `Fetch cache missing for ${source.name}`);
  }
  return diffSourceRecord(source, fetched.root, fetched.commit);
}

export function sourceFileHash(filePath: string): string {
  return `sha256:${sha256(fs.readFileSync(filePath))}`;
}
