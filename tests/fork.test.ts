import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forkSkill, openVault, previewFork, readSkillContent, validateVault, writeSkillContent } from "@vaultdesk/core";
import { copyFixture } from "./helpers.js";

describe("fork and edit", () => {
  it("keeps GitHub skills read-only until forked", async () => {
    const vaultPath = copyFixture("v2-basic");
    const read = await readSkillContent(vaultPath, "gh-standalone");
    expect(read.editable).toBe(false);
    expect(read.reason).toMatch(/read-only/i);

    await expect(writeSkillContent(vaultPath, "gh-standalone", read.content)).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("forks a GitHub standalone into a local source with provenance", async () => {
    const vaultPath = copyFixture("v2-basic");
    const preview = await previewFork(vaultPath, "gh-standalone", "gh-standalone-local");
    expect(preview).toMatchObject({
      skill: "gh-standalone",
      sourceName: "gh-standalone",
      newSourceName: "gh-standalone-local",
      removesFromPackage: false,
    });

    const result = await forkSkill(vaultPath, "gh-standalone", "gh-standalone-local");
    expect(result.newSourceName).toBe("gh-standalone-local");

    const metadata = fs.readFileSync(path.join(vaultPath, "sources", "gh-standalone-local.yml"), "utf8");
    expect(metadata).toContain("origin: local");
    expect(metadata).toContain("repo: example/seed-skills");
    expect(metadata).toContain("3333333333333333333333333333333333333333");
    expect(metadata).toContain("name: gh-standalone-local");

    const original = await readSkillContent(vaultPath, "gh-standalone");
    expect(original.editable).toBe(false);
    const forked = await readSkillContent(vaultPath, "gh-standalone-local");
    expect(forked.editable).toBe(true);
    expect(forked.content).toContain("name: gh-standalone-local");

    const snapshot = await openVault(vaultPath);
    expect(snapshot.skills.map((skill) => skill.name)).toContain("gh-standalone-local");
    expect(snapshot.skills.find((skill) => skill.name === "gh-standalone-local")?.forkedFrom?.commit).toBe(
      "3333333333333333333333333333333333333333",
    );
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("detaches a same-name package skill without disturbing the package", async () => {
    const vaultPath = copyFixture("v2-basic");
    const preview = await previewFork(vaultPath, "gh-pack-alpha");
    expect(preview.removesFromPackage).toBe(true);

    await forkSkill(vaultPath, "gh-pack-alpha");

    const snapshot = await openVault(vaultPath);
    const detached = snapshot.sources.find((source) => source.name === "gh-pack-alpha");
    expect(detached?.origin).toBe("local");
    expect(detached?.shape).toBe("standalone");
    const pack = snapshot.sources.find((source) => source.name === "gh-pack");
    expect(pack?.skills.map((skill) => skill.name)).toEqual(["gh-pack-beta"]);
    expect(fs.existsSync(path.join(vaultPath, "packages", "gh-pack", "skills", "gh-pack-alpha"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "third_party", "gh-pack", "gh-pack-alpha"))).toBe(false);
    expect(snapshot.skills.map((skill) => skill.name).sort()).toEqual([
      "gh-pack-alpha",
      "gh-pack-beta",
      "gh-standalone",
      "local-notes",
    ]);
    expect((await validateVault(vaultPath)).ok).toBe(true);
  });

  it("rejects forking a local skill and editing invalid frontmatter", async () => {
    const vaultPath = copyFixture("v2-basic");
    await expect(previewFork(vaultPath, "local-notes")).rejects.toMatchObject({ code: "unsupported" });

    await expect(
      writeSkillContent(vaultPath, "local-notes", "---\nname: other\ndescription: x\n---\n"),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      writeSkillContent(vaultPath, "local-notes", "---\nname: local-notes\ndescription: \n---\n"),
    ).rejects.toMatchObject({ code: "invalid-input" });

    const written = await writeSkillContent(
      vaultPath,
      "local-notes",
      "---\nname: local-notes\ndescription: Updated notes.\n---\n\nBody\n",
    );
    expect(written.bytes).toBeGreaterThan(0);
    expect((await readSkillContent(vaultPath, "local-notes")).content).toContain("Updated notes.");
  });
});
