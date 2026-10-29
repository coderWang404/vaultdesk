import path from "node:path";
import { ensureDir, exists, isDirectory, movePath, removePath, sha256, writeJsonAtomic } from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { git, gitLsRemote } from "../git.js";
import type { SourceRecord } from "../types.js";
import { cacheRoot } from "./select.js";

export interface FetchedSource {
  source: SourceRecord;
  remote: string;
  commit: string;
  root: string;
  cached: boolean;
}

export interface FetchResult {
  commit: string;
  remote: string;
  root: string;
  cached: boolean;
}

export function remoteFor(source: SourceRecord): string {
  if (source.remoteUrl) return source.remoteUrl;
  if (!source.repo) {
    throw new VaultDeskError("source-not-found", `Source ${source.name} has no repo or remote_url`);
  }
  return `https://github.com/${source.repo}.git`;
}

export function cacheBaseFor(source: SourceRecord): string {
  const remote = remoteFor(source);
  const repo = (source.repo ?? "remote").replace(/[^a-zA-Z0-9._-]+/g, "__");
  return path.join(cacheRoot(), "upstream", `${repo}-${sha256(remote).slice(0, 10)}`);
}

async function cloneInto(source: SourceRecord, remote: string, temp: string): Promise<void> {
  const cwd = cacheRoot();
  ensureDir(cwd);
  const args = ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", source.ref, remote, temp];
  try {
    await git(args, cwd, { timeoutMs: 180_000 });
  } catch (error) {
    if (error instanceof VaultDeskError && (error.code === "auth-failed" || error.code === "network")) throw error;
    removePath(temp);
    try {
      await git(["clone", "--depth", "1", "--sparse", "--branch", source.ref, remote, temp], cwd, {
        timeoutMs: 180_000,
      });
    } catch (retryError) {
      if (retryError instanceof VaultDeskError && (retryError.code === "auth-failed" || retryError.code === "network")) {
        throw retryError;
      }
      removePath(temp);
      await git(["clone", "--depth", "1", "--branch", source.ref, remote, temp], cwd, { timeoutMs: 180_000 });
    }
  }
}

export async function fetchUpstream(source: SourceRecord): Promise<FetchResult> {
  if (source.origin !== "github") {
    throw new VaultDeskError("unsupported", `Source ${source.name} is local and has no upstream`);
  }
  const remote = remoteFor(source);
  const base = cacheBaseFor(source);
  ensureDir(base);
  const commit = await gitLsRemote(remote, source.ref, base);
  // A sparse checkout is only complete for the paths requested by this source.
  // Other sources at the same commit may need different paths.
  const sourcePaths = [
    ...new Set(
      source.skills
        .map((skill) => skill.sourcePath)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const fullTree = sourcePaths.length === 0 || sourcePaths.some((value) => value === "." || value === "./");
  const checkoutKey = fullTree ? "full" : sha256(JSON.stringify(sourcePaths)).slice(0, 16);
  const cacheDir = path.join(base, commit, checkoutKey);
  const repoDir = path.join(cacheDir, "repo");
  const metaFile = path.join(cacheDir, "meta.json");

  if (isDirectory(repoDir) && exists(metaFile)) {
    return { commit, remote, root: repoDir, cached: true };
  }

  ensureDir(base);
  const temp = path.join(base, `.tmp-${process.pid}-${Date.now()}`);
  removePath(temp);
  await cloneInto(source, remote, temp);

  const resolved = (await git(["rev-parse", "HEAD"], temp, { allowFailure: true, timeoutMs: 10_000 })).stdout.trim();
  if (fullTree) {
    await git(["sparse-checkout", "disable"], temp, { allowFailure: true });
  } else {
    const sparse = await git(["sparse-checkout", "set", ...sourcePaths], temp, { allowFailure: true });
    if (sparse.code !== 0) {
      await git(["sparse-checkout", "disable"], temp, { allowFailure: true });
    }
  }

  removePath(cacheDir);
  ensureDir(cacheDir);
  movePath(temp, repoDir);
  writeJsonAtomic(metaFile, {
    repo: source.repo,
    remote,
    ref: source.ref,
    commit: resolved || commit,
    source_paths: sourcePaths,
    fetched_at: new Date().toISOString(),
  });
  return { commit: resolved || commit, remote, root: repoDir, cached: false };
}

export async function fetchAll(sources: SourceRecord[]): Promise<FetchedSource[]> {
  const results: FetchedSource[] = [];
  for (const source of sources) {
    if (source.origin !== "github") continue;
    const fetched = await fetchUpstream(source);
    results.push({ source, ...fetched });
  }
  return results;
}
