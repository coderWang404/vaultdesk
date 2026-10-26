import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VaultDeskError } from "./errors.js";

const execFileAsync = promisify(execFile);

export interface GitOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
  code: number;
}

function classifyGitFailure(stderr: string, stdout: string): "auth-failed" | "network" | "git-failed" {
  const text = `${stderr}\n${stdout}`.toLowerCase();
  if (
    /authentication failed|could not read username|terminal prompts disabled|permission denied|access denied|invalid username or password|repository not found/.test(
      text,
    )
  ) {
    return "auth-failed";
  }
  if (/could not resolve host|network is unreachable|connection timed out|connection refused|tls|ssl|proxy/.test(text)) {
    return "network";
  }
  return "git-failed";
}

export async function git(args: string[], cwd: string, options: GitOptions = {}): Promise<GitOutput> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: process.env.GIT_ASKPASS ?? "true",
        LC_ALL: "C",
        ...options.env,
      },
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    if (options.allowFailure) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? err.message, code: typeof err.code === "number" ? err.code : 1 };
    }
    const code = classifyGitFailure(err.stderr ?? "", err.stdout ?? "");
    throw new VaultDeskError(code, `git ${args.join(" ")} failed: ${(err.stderr || err.message).trim()}`, {
      details: { args, cwd, stderr: err.stderr, stdout: err.stdout },
      cause: error,
    });
  }
}

export interface GitChange {
  status: string;
  path: string;
  from?: string;
}

export interface GitSummary {
  isRepo: boolean;
  branch?: string;
  head?: string;
  dirty: boolean;
  changes: GitChange[];
  remote?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await git(["rev-parse", "--is-inside-work-tree"], cwd, { allowFailure: true, timeoutMs: 10_000 });
    return result.code === 0 && result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getGitSummary(cwd: string): Promise<GitSummary> {
  if (!(await isGitRepo(cwd))) {
    return { isRepo: false, dirty: false, changes: [] };
  }

  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd, {
    allowFailure: true,
  });
  const fields = status.stdout.split("\0");
  const changes: GitChange[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    const code = entry.slice(0, 2);
    const changePath = entry.slice(3);
    let from: string | undefined;
    if (code.includes("R") || code.includes("C")) {
      from = fields[index + 1];
      index += 1;
    }
    changes.push({ status: code.trim() || "?", path: changePath, ...(from ? { from } : {}) });
  }

  const branchResult = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, { allowFailure: true });
  const headResult = await git(["rev-parse", "HEAD"], cwd, { allowFailure: true });
  const remoteResult = await git(["remote", "get-url", "origin"], cwd, { allowFailure: true });

  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const upstreamResult = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd, {
    allowFailure: true,
  });
  if (upstreamResult.code === 0 && upstreamResult.stdout.trim()) {
    upstream = upstreamResult.stdout.trim();
    const count = await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], cwd, { allowFailure: true });
    if (count.code === 0) {
      const [left, right] = count.stdout.trim().split(/\s+/);
      ahead = Number(left ?? 0);
      behind = Number(right ?? 0);
    }
  }

  return {
    isRepo: true,
    branch: branchResult.code === 0 ? branchResult.stdout.trim() : undefined,
    head: headResult.code === 0 ? headResult.stdout.trim() : undefined,
    dirty: changes.length > 0,
    changes,
    remote: remoteResult.code === 0 ? remoteResult.stdout.trim() : undefined,
    upstream,
    ahead,
    behind,
  };
}

export async function isWorktreeClean(cwd: string): Promise<boolean> {
  const status = await git(["status", "--porcelain"], cwd, { allowFailure: true });
  return status.code === 0 && status.stdout.trim() === "";
}

export async function currentCommit(cwd: string): Promise<string | undefined> {
  const result = await git(["rev-parse", "HEAD"], cwd, { allowFailure: true, timeoutMs: 10_000 });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, { allowFailure: true, timeoutMs: 10_000 });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function gitLsRemote(remote: string, ref: string, cwd: string): Promise<string> {
  const result = await git(
    ["-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=20", "ls-remote", remote, ref],
    cwd,
    { timeoutMs: 45_000 },
  );
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", refName = ""] = line.split(/\s+/);
      return { sha, refName };
    })
    .filter((entry) => entry.sha && entry.refName);
  const exact =
    lines.find((entry) => entry.refName === `refs/heads/${ref}`) ??
    lines.find((entry) => entry.refName === `refs/tags/${ref}`) ??
    lines.find((entry) => entry.refName === ref) ??
    lines[0];
  if (!exact) {
    throw new VaultDeskError("upstream-not-found", `Remote ref ${ref} not found at ${remote}`, {
      details: { remote, ref },
    });
  }
  return exact.sha;
}

function safeGitPath(raw: string): string {
  const value = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!value) {
    throw new VaultDeskError("invalid-input", "Refusing to stage an empty Git path.");
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new VaultDeskError("invalid-input", `Refusing to stage an absolute Git path: ${raw}`);
  }
  if (value.split("/").includes("..")) {
    throw new VaultDeskError("invalid-input", `Refusing to stage a path that escapes the vault: ${raw}`);
  }
  if (value === ".git" || value.startsWith(".git/")) {
    throw new VaultDeskError("invalid-input", `Refusing to stage Git internals: ${raw}`);
  }
  if (value === ".vault" || (value.startsWith(".vault/") && value !== ".vault/.gitignore")) {
    throw new VaultDeskError("invalid-input", `Refusing to stage VaultDesk state: ${raw}`);
  }
  return value;
}

export function assertSafeGitPath(raw: string): string {
  return safeGitPath(raw);
}

export function resolveCommitPaths(summary: GitSummary, requested: string[]): string[] {
  if (requested.length === 0) {
    throw new VaultDeskError("invalid-input", "A Git commit requires at least one path.");
  }
  const selected = new Set<string>();
  for (const raw of requested) {
    const value = safeGitPath(raw);
    const matches = summary.changes.filter(
      (change) =>
        change.path === value ||
        change.from === value ||
        change.path.startsWith(`${value}/`),
    );
    if (matches.length === 0) {
      throw new VaultDeskError("invalid-input", `Path is not a current Git change: ${raw}`);
    }
    for (const change of matches) {
      selected.add(change.path);
      if (change.from) selected.add(change.from);
    }
  }
  return [...selected].sort();
}

export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const safe = [...new Set(paths.map((entry) => safeGitPath(entry)))];
  await git(["add", "--", ...safe], cwd);
}

export async function commitPaths(cwd: string, paths: string[], message: string): Promise<string> {
  if (!message.trim()) throw new VaultDeskError("invalid-input", "A Git commit requires a message.");
  await stagePaths(cwd, paths);
  const safe = [...new Set(paths.map((entry) => safeGitPath(entry)))];
  await git(["commit", "-m", message, "--", ...safe], cwd);
  const head = await currentCommit(cwd);
  if (!head) throw new VaultDeskError("git-failed", "Commit succeeded but HEAD could not be resolved");
  return head;
}

export async function createBranch(cwd: string, branch: string): Promise<void> {
  const exists = await git(["rev-parse", "--verify", `refs/heads/${branch}`], cwd, { allowFailure: true });
  if (exists.code === 0) {
    const current = await currentBranch(cwd);
    if (current !== branch) {
      const checkout = await git(["checkout", branch], cwd, { allowFailure: true });
      if (checkout.code !== 0) {
        throw new VaultDeskError("git-failed", `Branch ${branch} exists but could not be checked out: ${checkout.stderr}`);
      }
    }
    return;
  }
  await git(["checkout", "-b", branch], cwd);
}

export async function push(cwd: string): Promise<{ stdout: string; stderr: string }> {
  return git(["push"], cwd, { timeoutMs: 120_000 });
}
