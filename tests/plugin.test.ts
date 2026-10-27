import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openVault, searchVaults, validateVault } from "@vaultdesk/core";
import { copyFixture, tempDir } from "./helpers.js";

describe("plugin registry", () => {
  it("loads plugin sources without exposing them as installable skills", async () => {
    const vaultPath = copyFixture("v2-plugins");
    const snapshot = await openVault(vaultPath);

    expect(snapshot.counts).toMatchObject({
      sources: 6,
      skills: 1,
      plugins: 5,
      pluginSkills: 3,
    });
    expect(snapshot.skills.map((skill) => skill.name)).toEqual(["plain-skill"]);

    const claude = snapshot.plugins.find((plugin) => plugin.name === "claude-kit");
    expect(claude).toMatchObject({
      origin: "github",
      repo: "example/claude-kit",
      license: "MIT",
      hasHooks: true,
      status: "unknown",
    });
    expect(claude?.manifests.map((manifest) => manifest.agent)).toEqual(["claude"]);
    expect(claude?.skills.map((skill) => skill.name)).toEqual(["review"]);
    expect(claude?.skills[0]?.shape).toBe("plugin-skill");
    expect(claude?.locked?.commit).toBe("4444444444444444444444444444444444444444");
    expect(claude?.skills[0]?.lockedHash).toBe(
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    );
    expect(claude?.assets.some((asset) => asset.kind === "commands")).toBe(true);
    expect(fs.existsSync(path.join(claude?.workingPath ?? "", "hooks/on-start.sh.ran"))).toBe(false);

    const qoder = snapshot.plugins.find((plugin) => plugin.name === "qoder-scan");
    expect(qoder?.manifests.map((manifest) => manifest.agent)).toEqual(["qoder"]);
    expect(qoder?.assets.some((asset) => asset.kind === "hooks")).toBe(true);

    const codex = snapshot.plugins.find((plugin) => plugin.name === "codex-only");
    expect(codex?.skills).toEqual([]);
    expect(codex?.manifests[0]?.agent).toBe("codex");
  });

  it("validates plugin sources and surfaces risk as warnings", async () => {
    const vaultPath = copyFixture("v2-plugins");
    const report = await validateVault(vaultPath);

    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    const codes = new Set(report.warnings.map((warning) => warning.code));
    expect(codes).toContain("plugin.hooks");
    expect(codes).toContain("plugin.executable-assets");
    expect(codes).toContain("plugin.license-missing");
    expect(codes).toContain("plugin.manifest-name-conflict");
    expect(codes).toContain("plugin.manifest-version-conflict");
    expect(fs.existsSync(path.join(vaultPath, "plugins/claude-kit/hooks/on-start.sh.ran"))).toBe(false);
  });

  it("refuses install targets that point at plugin content", async () => {
    const vaultPath = copyFixture("v2-plugins");
    const vaultFile = path.join(vaultPath, "vault.yml");
    const original = fs.readFileSync(vaultFile, "utf8");

    fs.writeFileSync(vaultFile, original.replace("names: [plain-skill]", "names: [claude-kit]"));
    const sourceReport = await validateVault(vaultPath);
    expect(sourceReport.errors.some((error) => error.code === "target.plugin-not-installable")).toBe(true);

    fs.writeFileSync(vaultFile, original.replace("names: [plain-skill]", "names: [review]"));
    const skillReport = await validateVault(vaultPath);
    expect(skillReport.errors.some((error) => error.code === "target.plugin-not-installable")).toBe(true);
  });

  it("searches plugin names, manifest fields, assets, and contained skills", async () => {
    const vaultPath = copyFixture("v2-plugins");
    const vaults = [{ path: vaultPath }];

    const byAgent = await searchVaults({ query: "codex", vaults });
    expect(byAgent.hits.some((hit) => hit.shape === "plugin" && hit.skill === "codex-only")).toBe(true);
    expect(byAgent.hits.some((hit) => hit.shape === "plugin" && hit.skill === "multi-manifest")).toBe(true);

    const bySkill = await searchVaults({ query: "security", vaults });
    const contained = bySkill.hits.find((hit) => hit.shape === "plugin-skill" && hit.skill === "security-scan");
    expect(contained?.pluginName).toBe("qoder-scan");
    expect(contained?.sourceName).toBe("qoder-scan");
    expect(bySkill.hits.some((hit) => hit.shape === "plugin" && hit.skill === "qoder-scan")).toBe(true);
    expect(bySkill.hits.every((hit) => hit.shape === "plugin" || hit.shape === "plugin-skill")).toBe(true);

    const byAsset = await searchVaults({ query: "hooks", vaults });
    const hooked = byAsset.hits.filter((hit) => hit.shape === "plugin").map((hit) => hit.skill);
    expect(hooked).toEqual(expect.arrayContaining(["claude-kit", "qoder-scan"]));

    const installable = await searchVaults({ query: "plain", vaults });
    expect(installable.hits.map((hit) => hit.skill)).toContain("plain-skill");
    expect(installable.hits.every((hit) => hit.shape !== "plugin" && hit.shape !== "plugin-skill")).toBe(true);
  });

  it("skips plugin skill symlinks that escape the plugin root", async () => {
    const vaultPath = copyFixture("v2-plugins");
    const outside = tempDir("plugin-outside");
    const escapeDir = path.join(outside, "escape");
    fs.mkdirSync(escapeDir, { recursive: true });
    fs.writeFileSync(
      path.join(escapeDir, "SKILL.md"),
      "---\nname: escape\ndescription: Escaped skill\n---\n",
    );
    fs.symlinkSync(escapeDir, path.join(vaultPath, "plugins/local-tools/skills/escape"), "dir");

    const snapshot = await openVault(vaultPath);
    const local = snapshot.plugins.find((plugin) => plugin.name === "local-tools");
    expect(local?.skills.map((skill) => skill.name)).not.toContain("escape");
    expect(snapshot.warnings.some((warning) => warning.includes("escapes the plugin root"))).toBe(true);
  });
});
