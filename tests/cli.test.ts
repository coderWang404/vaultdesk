import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixture, repoRoot, snapshotTree, tempDir } from "./helpers.js";

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

describe("CLI contract", () => {
  it("prints one JSON envelope and leaves a read-only vault unchanged", () => {
    const vaultPath = copyFixture("v1-basic");
    const before = snapshotTree(vaultPath);
    const status = runCli(["--json", "--vault", vaultPath, "vault", "status"]);

    expect(status.status).toBe(0);
    expect(status.stderr).toBe("");
    expect(status.json).toMatchObject({ schema: 1, command: "vault.status", errors: [] });
    expect((status.json?.data as { format: string }).format).toBe("v1");
    expect((status.json?.data as { counts: { skills: number } }).counts.skills).toBe(6);
    expect(snapshotTree(vaultPath)).toEqual(before);

    const validation = runCli(["--json", "--vault", vaultPath, "vault", "validate"]);
    expect(validation.status).toBe(0);
    expect((validation.json?.data as { ok: boolean }).ok).toBe(true);
    expect(snapshotTree(vaultPath)).toEqual(before);
  });

  it("previews write commands without --yes and applies with it", () => {
    const vaultPath = copyFixture("v2-basic");
    const dest = path.join(tempDir("cli-dest"), "agents");
    const backupRoot = tempDir("cli-backups");

    const preview = runCli(["--json", "--vault", vaultPath, "target", "install", "local-notes", "--dest", dest, "--id", "cli-target"]);
    expect(preview.status).toBe(0);
    expect(preview.json?.data).toMatchObject({ installed: 0 });
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "build"))).toBe(false);

    const applied = runCli([
      "--json",
      "--vault",
      vaultPath,
      "target",
      "install",
      "local-notes",
      "--dest",
      dest,
      "--id",
      "cli-target",
      "--yes",
    ]);
    expect(applied.status).toBe(0);
    expect(applied.json?.data).toMatchObject({ installed: 1 });
    expect(fs.existsSync(path.join(dest, "local-notes", "SKILL.md"))).toBe(true);

    const verify = runCli(["--json", "--vault", vaultPath, "target", "verify", "cli-target"]);
    expect(verify.status).toBe(0);
    expect(verify.json?.data).toMatchObject({ filesInPlace: true, missing: [], modified: [] });

    const previewBuild = runCli(["--json", "--vault", vaultPath, "build"]);
    expect(previewBuild.json?.data).toMatchObject({ preview: true });
    expect(fs.existsSync(path.join(vaultPath, "build", "skills"))).toBe(true);
  });

  it("uses stable exit codes and error envelopes", () => {
    const vaultPath = copyFixture("v1-basic");

    const usage = runCli(["--json", "--vault", vaultPath, "vault", "nonsense"]);
    expect(usage.status).toBe(2);
    expect(usage.json?.errors[0]?.code).toBe("invalid-input");
    expect(usage.json?.data).toBeNull();

    const missingVault = runCli(["--json", "--vault", path.join(vaultPath, "nope"), "vault", "status"]);
    expect(missingVault.status).toBe(2);
    expect(missingVault.json?.errors[0]?.code).toBe("vault-not-found");

    const missingDest = runCli(["--json", "--vault", vaultPath, "target", "install", "local-notes"]);
    expect(missingDest.status).toBe(2);
    expect(missingDest.json?.errors[0]?.code).toBe("invalid-input");

    const legacy = runCli(["--json", "--vault", vaultPath, "target", "install", "local-notes", "--dest", "/tmp/x"]);
    expect(legacy.status).toBe(1);
    expect(legacy.json?.errors[0]?.code).toBe("not-writable-v1");
  });

  it("lists and shows plugins, and refuses to install plugin content", () => {
    const vaultPath = copyFixture("v2-plugins");

    const list = runCli(["--json", "--vault", vaultPath, "plugin", "list"]);
    expect(list.status).toBe(0);
    const plugins = list.json?.data as { name: string; skills: { name: string }[] }[];
    expect(plugins).toHaveLength(5);
    expect(plugins.find((plugin) => plugin.name === "claude-kit")?.skills.map((skill) => skill.name)).toEqual(["review"]);

    const show = runCli(["--json", "--vault", vaultPath, "plugin", "show", "review"]);
    expect(show.status).toBe(0);
    expect(show.json?.data).toMatchObject({ name: "claude-kit", hasHooks: true });

    const human = runCli(["--vault", vaultPath, "plugin", "show", "claude-kit"]);
    expect(human.stdout).toContain("Hooks are present");
    expect(human.stdout).toContain("Contained skills");

    const unknown = runCli(["--json", "--vault", vaultPath, "plugin", "show", "nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.json?.errors[0]?.code).toBe("unknown-plugin");

    const dest = path.join(tempDir("cli-plugin-dest"), "agents");
    const byPlugin = runCli(["--json", "--yes", "--vault", vaultPath, "target", "install", "claude-kit", "--dest", dest]);
    expect(byPlugin.status).toBe(2);
    expect(byPlugin.json?.errors[0]?.code).toBe("plugin-not-installable");
    expect(fs.existsSync(dest)).toBe(false);

    const bySkill = runCli(["--json", "--yes", "--vault", vaultPath, "target", "install", "review", "--dest", dest]);
    expect(bySkill.status).toBe(2);
    expect(bySkill.json?.errors[0]?.code).toBe("plugin-not-installable");
  });

  it("imports a local plugin through source add with preview and --yes", () => {
    const vaultPath = copyFixture("v2-plugins");
    const input = path.join(tempDir("cli-plugin-input"), "cli-kit");
    fs.mkdirSync(path.join(input, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(input, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cli-kit", version: "2.0.0" }),
    );
    fs.mkdirSync(path.join(input, "skills", "helper"), { recursive: true });
    fs.writeFileSync(
      path.join(input, "skills", "helper", "SKILL.md"),
      "---\nname: helper\ndescription: CLI helper\n---\n\n# helper\n",
    );

    const preview = runCli(["--json", "--vault", vaultPath, "source", "add", input]);
    expect(preview.status).toBe(0);
    expect(preview.json?.data).toMatchObject({ shape: "plugin", suggestedName: "cli-kit", conflicts: [] });
    expect(fs.existsSync(path.join(vaultPath, "plugins", "cli-kit"))).toBe(false);

    const applied = runCli(["--json", "--yes", "--vault", vaultPath, "source", "add", input, "--name", "cli-kit"]);
    expect(applied.status).toBe(0);
    expect(applied.json?.data).toMatchObject({ sourceName: "cli-kit", shape: "plugin" });
    expect(fs.existsSync(path.join(vaultPath, "plugins", "cli-kit", ".claude-plugin", "plugin.json"))).toBe(true);

    const status = runCli(["--json", "--vault", vaultPath, "vault", "status"]);
    expect((status.json?.data as { counts: { plugins: number; pluginSkills: number } }).counts).toMatchObject({
      plugins: 6,
      pluginSkills: 4,
    });

    const conflict = runCli(["--json", "--yes", "--vault", vaultPath, "source", "add", input, "--name", "cli-kit"]);
    expect(conflict.status).toBe(1);
    expect(conflict.json?.errors[0]?.code).toBe("path-conflict");

    const badFlags = runCli(["--json", "--vault", vaultPath, "source", "add", input, "--kind", "suite"]);
    expect(badFlags.status).toBe(2);
    expect(badFlags.json?.errors[0]?.code).toBe("invalid-input");
  });
});
