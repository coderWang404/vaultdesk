import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addGithubPlugin,
  checkSources,
  initVault,
  lockForVault,
  openVault,
  previewUpdate,
  removeSource,
  sourceDiff,
  updateSources,
  validateVault,
} from "@vaultdesk/core";
import { git, initGitRepo, tempDir } from "./helpers.js";

function writePlugin(root: string, name: string, version = "1.0.0", body = "helper body one"): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({ name, version, description: `${name} plugin` }, null, 2),
  );
  fs.mkdirSync(path.join(root, "skills", "helper"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "helper", "SKILL.md"),
    `---\nname: helper\ndescription: ${name} helper\n---\n\n${body}\n`,
  );
  fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "hooks", "on-start.sh"),
    '#!/bin/sh\ntouch "$(dirname "$0")/should-not-run.ran"\n',
  );
  fs.mkdirSync(path.join(root, "notes"), { recursive: true });
  fs.writeFileSync(path.join(root, "notes", "old.md"), "old note\n");
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
}

function commit(dir: string, message: string): string {
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

async function makeVault(): Promise<{ vaultPath: string; repoDir: string; remoteUrl: string }> {
  const base = tempDir("plugin-update");
  const vaultPath = path.join(base, "vault");
  await initVault(vaultPath, { name: "plugins" });
  initGitRepo(vaultPath);
  const repoDir = path.join(base, "upstream");
  writePlugin(repoDir, "update-kit");
  initGitRepo(repoDir);
  return { vaultPath, repoDir, remoteUrl: `file://${repoDir}` };
}

describe("plugin update", () => {
  it("diffs and updates a whole plugin root, then removes it cleanly", async () => {
    const { vaultPath, repoDir, remoteUrl } = await makeVault();
    const firstCommit = git(repoDir, ["rev-parse", "HEAD"]).trim();
    await addGithubPlugin(vaultPath, { repo: "fixture/update-kit", remoteUrl, ref: "main" });
    commit(vaultPath, "chore: add update-kit");

    const before = (await openVault(vaultPath)).plugins[0];
    expect(before?.locked?.commit).toBe(firstCommit);
    const firstSkillHash = before?.locked?.skills?.helper;
    expect(firstSkillHash).toMatch(/^sha256:/);
    expect((await lockForVault(vaultPath)).sources["update-kit"]?.skills?.helper).toBe(firstSkillHash);

    fs.writeFileSync(
      path.join(repoDir, "plugin.json"),
      JSON.stringify({ name: "update-kit", version: "2.0.0", description: "second" }, null, 2),
    );
    fs.writeFileSync(
      path.join(repoDir, "skills", "helper", "SKILL.md"),
      "---\nname: helper\ndescription: update-kit helper\n---\n\nhelper body two\n",
    );
    fs.mkdirSync(path.join(repoDir, "commands"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "commands", "hello.md"), "# hello\n");
    fs.mkdirSync(path.join(repoDir, "skills", "second"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "skills", "second", "SKILL.md"),
      "---\nname: second\ndescription: second skill\n---\n\nsecond body\n",
    );
    fs.rmSync(path.join(repoDir, "notes", "old.md"));
    const secondCommit = commit(repoDir, "plugin v2");

    const report = await checkSources(vaultPath, { persist: false });
    expect(report.results[0]).toMatchObject({
      name: "update-kit",
      status: "update-available",
      currentCommit: firstCommit,
      remoteCommit: secondCommit,
    });

    const diff = await sourceDiff(vaultPath, "update-kit");
    const statuses = Object.fromEntries(diff.files.map((file) => [file.path, file.status]));
    expect(statuses).toMatchObject({
      "plugin.json": "modified",
      "skills/helper/SKILL.md": "modified",
      "skills/second/SKILL.md": "added",
      "commands/hello.md": "added",
      "notes/old.md": "deleted",
    });
    expect(diff.files.find((file) => file.path === "skills/helper/SKILL.md")?.patch).toContain("helper body two");
    expect(diff.upstreamPath).toContain(secondCommit);
    expect(diff.toCommit).toBe(secondCommit);

    const preview = await previewUpdate(vaultPath, ["update-kit"]);
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]?.name).toBe("update-kit");

    const result = await updateSources(vaultPath, { names: ["update-kit"] });
    expect(result.applied).toBe(true);
    expect(result.changes[0]?.name).toBe("update-kit");

    const after = await openVault(vaultPath);
    const plugin = after.plugins[0];
    expect(plugin).toMatchObject({ name: "update-kit", status: "current", version: "2.0.0", description: "second" });
    const metadata = fs.readFileSync(path.join(vaultPath, "sources", "update-kit.yml"), "utf8");
    expect(metadata).toContain("version: 2.0.0");
    expect(metadata).toContain("description: second");
    expect(plugin?.locked?.commit).toBe(secondCommit);
    expect(plugin?.locked?.hash).toMatch(/^sha256:/);
    expect(plugin?.locked?.skills?.helper).not.toBe(firstSkillHash);
    expect(Object.keys(plugin?.locked?.skills ?? {}).sort()).toEqual(["helper", "second"]);

    for (const root of [
      path.join(vaultPath, "plugins", "update-kit"),
      path.join(vaultPath, "third_party", "update-kit"),
    ]) {
      expect(fs.readFileSync(path.join(root, "skills", "helper", "SKILL.md"), "utf8")).toContain("helper body two");
      expect(fs.existsSync(path.join(root, "commands", "hello.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "notes", "old.md"))).toBe(false);
      expect(fs.existsSync(path.join(root, "hooks", "should-not-run.ran"))).toBe(false);
    }
    expect(fs.readFileSync(path.join(vaultPath, "vault.lock"), "utf8")).toContain(secondCommit);
    expect((await sourceDiff(vaultPath, "update-kit")).files).toEqual([]);
    expect((await validateVault(vaultPath)).ok).toBe(true);

    expect((await removeSource(vaultPath, "update-kit", { deleteFiles: true })).removedPaths.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(vaultPath, "sources", "update-kit.yml"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "plugins", "update-kit"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "third_party", "update-kit"))).toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, "vault.lock"), "utf8")).not.toContain("update-kit");
    const state = JSON.parse(fs.readFileSync(path.join(vaultPath, ".vault", "state.json"), "utf8")) as {
      sources: Record<string, unknown>;
    };
    expect(state.sources["update-kit"]).toBeUndefined();
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("blocks a committed local plugin edit unless forced", async () => {
    const { vaultPath, repoDir, remoteUrl } = await makeVault();
    await addGithubPlugin(vaultPath, { repo: "fixture/update-kit", remoteUrl, ref: "main" });
    commit(vaultPath, "chore: add update-kit");

    fs.appendFileSync(path.join(vaultPath, "plugins", "update-kit", "skills", "helper", "SKILL.md"), "\nlocal edit\n");
    commit(vaultPath, "chore: local plugin edit");

    fs.mkdirSync(path.join(repoDir, "commands"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "commands", "third.md"), "# third\n");
    commit(repoDir, "plugin v3");

    await expect(updateSources(vaultPath, { names: ["update-kit"] })).rejects.toMatchObject({ code: "conflict" });

    const forced = await updateSources(vaultPath, { names: ["update-kit"], force: true });
    expect(forced.applied).toBe(true);
    const updated = fs.readFileSync(path.join(vaultPath, "plugins", "update-kit", "skills", "helper", "SKILL.md"), "utf8");
    expect(updated).not.toContain("local edit");
    expect(fs.existsSync(path.join(vaultPath, "plugins", "update-kit", "commands", "third.md"))).toBe(true);
  });

  it("blocks updates when the pristine vendor copy was edited", async () => {
    const { vaultPath, repoDir, remoteUrl } = await makeVault();
    await addGithubPlugin(vaultPath, { repo: "fixture/update-kit", remoteUrl, ref: "main" });
    commit(vaultPath, "chore: add update-kit");

    fs.appendFileSync(path.join(vaultPath, "third_party", "update-kit", "plugin.json"), "\n");
    commit(vaultPath, "chore: edit vendor copy");

    fs.writeFileSync(
      path.join(repoDir, "plugin.json"),
      JSON.stringify({ name: "update-kit", version: "2.0.0", description: "second" }, null, 2),
    );
    commit(repoDir, "plugin v2");

    await expect(updateSources(vaultPath, { names: ["update-kit"] })).rejects.toMatchObject({ code: "conflict" });

    const forced = await updateSources(vaultPath, { names: ["update-kit"], force: true });
    expect(forced.applied).toBe(true);
    for (const root of [
      path.join(vaultPath, "plugins", "update-kit"),
      path.join(vaultPath, "third_party", "update-kit"),
    ]) {
      expect(JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"))).toMatchObject({ version: "2.0.0" });
    }
  });

  it("updates only the recorded content_path of a nested plugin", async () => {
    const base = tempDir("plugin-update-nested");
    const vaultPath = path.join(base, "vault");
    await initVault(vaultPath, { name: "plugins" });
    initGitRepo(vaultPath);
    const repoDir = path.join(base, "upstream");
    writePlugin(path.join(repoDir, "packages", "nested-kit"), "nested-kit");
    fs.mkdirSync(path.join(repoDir, "unrelated"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "unrelated", "README.md"), "not part of the plugin\n");
    initGitRepo(repoDir);
    const remoteUrl = `file://${repoDir}`;

    await addGithubPlugin(vaultPath, {
      repo: "fixture/nested",
      remoteUrl,
      ref: "main",
      path: "packages/nested-kit",
    });
    commit(vaultPath, "chore: add nested-kit");

    fs.writeFileSync(
      path.join(repoDir, "packages", "nested-kit", "plugin.json"),
      JSON.stringify({ name: "nested-kit", version: "2.0.0" }, null, 2),
    );
    fs.writeFileSync(path.join(repoDir, "unrelated", "README.md"), "changed but irrelevant\n");
    commit(repoDir, "nested v2");

    const diff = await sourceDiff(vaultPath, "nested-kit");
    expect(diff.files.map((file) => file.path)).toEqual(["plugin.json"]);
    const preview = await previewUpdate(vaultPath, ["nested-kit"]);
    expect(preview.changes).toHaveLength(1);

    await updateSources(vaultPath, { names: ["nested-kit"] });
    expect(
      JSON.parse(fs.readFileSync(path.join(vaultPath, "plugins", "nested-kit", "plugin.json"), "utf8")),
    ).toMatchObject({ version: "2.0.0" });
    expect(fs.existsSync(path.join(vaultPath, "plugins", "nested-kit", "unrelated"))).toBe(false);
  });
});
