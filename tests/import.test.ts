import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyImport, initVault, openVault, previewImport, validateVault } from "@vaultdesk/core";
import { tempDir } from "./helpers.js";

function writeSkill(dir: string, name: string, description: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
}

describe("local import", () => {
  it("detects a multi-skill folder as a collection and imports it", async () => {
    const vaultPath = path.join(tempDir("import-vault"), "vault");
    await initVault(vaultPath, { name: "imports" });
    const input = path.join(tempDir("import-input"), "team-pack");
    writeSkill(path.join(input, "alpha"), "alpha", "Alpha skill");
    writeSkill(path.join(input, "beta"), "beta", "Beta skill");

    const preview = await previewImport(input, vaultPath, "team-pack");
    expect(preview.shape).toBe("package");
    expect(preview.kind).toBe("collection");
    expect(preview.skills.map((skill) => skill.name).sort()).toEqual(["alpha", "beta"]);
    expect(preview.conflicts).toEqual([]);

    const result = await applyImport(input, vaultPath, { name: "team-pack" });
    expect(result).toMatchObject({ sourceName: "team-pack", shape: "package", kind: "collection" });

    const snapshot = await openVault(vaultPath);
    expect(snapshot.sources[0]?.name).toBe("team-pack");
    expect(snapshot.sources[0]?.skills.map((skill) => skill.name).sort()).toEqual(["alpha", "beta"]);
    expect(snapshot.skills.every((skill) => skill.origin === "local")).toBe(true);
    expect((await validateVault(vaultPath)).ok).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "build", "skills", "alpha", "SKILL.md"))).toBe(true);

    await expect(applyImport(input, vaultPath, { name: "team-pack" })).rejects.toMatchObject({
      code: "path-conflict",
    });
  });

  it("imports a single folder as standalone and an explicit suite with an entrypoint", async () => {
    const vaultPath = path.join(tempDir("import-vault"), "vault");
    await initVault(vaultPath, { name: "imports" });
    const single = path.join(tempDir("import-single"), "solo");
    writeSkill(single, "solo", "Solo skill");

    const standalone = await applyImport(single, vaultPath);
    expect(standalone.shape).toBe("standalone");
    expect((await openVault(vaultPath)).sources.find((source) => source.name === "solo")?.shape).toBe("standalone");

    const suite = path.join(tempDir("import-suite"), "suite");
    writeSkill(path.join(suite, "runner"), "runner", "Entry skill");
    writeSkill(path.join(suite, "helper"), "helper", "Helper skill");
    const preview = await previewImport(suite, vaultPath, "ops-suite", { kind: "suite", entrypoint: "runner" });
    expect(preview.entrypoint).toBe("runner");
    const result = await applyImport(suite, vaultPath, { name: "ops-suite", kind: "suite", entrypoint: "runner" });
    expect(result).toMatchObject({ sourceName: "ops-suite", shape: "package", kind: "suite" });

    const snapshot = await openVault(vaultPath);
    const source = snapshot.sources.find((entry) => entry.name === "ops-suite");
    expect(source?.kind).toBe("suite");
    expect(source?.entrypoint).toBe("runner");
    expect((await validateVault(vaultPath)).ok).toBe(true);

    await expect(
      previewImport(suite, vaultPath, "no-entry", { kind: "suite" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});
