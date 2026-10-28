import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VaultDeskError,
  adoptExternalSkill,
  buildVault,
  hashDirectory,
  openVault,
  previewAdoptExternal,
  searchVaults,
  validateVault,
  writeExternalSkillCard,
} from "@vaultdesk/core";
import { copyFixture, repoRoot, tempDir } from "./helpers.js";

function writeSkill(dir: string, name: string, description: string, body = "External test skill."): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`,
    "utf8",
  );
}

function externalDir(name: string): string {
  return path.join(tempDir("external"), name);
}

function cardFor(name: string, skillPath: string, extra: Record<string, unknown> = {}) {
  return {
    schema: 1,
    name,
    owner: "demo-tool",
    path: skillPath,
    ...extra,
  };
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  json?: {
    schema: number;
    command: string;
    data: unknown;
    warnings: string[];
    errors: { code: string; message: string }[];
  };
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "packages/cli/dist/index.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  let json: CliResult["json"];
  try {
    json = JSON.parse(result.stdout) as CliResult["json"];
  } catch {
    json = undefined;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

describe("external skill records", () => {
  it("observes a tool-managed path without touching it", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("demo-skill");
    writeSkill(skillPath, "demo-skill", "Demo external skill.");
    const before = hashDirectory(skillPath);

    const record = writeExternalSkillCard(
      vaultPath,
      cardFor("demo-skill", skillPath, { expected_hash: before, related_tool: "demo-tool" }),
    );
    expect(record.relativePath).toBe("external-skills/demo-skill.yml");

    const snapshot = await openVault(vaultPath);
    expect(snapshot.counts.externalSkills).toBe(1);
    expect(snapshot.skills.some((skill) => skill.name === "demo-skill")).toBe(false);
    expect(snapshot.externalSkills[0]).toMatchObject({
      name: "demo-skill",
      owner: "demo-tool",
      skillPath,
      expectedHash: before,
      observedHash: before,
      hashMatches: true,
      markerPresent: false,
      status: "ok",
    });
    expect(hashDirectory(skillPath)).toBe(before);

    const built = await buildVault(vaultPath);
    const artifact = JSON.parse(fs.readFileSync(path.join(vaultPath, "build", "external-skills.json"), "utf8"));
    expect(built.externalSkills).toEqual(["demo-skill"]);
    expect(artifact.skills[0]).toMatchObject({
      name: "demo-skill",
      owner: "demo-tool",
      path: skillPath,
      status: "ok",
      observed_hash: before,
    });
  });

  it("reports drift, missing paths, and stale vault markers", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("demo-skill");
    writeSkill(skillPath, "demo-skill", "Demo external skill.");
    writeExternalSkillCard(vaultPath, cardFor("demo-skill", skillPath, { expected_hash: hashDirectory(skillPath) }));

    fs.appendFileSync(path.join(skillPath, "SKILL.md"), "\nChanged by the tool.\n", "utf8");
    let snapshot = await openVault(vaultPath);
    expect(snapshot.externalSkills[0]?.status).toBe("drift");
    let report = await validateVault(vaultPath);
    expect(report.ok).toBe(true);
    expect(report.warnings.some((issue) => issue.code === "external.hash-drift")).toBe(true);

    fs.writeFileSync(
      path.join(skillPath, ".vault-managed"),
      JSON.stringify({ vault: vaultPath }),
      "utf8",
    );
    snapshot = await openVault(vaultPath);
    expect(snapshot.externalSkills[0]?.status).toBe("conflict");
    expect(snapshot.externalSkills[0]?.markerPresent).toBe(true);
    report = await validateVault(vaultPath);
    expect(report.warnings.some((issue) => issue.code === "external.vault-marker")).toBe(true);

    fs.rmSync(skillPath, { recursive: true, force: true });
    snapshot = await openVault(vaultPath);
    expect(snapshot.externalSkills[0]?.status).toBe("missing");
    report = await validateVault(vaultPath);
    expect(report.warnings.some((issue) => issue.code === "external.path-missing")).toBe(true);
  });

  it("rejects vault-internal paths, name collisions, and target references", async () => {
    const vaultPath = copyFixture("v2-basic");
    writeExternalSkillCard(vaultPath, cardFor("inside-skill", path.join(vaultPath, "skills", "inside-skill")));
    writeSkill(path.join(vaultPath, "skills", "inside-skill"), "inside-skill", "Wrong owner.");
    writeExternalSkillCard(vaultPath, cardFor("local-notes", externalDir("local-notes")));

    const vaultFile = path.join(vaultPath, "vault.yml");
    fs.writeFileSync(
      vaultFile,
      fs.readFileSync(vaultFile, "utf8").replace("      - local-notes\n", "      - local-notes\n      - inside-skill\n"),
      "utf8",
    );

    const report = await validateVault(vaultPath);
    expect(report.ok).toBe(false);
    const codes = report.errors.map((issue) => issue.code);
    expect(codes).toContain("external.path-inside-vault");
    expect(codes).toContain("name.duplicate");
    expect(codes).toContain("target.external-not-installable");
  });

  it("indexes external skills in search", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("demo-skill");
    writeSkill(skillPath, "demo-skill", "A tool-managed search fixture.");
    writeExternalSkillCard(vaultPath, cardFor("demo-skill", skillPath));

    const report = await searchVaults({
      vaults: [{ path: vaultPath, label: "v2-basic" }],
      query: "demo-skill",
    });
    const hit = report.hits.find((entry) => entry.skill === "demo-skill");
    expect(hit).toMatchObject({
      shape: "external-skill",
      origin: "external",
      sourceName: "demo-tool",
      installedTargets: [],
    });
  });

  it("adopts a standalone managed skill and leaves the external path untouched", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("local-notes");
    writeSkill(skillPath, "local-notes", "External copy owned by the tool.");
    const before = hashDirectory(skillPath);

    const preview = await previewAdoptExternal(vaultPath, "local-notes", {
      owner: "demo-tool",
      path: skillPath,
      pin: true,
    });
    expect(preview.targetIds).toEqual(["fixture-agents"]);
    expect(preview.contentPath).toBe(path.join(fs.realpathSync(vaultPath), "skills", "local-notes"));
    expect(preview.relatedTool).toBeUndefined();
    expect(preview.expectedHash).toBe(before);

    const result = await adoptExternalSkill(vaultPath, "local-notes", {
      owner: "demo-tool",
      path: skillPath,
      pin: true,
      relatedTool: "kit-cli",
    });
    expect(result.cardPath).toBe(
      path.join(fs.realpathSync(vaultPath), "external-skills", "local-notes.yml"),
    );

    const snapshot = await openVault(vaultPath);
    expect(snapshot.skills.some((skill) => skill.name === "local-notes")).toBe(false);
    expect(snapshot.sources.some((source) => source.name === "local-notes")).toBe(false);
    expect(snapshot.targets[0]?.names).not.toContain("local-notes");
    expect(snapshot.externalSkills[0]).toMatchObject({
      name: "local-notes",
      owner: "demo-tool",
      relatedTool: "kit-cli",
      status: "ok",
      expectedHash: before,
    });
    expect(fs.existsSync(path.join(vaultPath, "skills", "local-notes"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "sources", "local-notes.yml"))).toBe(false);
    expect(hashDirectory(skillPath)).toBe(before);
    expect(fs.existsSync(path.join(vaultPath, "build", "external-skills.json"))).toBe(true);

    const report = await validateVault(vaultPath);
    expect(report.errors).toEqual([]);
  });

  it("refuses adoption when another vault owns the path", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("local-notes");
    writeSkill(skillPath, "local-notes", "External copy owned by another vault.");
    fs.writeFileSync(
      path.join(skillPath, ".vault-managed"),
      JSON.stringify({ vault: "/Users/someone/OtherVault" }),
      "utf8",
    );

    await expect(
      previewAdoptExternal(vaultPath, "local-notes", { owner: "demo-tool", path: skillPath }),
    ).rejects.toMatchObject({ code: "path-conflict" });
    const snapshot = await openVault(vaultPath);
    expect(snapshot.skills.some((skill) => skill.name === "local-notes")).toBe(true);
    expect(snapshot.externalSkills).toEqual([]);
  });
});

describe("external CLI", () => {
  it("previews, writes, lists, shows, and removes a record without touching the path", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("cli-skill");
    writeSkill(skillPath, "cli-skill", "CLI external skill.");
    const before = hashDirectory(skillPath);

    const preview = runCli([
      "external",
      "add",
      "cli-skill",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      skillPath,
      "--pin",
      "--json",
    ]);
    expect(preview.status).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "external-skills", "cli-skill.yml"))).toBe(false);

    const added = runCli([
      "external",
      "add",
      "cli-skill",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      skillPath,
      "--pin",
      "--yes",
      "--json",
    ]);
    expect(added.status).toBe(0);
    expect(added.json?.data).toMatchObject({ name: "cli-skill", owner: "demo-tool", status: "ok" });

    const listed = runCli(["external", "list", "--vault", vaultPath, "--json"]);
    expect(listed.status).toBe(0);
    expect((listed.json?.data as { name: string }[]).map((entry) => entry.name)).toEqual(["cli-skill"]);

    const shown = runCli(["external", "show", "cli-skill", "--vault", vaultPath, "--json"]);
    expect(shown.status).toBe(0);
    expect(shown.json?.data).toMatchObject({ name: "cli-skill", hashMatches: true });

    const removePreview = runCli(["external", "remove", "cli-skill", "--vault", vaultPath, "--json"]);
    expect(removePreview.status).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "external-skills", "cli-skill.yml"))).toBe(true);

    const removed = runCli(["external", "remove", "cli-skill", "--vault", vaultPath, "--yes", "--json"]);
    expect(removed.status).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "external-skills", "cli-skill.yml"))).toBe(false);
    expect(hashDirectory(skillPath)).toBe(before);
  });

  it("adopts through the CLI and reports unknown records", async () => {
    const vaultPath = copyFixture("v2-basic");
    const skillPath = externalDir("local-notes");
    writeSkill(skillPath, "local-notes", "CLI adoption fixture.");

    const before = runCli([
      "external",
      "adopt",
      "local-notes",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      skillPath,
      "--json",
    ]);
    expect(before.status).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "sources", "local-notes.yml"))).toBe(true);

    const applied = runCli([
      "external",
      "adopt",
      "local-notes",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      skillPath,
      "--pin",
      "--yes",
      "--json",
    ]);
    expect(applied.status).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "external-skills", "local-notes.yml"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "sources", "local-notes.yml"))).toBe(false);

    const missing = runCli(["external", "show", "no-such-skill", "--vault", vaultPath, "--json"]);
    expect(missing.status).toBe(2);
    expect(missing.json?.errors[0]?.code).toBe("unknown-external");
  });

  it("rejects a path inside the vault and a managed name for add", async () => {
    const vaultPath = copyFixture("v2-basic");
    const inside = runCli([
      "external",
      "add",
      "inside-skill",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      path.join(vaultPath, "skills", "inside-skill"),
      "--yes",
      "--json",
    ]);
    expect(inside.status).toBe(2);
    expect(inside.json?.errors[0]?.code).toBe("invalid-input");

    const managed = runCli([
      "external",
      "add",
      "local-notes",
      "--vault",
      vaultPath,
      "--owner",
      "demo-tool",
      "--path",
      externalDir("local-notes"),
      "--yes",
      "--json",
    ]);
    expect(managed.status).toBe(1);
    expect(managed.json?.errors[0]?.code).toBe("path-conflict");
  });
});
