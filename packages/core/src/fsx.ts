import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const INTERNAL_METADATA = new Set([".source.yml", ".source-commit", ".vault-managed", ".DS_Store"]);
const DEFAULT_EXCLUDED_DIRS = new Set([".git", "node_modules", ".vault", ".DS_Store"]);

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
      if (excludeFiles.has(entry.name)) continue;
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

export function hashDirectory(root: string, options: WalkOptions = {}): string {
  if (!isDirectory(root)) return "";
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
  return `sha256:${hash.digest("hex")}`;
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
      if (excludeFiles.has(entry.name)) continue;
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
    fs.cpSync(source, destination, { recursive: true, dereference: false });
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
