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
});
