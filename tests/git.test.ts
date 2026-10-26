import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commitPaths, getGitSummary, resolveCommitPaths } from "@vaultdesk/core";
import { git, tempDir } from "./helpers.js";

function repoWithChanges(): string {
  const dir = path.join(tempDir("git"), "repo");
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "tests@vaultdesk.local"]);
  git(dir, ["config", "user.name", "VaultDesk Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(dir, "old.txt"), "one\n");
  fs.writeFileSync(path.join(dir, "keep.txt"), "keep\n");
  fs.writeFileSync(path.join(dir, "技能.md"), "before\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "initial"]);

  git(dir, ["mv", "old.txt", "new.txt"]);
  fs.appendFileSync(path.join(dir, "keep.txt"), "changed\n");
  fs.writeFileSync(path.join(dir, "技能.md"), "after\n");
  return dir;
}

describe("git safety", () => {
  it("parses renames and non-ASCII paths without porcelain quoting", async () => {
    const dir = repoWithChanges();
    const summary = await getGitSummary(dir);
    expect(summary.isRepo).toBe(true);
    expect(summary.dirty).toBe(true);

    const rename = summary.changes.find((change) => change.path === "new.txt");
    expect(rename).toMatchObject({ status: "R", from: "old.txt" });
    const unicode = summary.changes.find((change) => change.path === "技能.md");
    expect(unicode?.status).toBe("M");
    expect(unicode?.path).not.toContain('"');
    expect(summary.changes.some((change) => change.path === "keep.txt")).toBe(true);
  });

  it("expands renames and rejects unsafe or unchanged paths", async () => {
    const dir = repoWithChanges();
    const summary = await getGitSummary(dir);

    expect(resolveCommitPaths(summary, ["new.txt"])).toEqual(["new.txt", "old.txt"]);
    expect(resolveCommitPaths(summary, ["技能.md"])).toEqual(["技能.md"]);

    for (const unsafe of ["/etc/passwd", "../escape.txt", ".git/config", ".vault/state.json"]) {
      expect(() => resolveCommitPaths(summary, [unsafe])).toThrow(/Refusing/);
    }
    expect(() => resolveCommitPaths(summary, [".vault/.gitignore"])).toThrow(/not a current Git change/);
    expect(() => resolveCommitPaths(summary, ["keep.txt", "untracked.txt"])).toThrow(/not a current Git change/);
  });

  it("commits only the requested paths", async () => {
    const dir = repoWithChanges();
    const summary = await getGitSummary(dir);
    const paths = resolveCommitPaths(summary, ["技能.md"]);
    const commit = await commitPaths(dir, paths, "docs: update 技能 note");

    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    const show = git(dir, ["-c", "core.quotePath=false", "show", "--name-only", "--pretty=format:", "HEAD"]);
    expect(show).toContain("技能.md");
    expect(show).not.toContain("keep.txt");
    expect(show).not.toContain("new.txt");

    const after = await getGitSummary(dir);
    expect(after.changes.some((change) => change.path === "keep.txt")).toBe(true);
    expect(after.changes.some((change) => change.path === "new.txt")).toBe(true);
    expect(after.changes.some((change) => change.path === "技能.md")).toBe(false);
  });

  it("reports a clean repository without inventing changes", async () => {
    const dir = path.join(tempDir("git-clean"), "repo");
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-b", "main"]);
    const summary = await getGitSummary(dir);
    expect(summary).toMatchObject({ isRepo: true, dirty: false });
    const notRepo = path.join(tempDir("git-none"), "plain");
    fs.mkdirSync(notRepo, { recursive: true });
    expect(await getGitSummary(notRepo)).toEqual({ isRepo: false, dirty: false, changes: [] });
  });
});
