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
  it("rejects source and frontmatter names that escape vault paths", async () => {
    const base = tempDir("import-paths");
    const vaultPath = path.join(base, "vault");
    await initVault(vaultPath, { name: "imports" });
    const input = path.join(base, "input");
    writeSkill(input, "safe-skill", "Safe skill");
    await expect(previewImport(input, vaultPath, "../../escaped")).rejects.toMatchObject({ code: "invalid-input" });
    await expect(applyImport(input, vaultPath, { name: "../../escaped" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(fs.existsSync(path.join(base, "escaped"))).toBe(false);

    const unsafe = path.join(base, "unsafe");
    writeSkill(unsafe, "../../escaped", "Unsafe name");
    await expect(previewImport(unsafe, vaultPath)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(applyImport(unsafe, vaultPath)).rejects.toMatchObject({ code: "invalid-input" });
  });

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

  it("does not import generated Python cache files", async () => {
    const vaultPath = path.join(tempDir("import-cache-vault"), "vault");
    await initVault(vaultPath, { name: "imports" });
    const input = path.join(tempDir("import-cache-input"), "cache-skill");
    writeSkill(input, "cache-skill", "Cache skill");
    fs.writeFileSync(path.join(input, "script.py"), "print('ready')\n");
    fs.writeFileSync(path.join(input, "script.pyc"), "compiled");
    fs.mkdirSync(path.join(input, "__pycache__"));
    fs.writeFileSync(path.join(input, "__pycache__", "script.cpython-313.pyc"), "compiled");

    await applyImport(input, vaultPath);
    const imported = path.join(vaultPath, "skills", "cache-skill");
    expect(fs.existsSync(path.join(imported, "script.py"))).toBe(true);
    expect(fs.existsSync(path.join(imported, "script.pyc"))).toBe(false);
    expect(fs.existsSync(path.join(imported, "__pycache__"))).toBe(false);
  });

  it("warns when a suite entrypoint never mentions a member skill", async () => {
    const vaultPath = path.join(tempDir("import-vault"), "vault");
    await initVault(vaultPath, { name: "imports" });
    const suite = path.join(tempDir("import-suite"), "suite");
    writeSkill(path.join(suite, "runner"), "runner", "Entry skill");
    writeSkill(path.join(suite, "helper"), "helper", "Helper skill");
    await applyImport(suite, vaultPath, { name: "ops-suite", kind: "suite", entrypoint: "runner" });

    const before = await validateVault(vaultPath);
    expect(before.warnings.map((issue) => issue.code)).toContain("suite.member-unreferenced");

    fs.appendFileSync(
      path.join(vaultPath, "packages", "ops-suite", "skills", "runner", "SKILL.md"),
      "\n调用 helper 处理细节。\n",
    );
    const after = await validateVault(vaultPath);
    expect(after.warnings.map((issue) => issue.code)).not.toContain("suite.member-unreferenced");
  });
});
