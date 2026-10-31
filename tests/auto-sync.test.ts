import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { addGithubPlugin, adoptPendingSkills, autoSyncVault, distributeCurrentSource, hashDirectory, initVault, listPendingSkills, setSourceUpdateMode } from "@vaultdesk/core";
import { copyFixture, git, initGitRepo, repoRoot, tempDir } from "./helpers.js";

function runCli(vaultPath: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "packages/cli/dist/index.js"), "--json", "--vault", vaultPath, ...args], {
    cwd: repoRoot, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env }, timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, data: JSON.parse(result.stdout) as { data: unknown; errors: Array<{ code: string; message: string }> } };
}

function setup(mode: "auto" | "review-before-apply" | "frozen" = "auto") {
  const vaultPath = copyFixture("v2-basic");
  const upstream = tempDir("auto-upstream");
  const remote = tempDir("auto-bare");
  const agentsSkillsDir = tempDir("auto-agents");
  const target = tempDir("auto-target");
  const backupRoot = tempDir("auto-backup");
  const pendingRoot = tempDir("auto-pending");
  const workingFile = path.join(vaultPath, "skills", "gh-standalone", "SKILL.md");
  const vendorFile = path.join(vaultPath, "third_party", "gh-standalone", "SKILL.md");
  const upstreamSkill = path.join(upstream, "skills", "gh-standalone");
  fs.mkdirSync(upstreamSkill, { recursive: true });
  fs.writeFileSync(path.join(upstreamSkill, "SKILL.md"), fs.readFileSync(workingFile, "utf8") + "\nVersion two.\n");
  initGitRepo(upstream);
  const sourceFile = path.join(vaultPath, "sources", "gh-standalone.yml");
  fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, "utf8")
    .replace("ref: main\n", `ref: main\nremote_url: file://${upstream}\n`)
    .replace("update_mode: review-before-apply", `update_mode: ${mode}`));
  const otherSource = path.join(vaultPath, "sources", "gh-pack.yml");
  fs.writeFileSync(otherSource, fs.readFileSync(otherSource, "utf8")
    .replace("update_mode: review-before-apply", "update_mode: frozen"));
  const configFile = path.join(vaultPath, "vault.yml");
  fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace("~/.vaultdesk-fixtures/v2-agents", target));
  initGitRepo(vaultPath);
  git(remote, ["init", "--bare", "-b", "main"]);
  git(vaultPath, ["remote", "add", "origin", remote]);
  git(vaultPath, ["push", "-u", "origin", "main"]);
  return { vaultPath, upstream, remote, agentsSkillsDir, target, backupRoot, pendingRoot, workingFile, vendorFile, upstreamSkill };
}

describe("automatic source sync", () => {
  it("updates master and registered targets, commits only its files, and pushes", async () => {
    const ctx = setup();
    const unrelated = path.join(ctx.vaultPath, "unrelated.txt");
    fs.writeFileSync(unrelated, "local work\n");
    git(ctx.vaultPath, ["add", "unrelated.txt"]);

    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    expect(fs.readFileSync(ctx.workingFile, "utf8")).toContain("Version two.");
    expect(fs.readFileSync(ctx.vendorFile, "utf8")).toContain("Version two.");
    const master = path.join(ctx.agentsSkillsDir, "gh-standalone");
    const installed = path.join(ctx.target, "gh-standalone");
    expect(fs.readFileSync(path.join(master, "SKILL.md"), "utf8")).toContain("Version two.");
    expect(fs.lstatSync(installed).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(installed)).toBe(fs.realpathSync(master));
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim());
    expect(git(ctx.vaultPath, ["show", "--pretty=", "--name-only", "HEAD"])).not.toContain("unrelated.txt");
    expect(git(ctx.vaultPath, ["status", "--porcelain"])).toContain("A  unrelated.txt");
    fs.rmSync(master, { recursive: true, force: true });
    fs.unlinkSync(installed);
    expect(() => fs.lstatSync(installed)).toThrow();
    const current = await autoSyncVault(ctx.vaultPath, ctx);
    expect(current.sources.find((source) => source.name === "gh-standalone")?.message).toMatch(/Distributed current source/);
    expect(current.sources.find((source) => source.name === "gh-standalone")).toMatchObject({ status: "current" });
    expect(fs.readFileSync(path.join(master, "SKILL.md"), "utf8")).toContain("Version two.");
    expect(fs.lstatSync(installed).isSymbolicLink()).toBe(true);
  });

  it("preserves a modified source file and skips automatic overwrite", async () => {
    const ctx = setup();
    fs.appendFileSync(ctx.workingFile, "\nPersonal edit.\n");
    const before = fs.readFileSync(ctx.workingFile, "utf8");
    const head = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(fs.readFileSync(ctx.workingFile, "utf8")).toBe(before);
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("blocks automatic commit when the upstream update introduces credential-like files", async () => {
    const ctx = setup();
    fs.writeFileSync(path.join(ctx.upstreamSkill, ".env"), "API_KEY=should-not-be-committed\n");
    git(ctx.upstream, ["add", "."]);
    git(ctx.upstream, ["commit", "-m", "add credential-like file"]);
    const before = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-standalone");
    expect(result?.status).toBe("error");
    expect(result?.message).toContain("credential-like filename");
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(fs.existsSync(path.join(ctx.vaultPath, "packages", "gh-standalone", ".env"))).toBe(false);
  });

  it("rolls back Vault files when the managed master has unknown ownership", async () => {
    const ctx = setup();
    const master = path.join(ctx.agentsSkillsDir, "gh-standalone");
    fs.mkdirSync(master);
    fs.writeFileSync(path.join(master, "SKILL.md"), "Unowned local copy\n");
    const before = fs.readFileSync(ctx.workingFile, "utf8");
    const vendorBefore = fs.readFileSync(ctx.vendorFile, "utf8");
    const lockBefore = fs.readFileSync(path.join(ctx.vaultPath, "vault.lock"), "utf8");
    const head = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(fs.readFileSync(ctx.workingFile, "utf8")).toBe(before);
    expect(fs.readFileSync(ctx.vendorFile, "utf8")).toBe(vendorBefore);
    expect(fs.readFileSync(path.join(ctx.vaultPath, "vault.lock"), "utf8")).toBe(lockBefore);
    expect(fs.readFileSync(path.join(master, "SKILL.md"), "utf8")).toBe("Unowned local copy\n");
    expect(fs.existsSync(path.join(ctx.vaultPath, ".vault", "operation.json"))).toBe(false);
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(git(ctx.vaultPath, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("keeps a local commit and distributed content when push is rejected", async () => {
    const ctx = setup();
    const hook = path.join(ctx.remote, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const originalRemote = git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-standalone");
    expect(result?.status).toBe("push-failed");
    expect(result?.commit).toBe(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim());
    expect(result?.commit).not.toBe(originalRemote);
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(originalRemote);
    expect(fs.readFileSync(path.join(ctx.agentsSkillsDir, "gh-standalone", "SKILL.md"), "utf8")).toContain("Version two.");
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(1);
  });

  it("retries exactly its recorded commit after a rejected push becomes available", async () => {
    const ctx = setup();
    const hook = path.join(ctx.remote, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const first = await autoSyncVault(ctx.vaultPath, ctx);
    expect(first.sources.find((source) => source.name === "gh-standalone")?.status).toBe("push-failed");
    const pendingCommit = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(1);
    fs.unlinkSync(hook);
    const second = await autoSyncVault(ctx.vaultPath, ctx);
    const recovered = second.sources.find((source) => source.name === "gh-standalone");
    expect(recovered?.status).toBe("updated");
    expect(recovered?.message).toContain("Previously pending automatic commit pushed");
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(pendingCommit);
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(pendingCommit);
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(0);
  });

  it("never retries a pending push after an unrelated new commit", async () => {
    const ctx = setup();
    const hook = path.join(ctx.remote, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const remoteBefore = git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim();
    const first = await autoSyncVault(ctx.vaultPath, ctx);
    expect(first.sources.find((source) => source.name === "gh-standalone")?.status).toBe("push-failed");
    fs.writeFileSync(path.join(ctx.vaultPath, "manual.txt"), "manual commit\n");
    git(ctx.vaultPath, ["add", "manual.txt"]);
    git(ctx.vaultPath, ["commit", "-m", "manual commit"]);
    fs.unlinkSync(hook);
    const second = await autoSyncVault(ctx.vaultPath, ctx);
    expect(second.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(remoteBefore);
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(1);
  });

  it("never retries a pending push after the push URL changes", async () => {
    const ctx = setup();
    const hook = path.join(ctx.remote, "hooks", "pre-receive");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const remoteBefore = git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("push-failed");
    const otherRemote = tempDir("auto-other-bare");
    git(otherRemote, ["init", "--bare", "-b", "main"]);
    git(ctx.vaultPath, ["remote", "set-url", "--push", "origin", otherRemote]);
    fs.unlinkSync(hook);
    const retried = await autoSyncVault(ctx.vaultPath, ctx);
    expect(retried.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(remoteBefore);
    expect(git(otherRemote, ["branch", "--list"]).trim()).toBe("");
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(1);
  });

  it("does not push commits that existed before the automatic update", async () => {
    const ctx = setup();
    fs.writeFileSync(path.join(ctx.vaultPath, "manual.txt"), "manual commit\n");
    git(ctx.vaultPath, ["add", "manual.txt"]);
    git(ctx.vaultPath, ["commit", "-m", "manual commit"]);
    const remoteBefore = git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(remoteBefore);
    expect(fs.readdirSync(ctx.pendingRoot)).toHaveLength(0);
  });

  it("does not commit a source-mode change over unrelated ahead commits", async () => {
    const ctx = setup();
    const metadata = path.join(ctx.vaultPath, "sources", "gh-standalone.yml");
    const before = fs.readFileSync(metadata, "utf8");
    fs.writeFileSync(path.join(ctx.vaultPath, "manual.txt"), "manual\n");
    git(ctx.vaultPath, ["add", "manual.txt"]);
    git(ctx.vaultPath, ["commit", "-m", "manual"]);
    const head = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    const remote = git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim();
    await expect(setSourceUpdateMode(ctx.vaultPath, "gh-standalone", "frozen")).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(metadata, "utf8")).toBe(before);
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(git(ctx.remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(remote);
  });

  it("reports local master edits without overwriting or committing them", async () => {
    const ctx = setup("frozen");
    await distributeCurrentSource(ctx.vaultPath, "local-notes", ctx);
    const masterFile = path.join(ctx.agentsSkillsDir, "local-notes", "SKILL.md");
    fs.appendFileSync(masterFile, "\nPersonal edit.\n");
    const before = fs.readFileSync(masterFile, "utf8");
    const head = git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim();
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "local-notes")?.status).toBe("error");
    expect(report.sources.find((source) => source.name === "local-notes")?.message).toContain("manually modified");
    expect(fs.readFileSync(masterFile, "utf8")).toBe(before);
    expect(git(ctx.vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("refuses to distribute a current Git working copy that differs from its lock", async () => {
    const ctx = setup();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    const master = path.join(ctx.agentsSkillsDir, "gh-standalone");
    const installed = path.join(ctx.target, "gh-standalone");
    fs.rmSync(master, { recursive: true, force: true });
    fs.unlinkSync(installed);
    fs.appendFileSync(ctx.workingFile, "\nUnreviewed edit.\n");
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(fs.existsSync(master)).toBe(false);
    expect(() => fs.lstatSync(installed)).toThrow();
    await expect(distributeCurrentSource(ctx.vaultPath, "gh-standalone", ctx)).rejects.toMatchObject({ code: "conflict" });
  });

  it("reports a manually modified master while the remote source remains current", async () => {
    const ctx = setup();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    const masterFile = path.join(ctx.agentsSkillsDir, "gh-standalone", "SKILL.md");
    fs.appendFileSync(masterFile, "\nLocal master edit.\n");
    const before = fs.readFileSync(masterFile, "utf8");
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-standalone");
    expect(result?.status).toBe("error");
    expect(result?.message).toMatch(/source gh-standalone.*skill gh-standalone.*master/);
    expect(result?.message).toContain("manually modified");
    expect(fs.readFileSync(masterFile, "utf8")).toBe(before);
  });

  it("reports a manually modified active target copy while preserving it", async () => {
    const ctx = setup();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    const master = path.join(ctx.agentsSkillsDir, "gh-standalone");
    const targetSlot = path.join(ctx.target, "gh-standalone");
    fs.rmSync(targetSlot, { recursive: true, force: true });
    fs.cpSync(master, targetSlot, { recursive: true, dereference: true });
    const markerFile = path.join(targetSlot, ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerFile, "utf8")) as Record<string, unknown>;
    marker.target_id = "fixture-agents";
    fs.writeFileSync(markerFile, JSON.stringify(marker, null, 2) + "\n");
    fs.appendFileSync(path.join(targetSlot, "SKILL.md"), "\nLocal target edit.\n");
    const before = fs.readFileSync(path.join(targetSlot, "SKILL.md"), "utf8");
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-standalone");
    expect(result?.status).toBe("error");
    expect(result?.message).toMatch(/source gh-standalone.*skill gh-standalone.*target fixture-agents/);
    expect(fs.readFileSync(path.join(targetSlot, "SKILL.md"), "utf8")).toBe(before);
  });

  it("reports an active target symlink that no longer points to the managed master", async () => {
    const ctx = setup();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    const targetSlot = path.join(ctx.target, "gh-standalone");
    const foreign = tempDir("auto-foreign-target");
    fs.writeFileSync(path.join(foreign, "SKILL.md"), "Foreign target\n");
    fs.rmSync(targetSlot, { recursive: true, force: true });
    fs.symlinkSync(foreign, targetSlot);
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-standalone");
    expect(result?.status).toBe("error");
    expect(result?.message).toMatch(/source gh-standalone.*skill gh-standalone.*target fixture-agents/);
    expect(fs.realpathSync(targetSlot)).toBe(fs.realpathSync(foreign));
  });

  it("does not block on a manually changed frozen copy or a retained frozen link", async () => {
    const ctx = setup();
    expect((await autoSyncVault(ctx.vaultPath, ctx)).sources.find((source) => source.name === "gh-standalone")?.status).toBe("updated");
    const vaultFile = path.join(ctx.vaultPath, "vault.yml");
    fs.writeFileSync(vaultFile, fs.readFileSync(vaultFile, "utf8").replace("install_after_update: true", "install_after_update: false"));
    const targetSlot = path.join(ctx.target, "gh-standalone");
    const first = await autoSyncVault(ctx.vaultPath, ctx);
    expect(first.sources.find((source) => source.name === "gh-standalone")?.status).toBe("current");
    expect(fs.lstatSync(targetSlot).isSymbolicLink()).toBe(true);

    const master = path.join(ctx.agentsSkillsDir, "gh-standalone");
    fs.rmSync(targetSlot, { recursive: true, force: true });
    fs.cpSync(master, targetSlot, { recursive: true, dereference: true });
    const markerFile = path.join(targetSlot, ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerFile, "utf8")) as Record<string, unknown>;
    marker.target_id = "fixture-agents";
    fs.writeFileSync(markerFile, JSON.stringify(marker, null, 2) + "\n");
    fs.appendFileSync(path.join(targetSlot, "SKILL.md"), "\nFrozen local edit.\n");
    const before = fs.readFileSync(path.join(targetSlot, "SKILL.md"), "utf8");
    const second = await autoSyncVault(ctx.vaultPath, ctx);
    expect(second.sources.find((source) => source.name === "gh-standalone")).toMatchObject({ status: "current" });
    expect(fs.readFileSync(path.join(targetSlot, "SKILL.md"), "utf8")).toBe(before);
    expect(hashDirectory(targetSlot)).not.toBe(marker.hash);
  });

  it.each(["review-before-apply", "frozen"] as const)("does not apply a %s source", async (mode) => {
    const ctx = setup(mode);
    const before = fs.readFileSync(ctx.workingFile, "utf8");
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("skipped");
    expect(fs.readFileSync(ctx.workingFile, "utf8")).toBe(before);
  });

  it("preserves an upstream-removed skill for review", async () => {
    const ctx = setup();
    fs.rmSync(ctx.upstreamSkill, { recursive: true });
    git(ctx.upstream, ["add", "-A"]);
    git(ctx.upstream, ["commit", "-m", "remove skill"]);
    const before = fs.readFileSync(ctx.workingFile, "utf8");
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("skipped");
    expect(fs.readFileSync(ctx.workingFile, "utf8")).toBe(before);
  });

  it("does not expose remote URL query secrets in check errors", async () => {
    const ctx = setup();
    const sourceFile = path.join(ctx.vaultPath, "sources", "gh-standalone.yml");
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, "utf8")
      .replace(/^remote_url: .*$/m, "remote_url: file:///no-such-vaultdesk-remote?token=TOP_SECRET_TEST_VALUE"));
    const report = await autoSyncVault(ctx.vaultPath, ctx);
    expect(report.sources.find((source) => source.name === "gh-standalone")?.status).toBe("error");
    expect(JSON.stringify(report)).not.toContain("TOP_SECRET_TEST_VALUE");
    expect(fs.readFileSync(path.join(ctx.vaultPath, ".vault", "state.json"), "utf8")).not.toContain("TOP_SECRET_TEST_VALUE");
  });

  it("updates known collection skills while leaving new upstream skills pending", async () => {
    const ctx = setup("frozen");
    const sourceFile = path.join(ctx.vaultPath, "sources", "gh-pack.yml");
    const packageRoot = path.join(ctx.vaultPath, "packages", "gh-pack", "skills");
    const upstream = tempDir("auto-collection");
    for (const name of ["gh-pack-alpha", "gh-pack-beta"]) {
      const dest = path.join(upstream, "skills", name);
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(path.join(packageRoot, name, "SKILL.md"), path.join(dest, "SKILL.md"));
    }
    fs.appendFileSync(path.join(upstream, "skills", "gh-pack-alpha", "SKILL.md"), "\nKnown skill update.\n");
    const newcomer = path.join(upstream, "skills", "gh-pack-gamma");
    fs.mkdirSync(newcomer);
    fs.writeFileSync(path.join(newcomer, "SKILL.md"), "---\nname: gh-pack-gamma\ndescription: Third skill\n---\n\n# New skill\n");
    const nested = path.join(upstream, "extra", "nested", "gh-pack-delta");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "SKILL.md"), "---\nname: gh-pack-delta\ndescription: Fourth skill\n---\n\n# New skill\n");
    initGitRepo(upstream);
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, "utf8")
      .replace("ref: main\n", `ref: main\nremote_url: file://${upstream}\n`)
      .replace("update_mode: frozen", "update_mode: auto"));
    git(ctx.vaultPath, ["add", "sources/gh-pack.yml"]);
    git(ctx.vaultPath, ["commit", "-m", "configure collection"]);
    git(ctx.vaultPath, ["push"]);

    const report = await autoSyncVault(ctx.vaultPath, ctx);
    const result = report.sources.find((source) => source.name === "gh-pack");
    expect(result?.status).toBe("updated");
    expect(result?.pendingSkills).toEqual(["extra/nested/gh-pack-delta", "skills/gh-pack-gamma"]);
    expect(fs.readFileSync(path.join(packageRoot, "gh-pack-alpha", "SKILL.md"), "utf8")).toContain("Known skill update.");
    expect(fs.existsSync(path.join(packageRoot, "gh-pack-gamma"))).toBe(false);
    expect(fs.existsSync(path.join(ctx.agentsSkillsDir, "gh-pack-gamma"))).toBe(false);
    expect((await listPendingSkills(ctx.vaultPath, "gh-pack")).map((entry) => entry.sourcePath)).toEqual(["extra/nested/gh-pack-delta", "skills/gh-pack-gamma"]);
    const env = { VAULTDESK_AGENTS_SKILLS_DIR: ctx.agentsSkillsDir, VAULTDESK_BACKUP_DIR: ctx.backupRoot };
    const pending = runCli(ctx.vaultPath, ["source", "pending", "gh-pack"], env);
    expect(pending.status).toBe(0);
    expect((pending.data.data as Array<{ sourcePath: string }>).map((entry) => entry.sourcePath)).toEqual(["extra/nested/gh-pack-delta", "skills/gh-pack-gamma"]);
    const adoption = runCli(ctx.vaultPath, ["source", "adopt", "gh-pack", "--path", "skills/gh-pack-gamma", "--yes"], env);
    expect(adoption.status).toBe(0);
    const adopted = adoption.data.data as { status: string; pendingSkills: string[] };
    expect(adopted.status).toBe("updated");
    expect(adopted.pendingSkills).toEqual(["extra/nested/gh-pack-delta"]);
    expect(fs.existsSync(path.join(packageRoot, "gh-pack-gamma", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(ctx.agentsSkillsDir, "gh-pack-gamma", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, "gh-pack-delta"))).toBe(false);
    expect(git(ctx.vaultPath, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("pauses an entire plugin update when it introduces an unadopted skill", async () => {
    const base = tempDir("auto-plugin");
    const vaultPath = path.join(base, "vault");
    const upstream = path.join(base, "upstream");
    const remote = path.join(base, "remote.git");
    await initVault(vaultPath, { name: "plugin-test" });
    initGitRepo(vaultPath);
    fs.mkdirSync(path.join(upstream, "skills", "helper"), { recursive: true });
    fs.writeFileSync(path.join(upstream, "plugin.json"), JSON.stringify({ name: "pending-kit", version: "1.0.0" }));
    const firstSkill = "---\nname: helper\ndescription: Helper\n---\n\n# Existing helper\n";
    fs.writeFileSync(path.join(upstream, "skills", "helper", "SKILL.md"), firstSkill);
    initGitRepo(upstream);
    await addGithubPlugin(vaultPath, { repo: "fixture/pending-kit", remoteUrl: `file://${upstream}`, ref: "main" });
    git(vaultPath, ["add", "."]);
    git(vaultPath, ["commit", "-m", "register plugin"]);
    fs.mkdirSync(remote);
    git(remote, ["init", "--bare", "-b", "main"]);
    git(vaultPath, ["remote", "add", "origin", remote]);
    git(vaultPath, ["push", "-u", "origin", "main"]);
    const beforeHead = git(vaultPath, ["rev-parse", "HEAD"]).trim();
    const workingSkill = path.join(vaultPath, "plugins", "pending-kit", "skills", "helper", "SKILL.md");
    fs.writeFileSync(path.join(upstream, "skills", "helper", "SKILL.md"), firstSkill.replace("Existing", "Updated"));
    fs.mkdirSync(path.join(upstream, "skills", "second"));
    fs.writeFileSync(path.join(upstream, "skills", "second", "SKILL.md"), "---\nname: second\ndescription: New helper\n---\n\n# New skill\n");
    git(upstream, ["add", "."]);
    git(upstream, ["commit", "-m", "v2"]);

    const report = await autoSyncVault(vaultPath, { agentsSkillsDir: path.join(base, "agents") });
    const result = report.sources.find((source) => source.name === "pending-kit");
    expect(result?.status).toBe("skipped");
    expect(result?.pendingSkills).toEqual(["skills/second"]);
    expect(result?.message).toContain("Entire plugin update paused");
    expect(fs.readFileSync(workingSkill, "utf8")).toBe(firstSkill);
    expect(fs.existsSync(path.join(vaultPath, "plugins", "pending-kit", "skills", "second"))).toBe(false);
    expect(git(vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(beforeHead);
    const adopted = await adoptPendingSkills(vaultPath, "pending-kit", ["skills/second"], { agentsSkillsDir: path.join(base, "agents") });
    expect(adopted.status).toBe("updated");
    expect(fs.readFileSync(workingSkill, "utf8")).toContain("Updated helper");
    expect(fs.existsSync(path.join(vaultPath, "plugins", "pending-kit", "skills", "second", "SKILL.md"))).toBe(true);
  });

  it("supports plugin target registration, first distribution, and safe removal through CLI", () => {
    const vaultPath = copyFixture("v2-plugins");
    const dest = tempDir("cli-plugin-target");
    const env = { VAULTDESK_BACKUP_DIR: tempDir("cli-plugin-backups") };
    const added = runCli(vaultPath, ["plugin", "target", "add", "codex-only", "--id", "cli-plugin", "--dest", dest, "--yes"], env);
    expect(added.status).toBe(0);
    const listed = runCli(vaultPath, ["plugin", "target", "list"], env);
    expect((listed.data.data as Array<{ id: string }>).some((entry) => entry.id === "cli-plugin")).toBe(true);
    const distributed = runCli(vaultPath, ["source", "distribute", "codex-only", "--yes"], env);
    expect(distributed.data.errors).toEqual([]);
    expect(distributed.status).toBe(0);
    expect(fs.existsSync(path.join(dest, "codex-only", ".vaultdesk-plugin-managed"))).toBe(true);
    const removed = runCli(vaultPath, ["plugin", "target", "remove", "cli-plugin", "--yes"], env);
    expect(removed.status).toBe(0);
    expect(fs.existsSync(path.join(dest, "codex-only"))).toBe(true);
  });
});
