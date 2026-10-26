import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vaultdesk-${prefix}-`));
}

export function copyFixture(name: string): string {
  const target = path.join(tempDir("fixture"), name);
  fs.cpSync(path.join(repoRoot, "fixtures", name), target, { recursive: true });
  return target;
}

export function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

export function initGitRepo(dir: string): void {
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "tests@vaultdesk.local"]);
  git(dir, ["config", "user.name", "VaultDesk Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "fixture"]);
}

export function setTargetDest(vaultPath: string, dest: string): void {
  const file = path.join(vaultPath, "vault.yml");
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(/^(\s*dest:\s*).*$/m, `$1${dest}`);
  if (next === text) throw new Error("Could not rewrite target destination");
  fs.writeFileSync(file, next, "utf8");
}

export interface TreeEntry {
  kind: "file" | "dir" | "symlink";
  hash?: string;
  target?: string;
}

export function snapshotTree(root: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  const visit = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        entries.set(rel, { kind: "symlink", target: fs.readlinkSync(abs) });
      } else if (entry.isDirectory()) {
        entries.set(rel, { kind: "dir" });
        visit(abs, rel);
      } else if (entry.isFile()) {
        entries.set(rel, {
          kind: "file",
          hash: createHash("sha256").update(fs.readFileSync(abs)).digest("hex"),
        });
      }
    }
  };
  visit(root, "");
  return entries;
}

export function fileText(file: string): string {
  return fs.readFileSync(file, "utf8");
}
