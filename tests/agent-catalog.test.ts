import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  beginManagedDistribution,
  buildAgentCatalog,
  canonicalPath,
  listRegisteredVaults,
  openVault,
  registerPluginTarget,
  writeExternalSkillCard,
} from "@vaultdesk/core";
import { copyFixture, tempDir } from "./helpers.js";

describe("agent catalog", () => {
  it("lists only explicitly registered vaults without scanning", () => {
    const root = tempDir("catalog-registry");
    const settings = path.join(root, "settings.json");
    const valid = copyFixture("v2-basic");
    const missing = path.join(root, "missing-vault");
    fs.writeFileSync(settings, "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "recent-vaults.json"), JSON.stringify({
      vaults: [
        { path: valid, name: "Fixture", openedAt: "2026-01-01T00:00:00.000Z" },
        { path: missing, name: "Missing" },
        { path: valid, name: "Duplicate" },
      ],
    }), "utf8");

    expect(listRegisteredVaults(settings)).toEqual([
      expect.objectContaining({ path: fs.realpathSync(valid), name: "Fixture", format: "v2", status: "ready" }),
      expect.objectContaining({ path: canonicalPath(missing), exists: false, format: null, status: "missing" }),
    ]);

    const inlineSettings = path.join(root, "inline-settings.json");
    fs.writeFileSync(inlineSettings, JSON.stringify({ recentVaults: [{ path: valid, name: "Inline" }] }), "utf8");
    expect(listRegisteredVaults(inlineSettings)[0]).toMatchObject({ path: fs.realpathSync(valid), name: "Inline", status: "ready" });
  });

  it("reports skill distribution from fresh marker and hash checks", async () => {
    const vault = copyFixture("v2-basic");
    const root = tempDir("catalog-skill");
    const master = path.join(root, "agents", "skills");
    const target = path.join(root, "agent", "skills");
    const vaultFile = path.join(vault, "vault.yml");
    fs.writeFileSync(vaultFile, fs.readFileSync(vaultFile, "utf8").replace("~/.vaultdesk-fixtures/v2-agents", target), "utf8");
    const transaction = await beginManagedDistribution(vault, "local-notes", {
      agentsSkillsDir: master,
      backupRoot: path.join(root, "backups"),
    });
    transaction.finalize();

    const catalog = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    const skill = catalog.skills.find((entry) => entry.name === "local-notes");
    expect(skill?.agentLoaded).toBe("unknown");
    expect(skill?.master.status).toBe("current");
    expect(skill?.installedTargets[0]).toMatchObject({ targetId: "fixture-agents", status: "current", hashMatches: true });
    expect(catalog.targets[0]?.files.find((file) => file.skillName === "local-notes")).toMatchObject({ skillName: "local-notes", status: "current" });
    expect(catalog.agent).toEqual({ loaded: "unknown", connected: "unknown" });

    fs.appendFileSync(path.join(vault, "skills", "local-notes", "SKILL.md"), "\nNew source revision.\n");
    const stale = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    expect(stale.skills.find((entry) => entry.name === "local-notes")?.master).toMatchObject({
      status: "outdated", hashMatches: true, sourceMatches: false,
    });
    expect(stale.targets[0]?.files.find((file) => file.skillName === "local-notes")?.status).toBe("outdated");

    const slot = path.join(target, "local-notes");
    const markerPath = path.join(master, "local-notes", ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const aliasSlot = path.join(root, "unregistered-alias");
    fs.symlinkSync(fs.realpathSync(slot), aliasSlot);
    marker.targets[0].path = aliasSlot;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const wrongLink = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    expect(wrongLink.targets[0]?.files.find((file) => file.skillName === "local-notes")?.status).toBe("foreign");
  });

  it("recognizes a target mapped directly to the shared master directory", async () => {
    const vault = copyFixture("v2-basic");
    const root = tempDir("catalog-master-target");
    const master = path.join(root, "agents", "skills");
    const vaultFile = path.join(vault, "vault.yml");
    fs.writeFileSync(vaultFile, fs.readFileSync(vaultFile, "utf8").replace("~/.vaultdesk-fixtures/v2-agents", master), "utf8");
    const transaction = await beginManagedDistribution(vault, "local-notes", {
      agentsSkillsDir: master,
      backupRoot: path.join(root, "backups"),
    });
    transaction.finalize();

    const catalog = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    expect(catalog.skills.find((entry) => entry.name === "local-notes")?.installedTargets[0]).toMatchObject({
      targetId: "fixture-agents",
      status: "current",
      markerPresent: true,
      markerOwnedByVault: true,
      hashMatches: true,
    });
    expect(catalog.targets[0]?.files.find((file) => file.skillName === "local-notes")).toMatchObject({
      status: "current",
      markerOwnedByVault: true,
      hashMatches: true,
    });
    const markerPath = path.join(master, "local-notes", ".vault-managed");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    marker.target_id = "fixture-agents";
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const legacy = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    expect(legacy.skills.find((entry) => entry.name === "local-notes")?.master.status).toBe("current");
    expect(legacy.targets[0]?.files.find((file) => file.skillName === "local-notes")?.status).toBe("current");
    marker.vault = path.join(root, "another-vault");
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const foreign = buildAgentCatalog(await openVault(vault), { agentsSkillsDir: master });
    expect(foreign.skills.find((entry) => entry.name === "local-notes")?.master.status).toBe("foreign");
  });

  it("exposes tool capabilities and plugin target ownership without claiming activation", async () => {
    const vault = copyFixture("v2-plugins");
    const root = tempDir("catalog-plugin");
    const pluginDest = path.join(root, "agent", "plugins");
    fs.writeFileSync(path.join(vault, "tools", "rea.yml"), `
schema: 1
name: rea
kind: plugin
title: REA
summary: Reverse engineering suite
homepage: https://example.com/rea
install:
  - label: Setup
    command: npx rea-agents setup
tags: [mcp, reverse-engineering]
`, "utf8");
    await registerPluginTarget(vault, { id: "agent-plugins", dest: pluginDest, names: ["claude-kit"] });
    const transaction = await beginManagedDistribution(vault, "claude-kit", { backupRoot: path.join(root, "backups") });
    transaction.finalize();

    const catalog = buildAgentCatalog(await openVault(vault));
    expect(catalog.tools.find((tool) => tool.name === "filesystem-mcp")).toMatchObject({
      kind: "mcp",
      capabilities: ["mcp"],
      installState: "unknown",
      connectedState: "unknown",
    });
    expect(catalog.tools.find((tool) => tool.name === "kit-cli")?.capabilities).toEqual(["cli"]);
    expect(catalog.tools.find((tool) => tool.name === "rea")?.capabilities).toEqual(["plugin", "mcp"]);
    expect(catalog.plugins.find((plugin) => plugin.name === "claude-kit")?.targetFiles[0]?.file).toMatchObject({
      markerPresent: true,
      markerOwnedByVault: true,
      status: "current",
    });
    expect(catalog.plugins.find((plugin) => plugin.name === "claude-kit")).toMatchObject({
      containedSkills: ["review"],
      assetKinds: expect.arrayContaining(["commands", "hooks", "skills"]),
    });
    expect(catalog.plugins.find((plugin) => plugin.name === "claude-kit")?.agentLoaded).toBe("unknown");
  });

  it("keeps external skill ownership read-only and reports observed status", async () => {
    const vault = copyFixture("v2-basic");
    const external = path.join(tempDir("catalog-external"), "tool-skill");
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, "SKILL.md"), "---\nname: tool-skill\ndescription: External\n---\n", "utf8");
    writeExternalSkillCard(vault, {
      schema: 1,
      name: "tool-skill",
      owner: "tool-manager",
      path: external,
      related_tool: "rea",
    });
    const catalog = buildAgentCatalog(await openVault(vault));
    expect(catalog.externalSkills[0]).toMatchObject({
      name: "tool-skill",
      owner: "tool-manager",
      relatedTool: "rea",
      status: "observed",
      readOnly: true,
      agentLoaded: "unknown",
    });
  });
});

