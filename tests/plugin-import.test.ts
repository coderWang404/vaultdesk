import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addGithubPlugin,
  applyPluginImport,
  detectLocalPlugin,
  initVault,
  openVault,
  previewGithubPlugin,
  previewPluginImport,
  validateVault,
} from "@vaultdesk/core";
import { git, initGitRepo, repoRoot, tempDir } from "./helpers.js";

function writePlugin(root: string, manifestPath: string, name: string, version = "1.0.0"): void {
  const manifest = path.join(root, manifestPath);
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ name, version, description: `${name} plugin` }));
  fs.mkdirSync(path.join(root, "skills", "helper"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "helper", "SKILL.md"),
    `---\nname: helper\ndescription: ${name} helper skill\n---\n\n# helper\n`,
  );
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
}

function copyClaudeFixture(destination: string): string {
  fs.cpSync(path.join(repoRoot, "fixtures/v2-plugins/plugins/claude-kit"), destination, { recursive: true });
  return destination;
}

describe("plugin import", () => {
  it("imports a local plugin root and keeps it out of skill installs", async () => {
    const vaultPath = path.join(tempDir("plugin-local"), "vault");
    await initVault(vaultPath, { name: "plugins" });
    const input = copyClaudeFixture(path.join(tempDir("plugin-local-input"), "claude-kit"));

    expect(detectLocalPlugin(input)).toBe(input);
    const preview = await previewPluginImport(input, vaultPath);
    expect(preview).toMatchObject({
      shape: "plugin",
      suggestedName: "claude-kit",
      relativePath: ".",
      hasHooks: true,
      conflicts: [],
    });
    expect(preview.skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(preview.manifests[0]?.agent).toBe("claude");

    const result = await applyPluginImport(input, vaultPath);
    expect(result).toMatchObject({ sourceName: "claude-kit", shape: "plugin", skillNames: ["review"] });

    const snapshot = await openVault(vaultPath);
    expect(snapshot.counts).toMatchObject({ sources: 1, skills: 0, plugins: 1, pluginSkills: 1 });
    expect(snapshot.sources[0]).toMatchObject({ name: "claude-kit", shape: "plugin", origin: "local", skills: [] });
    expect(snapshot.plugins[0]?.workingPath).toBe(path.join(fs.realpathSync(vaultPath), "plugins", "claude-kit"));
    expect(fs.existsSync(path.join(vaultPath, "plugins", "claude-kit", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "plugins", "claude-kit", "hooks", "on-start.sh.ran"))).toBe(false);
    expect(snapshot.locked?.sources["claude-kit"]).toBeUndefined();
    expect(fs.existsSync(path.join(vaultPath, "build", "skills", "review"))).toBe(false);
    expect((await validateVault(vaultPath)).ok).toBe(true);

    await expect(applyPluginImport(input, vaultPath)).rejects.toMatchObject({ code: "path-conflict" });
  });

  it("previews GitHub plugin imports from a local mirror and records the lock", async () => {
    const vaultPath = path.join(tempDir("plugin-github"), "vault");
    await initVault(vaultPath, { name: "plugins" });
    const repoDir = path.join(tempDir("plugin-github-repo"), "upstream");
    writePlugin(repoDir, "plugin.json", "mirror-kit");
    initGitRepo(repoDir);
    const commit = git(repoDir, ["rev-parse", "HEAD"]).trim();

    const preview = await previewGithubPlugin(vaultPath, {
      repo: "fixture/mirror-kit",
      remoteUrl: `file://${repoDir}`,
      ref: "main",
    });
    expect(preview).toMatchObject({ shape: "plugin", suggestedName: "mirror-kit", relativePath: ".", repo: "fixture/mirror-kit" });
    expect(preview.commit).toBe(commit);
    expect(preview.skills.map((skill) => skill.name)).toEqual(["helper"]);

    const result = await addGithubPlugin(vaultPath, {
      repo: "fixture/mirror-kit",
      remoteUrl: `file://${repoDir}`,
      ref: "main",
    });
    expect(result).toMatchObject({ sourceName: "mirror-kit", shape: "plugin", commit });

    const snapshot = await openVault(vaultPath);
    const plugin = snapshot.plugins[0];
    expect(plugin).toMatchObject({ name: "mirror-kit", origin: "github", repo: "fixture/mirror-kit", status: "unknown" });
    expect(plugin?.locked?.commit).toBe(commit);
    expect(plugin?.locked?.hash).toMatch(/^sha256:/);
    expect(Object.keys(plugin?.locked?.skills ?? {})).toEqual(["helper"]);
    expect(fs.existsSync(path.join(vaultPath, "third_party", "mirror-kit", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "plugins", "mirror-kit", "plugin.json"))).toBe(true);
    expect(snapshot.skills).toEqual([]);
    expect((await validateVault(vaultPath)).ok).toBe(true);

    const source = fs.readFileSync(path.join(vaultPath, "sources", "mirror-kit.yml"), "utf8");
    expect(source).toContain("repo: fixture/mirror-kit");
    expect(source).not.toContain("content_path");
  });

  it("requires an explicit path when a repository holds several plugin roots", async () => {
    const vaultPath = path.join(tempDir("plugin-multi"), "vault");
    await initVault(vaultPath, { name: "plugins" });
    const repoDir = path.join(tempDir("plugin-multi-repo"), "upstream");
    writePlugin(path.join(repoDir, "kit-a"), "plugin.json", "kit-a");
    writePlugin(path.join(repoDir, "kit-b"), "plugin.json", "kit-b");
    initGitRepo(repoDir);

    await expect(
      previewGithubPlugin(vaultPath, { repo: "fixture/multi", remoteUrl: `file://${repoDir}`, ref: "main" }),
    ).rejects.toMatchObject({ code: "invalid-input" });

    const preview = await previewGithubPlugin(vaultPath, {
      repo: "fixture/multi",
      remoteUrl: `file://${repoDir}`,
      ref: "main",
      path: "kit-b",
    });
    expect(preview).toMatchObject({ suggestedName: "kit-b", relativePath: "kit-b" });

    const result = await addGithubPlugin(vaultPath, {
      repo: "fixture/multi",
      remoteUrl: `file://${repoDir}`,
      ref: "main",
      path: "kit-b",
    });
    expect(result.sourceName).toBe("kit-b");
    const snapshot = await openVault(vaultPath);
    expect(snapshot.plugins[0]?.contentPath).toBe("kit-b");
    expect(fs.existsSync(path.join(vaultPath, "plugins", "kit-b", "skills", "helper", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "plugins", "kit-a"))).toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, "sources", "kit-b.yml"), "utf8")).toContain("content_path: kit-b");
  });

  it("detects a single nested plugin root without an explicit path", async () => {
    const vaultPath = path.join(tempDir("plugin-nested"), "vault");
    await initVault(vaultPath, { name: "plugins" });
    const repoDir = path.join(tempDir("plugin-nested-repo"), "upstream");
    writePlugin(path.join(repoDir, "packages", "nested-kit"), "plugin.json", "nested-kit");
    initGitRepo(repoDir);

    const preview = await previewGithubPlugin(vaultPath, {
      repo: "fixture/nested",
      remoteUrl: `file://${repoDir}`,
      ref: "main",
    });
    expect(preview.relativePath).toBe("packages/nested-kit");
    expect(preview.warnings.some((warning) => warning.includes("Detected plugin root"))).toBe(true);
  });
});
