import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  beginManagedDistribution,
  buildAgentCatalog,
  forkSkill,
  openVault,
  readVaultFile,
  removeSource,
  validateVault,
  writeVaultFile,
} from "@vaultdesk/core";
import { copyFixture, tempDir } from "./helpers.js";

function sameNamedSource() {
  const vault = copyFixture("v2-basic");
  const root = tempDir("exact-target");
  const sourceFile = path.join(vault, "sources", "gh-pack-alpha.yml");
  const previous = path.join(vault, "sources", "gh-pack.yml");
  fs.writeFileSync(sourceFile, fs.readFileSync(previous, "utf8").replace(/^name: gh-pack$/m, "name: gh-pack-alpha"));
  fs.unlinkSync(previous);
  const lockFile = path.join(vault, "vault.lock");
  fs.writeFileSync(lockFile, fs.readFileSync(lockFile, "utf8").replace(/^  gh-pack:$/m, "  gh-pack-alpha:"));
  const config = readVaultFile(vault);
  config.targets = [
    { id: "exact", dest: path.join(root, "exact"), names: ["gh-pack-alpha"], skills_only: true, install_after_update: true },
    { id: "legacy", dest: path.join(root, "legacy"), names: ["gh-pack-alpha"], install_after_update: true },
  ];
  writeVaultFile(vault, config);
  return { vault, root, sourceFile };
}

describe("exact target skill selection", () => {
  it("keeps exact selectors distinct from legacy whole-source selectors after reload and in the agent catalog", async () => {
    const { vault, root } = sameNamedSource();
    writeVaultFile(vault, readVaultFile(vault));
    const snapshot = await openVault(vault);
    expect(snapshot.targets.find((target) => target.id === "exact")).toMatchObject({
      skillsOnly: true, names: ["gh-pack-alpha"], skills: ["gh-pack-alpha"],
    });
    expect(snapshot.targets.find((target) => target.id === "legacy")?.skills).toEqual(["gh-pack-alpha", "gh-pack-beta"]);
    const catalog = buildAgentCatalog(snapshot, { agentsSkillsDir: path.join(root, "master") });
    expect(catalog.targets.find((target) => target.id === "exact")).toMatchObject({
      skillsOnly: true, selectors: ["gh-pack-alpha"], skillNames: ["gh-pack-alpha"],
    });
    expect(catalog.targets.find((target) => target.id === "legacy")).toMatchObject({
      skillsOnly: false, selectors: ["gh-pack-alpha"], skillNames: ["gh-pack-alpha", "gh-pack-beta"],
    });
    const validation = await validateVault(vault);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((issue) => issue.code === "target.unknown-key")).toBe(false);
  });

  it("rejects a source-only name in an exact target instead of treating it as a collection", async () => {
    const vault = copyFixture("v2-basic");
    const config = readVaultFile(vault);
    config.targets = [{ id: "exact", dest: path.join(tempDir("exact-invalid"), "skills"), names: ["gh-pack"], skills_only: true, install_after_update: true }];
    writeVaultFile(vault, config);
    const snapshot = await openVault(vault);
    expect(snapshot.targets[0]?.skills).toEqual([]);
    const validation = await validateVault(vault);
    expect(validation.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "target.unknown-name" })]));
  });

  it("distributes source updates to the selected skill without adding siblings or newly registered source members", async () => {
    const { vault, root, sourceFile } = sameNamedSource();
    const options = { agentsSkillsDir: path.join(root, "master"), backupRoot: path.join(root, "backups") };
    (await beginManagedDistribution(vault, "gh-pack-alpha", options)).finalize();
    expect(fs.existsSync(path.join(root, "exact", "gh-pack-alpha", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "exact", "gh-pack-beta"))).toBe(false);
    expect(fs.existsSync(path.join(root, "legacy", "gh-pack-beta", "SKILL.md"))).toBe(true);

    fs.appendFileSync(sourceFile, "\n  - name: new-member\n    source_path: skills/new-member\n    vendor_path: third_party/gh-pack/new-member\n");
    const skill = path.join(vault, "packages", "gh-pack", "skills", "new-member");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: new-member\ndescription: Newly accepted collection member.\n---\n\nNew member.\n");
    (await beginManagedDistribution(vault, "gh-pack-alpha", options)).finalize();
    expect(fs.existsSync(path.join(root, "exact", "new-member"))).toBe(false);
    expect(fs.existsSync(path.join(root, "legacy", "new-member", "SKILL.md"))).toBe(true);
    expect((await openVault(vault)).targets.find((target) => target.id === "exact")?.skills).toEqual(["gh-pack-alpha"]);
  });

  it("preserves an exact skill relationship when the skill is detached and its former collection is removed", async () => {
    const vault = copyFixture("v2-basic");
    const config = readVaultFile(vault);
    config.targets = [{ id: "exact", dest: path.join(tempDir("exact-fork"), "skills"), names: ["gh-pack-alpha"], skills_only: true, install_after_update: false }];
    writeVaultFile(vault, config);
    await forkSkill(vault, "gh-pack-alpha");
    await removeSource(vault, "gh-pack", { deleteFiles: true });
    expect((await openVault(vault)).targets.find((target) => target.id === "exact")).toMatchObject({
      names: ["gh-pack-alpha"], skillsOnly: true, skills: ["gh-pack-alpha"], installAfterUpdate: false,
    });
    expect((await validateVault(vault)).ok).toBe(true);
  });
});
