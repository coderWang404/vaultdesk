import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const INTERNAL_METADATA = new Set([".source.yml", ".source-commit", ".vault-managed", ".DS_Store"]);
const DEFAULT_EXCLUDED_DIRS = new Set([".git", "node_modules", ".vault", "__pycache__", ".DS_Store"]);
const directoryHashes = new AsyncLocalStorage<Map<string, string>>();

/** Reuse hashes only within one read snapshot; writes and later reads stay fresh. */
export function withDirectoryHashCache<T>(read: () => Promise<T>): Promise<T> {
  return directoryHashes.run(new Map(), read);
}

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function canonicalPath(input: string): string {
  const expanded = path.resolve(expandHome(input));
  let existing = expanded;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = fs.existsSync(existing) ? fs.realpathSync(existing) : existing;
  const rest = path.relative(existing, expanded);
  return rest ? path.join(real, rest) : real;
}

export function isInside(child: string, parent: string): boolean {
  const c = canonicalPath(child);
  const p = canonicalPath(parent);
  return c === p || c.startsWith(p + path.sep);
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readText(filePath)) as T;
  } catch {
    return fallback;
  }
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeTextAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, filePath);
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, JSON.stringify(value, null, 2) + "\n");
}

/** True when a process with this pid exists (even if owned by another user). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const startTokens = new Map<number, string | undefined>();

/**
 * An opaque token for when a process started, identical for every caller that
 * asks about the same process. Undefined when the system cannot report it.
 */
export function processStartToken(pid: number): string | undefined {
  if (pid === process.pid && startTokens.has(pid)) return startTokens.get(pid);
  let token: string | undefined;
  try {
    const ps = fs.existsSync("/bin/ps") ? "/bin/ps" : "ps";
    // A fixed time zone and locale make the text identical across processes.
    token = execFileSync(ps, ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" },
    }).trim().replace(/\s+/g, " ") || undefined;
  } catch {
    token = undefined;
  }
  if (pid === process.pid) startTokens.set(pid, token);
  return token;
}

/**
 * True when the process that wrote a lock is still running. The owner records
 * its start token in the lock; if the pid is alive but its start token differs,
 * the operating system gave that number to a later, unrelated process and the
 * lock is a leftover. Without a recorded token, a live pid counts as the owner.
 */
export function isLockOwnerAlive(pid: number, recordedStartToken?: string): boolean {
  if (!isProcessAlive(pid)) return false;
  if (!recordedStartToken) return true;
  const current = processStartToken(pid);
  return current === undefined || current === recordedStartToken;
}

/**
 * Recursive copy that keeps every symlink target exactly as written.
 * Plain fs.cpSync rewrites relative links into absolute paths that point back
 * at the copy source, which changes content hashes and breaks moved copies.
 */
export function copyTree(source: string, destination: string, filter?: (source: string) => boolean): void {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    ...(filter ? { filter } : {}),
  });
}

export function removePath(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export function exists(target: string): boolean {
  return fs.existsSync(target);
}

export function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

export function fileSize(target: string): number {
  try {
    return fs.statSync(target).size;
  } catch {
    return 0;
  }
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface WalkEntry {
  rel: string;
  abs: string;
  kind: "file" | "symlink";
  mode: number;
  size: number;
}

export interface WalkOptions {
  excludeFiles?: Set<string>;
  excludeDirs?: Set<string>;
}

export function walkFiles(root: string, options: WalkOptions = {}): WalkEntry[] {
  const excludeFiles = options.excludeFiles ?? INTERNAL_METADATA;
  const excludeDirs = options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS;
  const results: WalkEntry[] = [];

  const visit = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (excludeFiles.has(entry.name) || entry.name.endsWith(".pyc")) continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        visit(abs, rel);
      } else if (entry.isSymbolicLink()) {
        results.push({ rel, abs, kind: "symlink", mode: 0, size: 0 });
      } else if (entry.isFile()) {
        const stat = fs.statSync(abs);
        results.push({ rel, abs, kind: "file", mode: stat.mode & 0o777, size: stat.size });
      }
    }
  };

  visit(root, "");
  return results.sort((a, b) => a.rel.localeCompare(b.rel));
}

export class SymlinkEscapeError extends Error {
  readonly rel: string;
  readonly reason: "unresolved" | "escapes";
  constructor(rel: string, reason: "unresolved" | "escapes") {
    super(reason === "unresolved" ? `Skill symlink is unresolved: ${rel}` : `Skill symlink escapes its root: ${rel}`);
    this.name = "SymlinkEscapeError";
    this.rel = rel;
    this.reason = reason;
  }
}

/**
 * Throw when a tree holds a symlink that is absolute, dangling, or resolves
 * outside the tree. Such a link cannot be distributed to an agent directory.
 */
export function assertContainedSymlinks(root: string, options: WalkOptions = {}): void {
  const realRoot = fs.realpathSync(root);
  for (const file of walkFiles(root, options)) {
    if (file.kind !== "symlink") continue;
    const link = fs.readlinkSync(file.abs);
    let resolved: string;
    try {
      resolved = fs.realpathSync(file.abs);
    } catch {
      throw new SymlinkEscapeError(file.rel, "unresolved");
    }
    if (path.isAbsolute(link) || (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep))) {
      throw new SymlinkEscapeError(file.rel, "escapes");
    }
  }
}

export function hashDirectory(root: string, options: WalkOptions = {}): string {
  if (!isDirectory(root)) return "";
  const cache = directoryHashes.getStore();
  const key = cache ? JSON.stringify([
    canonicalPath(root),
    [...(options.excludeFiles ?? INTERNAL_METADATA)].sort(),
    [...(options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS)].sort(),
  ]) : undefined;
  const cached = key ? cache?.get(key) : undefined;
  if (cached !== undefined) return cached;
  const hash = createHash("sha256");
  for (const entry of walkFiles(root, options)) {
    hash.update(entry.rel);
    hash.update("\0");
    if (entry.kind === "symlink") {
      hash.update("symlink\0");
      hash.update(fs.readlinkSync(entry.abs));
    } else {
      hash.update(String(entry.mode & 0o111));
      hash.update("\0");
      hash.update(fs.readFileSync(entry.abs));
    }
    hash.update("\0");
  }
  const result = `sha256:${hash.digest("hex")}`;
  if (key) cache?.set(key, result);
  return result;
}

export function hashText(value: string): string {
  return `sha256:${sha256(value)}`;
}

export function copyDirectory(source: string, destination: string, options: WalkOptions = {}): void {
  const excludeFiles = options.excludeFiles ?? INTERNAL_METADATA;
  const excludeDirs = options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS;

  const copy = (src: string, dest: string): void => {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (excludeFiles.has(entry.name) || entry.name.endsWith(".pyc")) continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        copy(from, to);
      } else if (entry.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(from);
        fs.symlinkSync(linkTarget, to);
      } else if (entry.isFile()) {
        fs.copyFileSync(from, to);
        fs.chmodSync(to, fs.statSync(from).mode & 0o777);
      }
    }
  };

  copy(source, destination);
}

export function movePath(source: string, destination: string): void {
  ensureDir(path.dirname(destination));
  try {
    fs.renameSync(source, destination);
  } catch {
    copyTree(source, destination);
    removePath(source);
  }
}

export function listDirectory(target: string): fs.Dirent[] {
  try {
    return fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function relativeSlash(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8000);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}
