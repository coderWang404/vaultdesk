import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VaultDeskError,
  buildVault,
  openVault,
  parseToolCard,
  searchVaults,
  toolDocument,
  validateVault,
  verifyToolReadiness,
  writeToolCard,
} from "@vaultdesk/core";
import { copyFixture, repoRoot, tempDir } from "./helpers.js";

const baseCard = {
  name: "demo-tool",
  kind: "mcp",
  title: "Demo Tool",
  summary: "A recorded MCP server for tests.",
  homepage: "https://example.com/demo",
  install: [{ label: "Install", command: "npm install --global demo-tool" }],
  tags: ["mcp"],
};

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

describe("tool cards", () => {
  it("writes, lists, and loads a normalized card", async () => {
    const vaultPath = copyFixture("v2-basic");
    const record = writeToolCard(vaultPath, baseCard);

    expect(record).toMatchObject({
      ...baseCard,
      schema: 1,
      requirements: [],
      related_skills: [],
      relativePath: "tools/demo-tool.yml",
    });
    expect(fs.existsSync(path.join(vaultPath, "tools/demo-tool.yml"))).toBe(true);
    const yaml = fs.readFileSync(path.join(vaultPath, "tools/demo-tool.yml"), "utf8");
    expect(yaml).toContain("schema: 1");
    expect(yaml).toContain("homepage: https://example.com/demo");
    expect(yaml).toContain("command: npm install --global demo-tool");

    const snapshot = await openVault(vaultPath);
    expect(snapshot.counts.tools).toBe(1);
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.tools[0]).toMatchObject({ name: "demo-tool", relativePath: "tools/demo-tool.yml" });

    const report = await validateVault(vaultPath);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("refuses to overwrite without force and normalizes key order", () => {
    const vaultPath = copyFixture("v2-basic");
    writeToolCard(vaultPath, baseCard);

    expect(() => writeToolCard(vaultPath, baseCard)).toThrow(VaultDeskError);
    try {
      writeToolCard(vaultPath, baseCard);
    } catch (error) {
      expect((error as VaultDeskError).code).toBe("path-conflict");
    }

    writeToolCard(vaultPath, { ...baseCard, title: "Replaced" }, { force: true });
    const yaml = fs.readFileSync(path.join(vaultPath, "tools/demo-tool.yml"), "utf8");
    expect(yaml).toContain("title: Replaced");
    expect(yaml.indexOf("homepage:")).toBeLessThan(yaml.indexOf("install:"));
  });

  it("rejects invalid cards with field-level details", () => {
    const cases = [
      { ...baseCard, homepage: "ftp://example.com/demo" },
      { ...baseCard, install: [] },
      { ...baseCard, tags: ["MCP"] },
      { ...baseCard, name: "Bad Name" },
    ];
    for (const input of cases) {
      expect(() => parseToolCard(input)).toThrow(VaultDeskError);
    }

    try {
      parseToolCard({ ...baseCard, homepage: "ftp://example.com/demo" });
    } catch (error) {
      expect((error as VaultDeskError).code).toBe("invalid-input");
      expect(Array.isArray((error as VaultDeskError).details)).toBe(true);
    }
  });

  it("surfaces invalid files and unknown related skills through validation", async () => {
    const vaultPath = copyFixture("v2-basic");
    fs.mkdirSync(path.join(vaultPath, "tools"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "tools", "broken.yml"), "schema: [\n", "utf8");
    fs.writeFileSync(
      path.join(vaultPath, "tools", "renamed.yml"),
      [
        "schema: 1",
        "name: other-name",
        "kind: cli",
        "title: Other",
        "summary: Wrong file name.",
        "homepage: https://example.com/other",
        "install:",
        "  - label: Install",
        "    command: echo other",
        "",
      ].join("\n"),
      "utf8",
    );
    writeToolCard(vaultPath, { ...baseCard, related_skills: ["missing-skill"] });

    const snapshot = await openVault(vaultPath);
    expect(snapshot.tools.map((tool) => tool.name)).toEqual(["demo-tool", "other-name"]);
    expect(snapshot.warnings.some((warning) => warning.includes("tools/broken.yml"))).toBe(true);

    const report = await validateVault(vaultPath);
    const codes = [...report.errors, ...report.warnings].map((issue) => issue.code);
    expect(codes).toContain("tool.invalid-yaml");
    expect(codes).toContain("tool.filename-mismatch");
    expect(codes).toContain("tool.related-skill-unknown");
    expect(report.ok).toBe(false);
  });

  it("builds a deterministic tools index", async () => {
    const vaultPath = copyFixture("v2-basic");
    writeToolCard(vaultPath, {
      ...baseCard,
      docs: "https://example.com/demo/docs",
      recorded_version: "2.0.0",
      requirements: ["Node.js 22+"],
      related_skills: ["local-notes"],
    });

    const first = await buildVault(vaultPath);
    expect(first.tools).toEqual(["demo-tool"]);
    const artifactPath = path.join(vaultPath, "build", "tools.json");
    expect(fs.existsSync(artifactPath)).toBe(true);
    const firstText = fs.readFileSync(artifactPath, "utf8");
    const artifact = JSON.parse(firstText) as { schema: number; vault: string; tools: Record<string, unknown>[] };
    expect(artifact.schema).toBe(1);
    expect(artifact.vault).toBe("v2-basic");
    expect(artifact.tools).toEqual([
      toolDocument({
        ...parseToolCard({
          ...baseCard,
          docs: "https://example.com/demo/docs",
          recorded_version: "2.0.0",
          requirements: ["Node.js 22+"],
          related_skills: ["local-notes"],
        }),
      }),
    ]);
    expect(firstText).not.toMatch(/generated|timestamp/i);

    await buildVault(vaultPath);
    expect(fs.readFileSync(artifactPath, "utf8")).toBe(firstText);
  });

  it("finds tool cards in vault search", async () => {
    const vaultPath = copyFixture("v2-basic");
    writeToolCard(vaultPath, {
      ...baseCard,
      tags: ["mcp", "demo"],
      install: [{ label: "Install", command: "npx demo-tool-server" }],
    });

    const byCommand = await searchVaults({ query: "demo-tool-server", vaults: [{ path: vaultPath }] });
    const hit = byCommand.hits.find((entry) => entry.shape === "tool");
    expect(hit).toMatchObject({
      skill: "demo-tool",
      sourceName: "tools",
      origin: "external",
      shape: "tool",
      toolKind: "mcp",
      relativePath: "tools/demo-tool.yml",
      installedTargets: [],
    });

    const byTag = await searchVaults({ query: "demo", vaults: [{ path: vaultPath }] });
    expect(byTag.hits.some((entry) => entry.shape === "tool" && entry.skill === "demo-tool")).toBe(true);
  });
});

describe("tool CLI", () => {
  it("verifies declared checks without running install commands", () => {
    const vaultPath = copyFixture("v2-basic");
    const marker = path.join(tempDir("tool-verify-marker"), "ran");
    const check = JSON.stringify({ id: "git", kind: "executable", label: "Git", name: "git" });
    const added = runCli([
      "--json", "--vault", vaultPath, "tool", "add", "demo-tool",
      "--kind", "cli", "--title", "Demo", "--summary", "Demo tool",
      "--homepage", "https://example.com/demo", "--install-command", "Install=touch " + marker,
      "--check", check, "--yes",
    ]);
    expect(added.status).toBe(0);
    const verified = runCli(["--json", "--vault", vaultPath, "tool", "verify", "demo-tool"]);
    expect(verified.status).toBe(0);
    expect(verified.json?.data).toMatchObject({ name: "demo-tool", status: "ready", checks: [
      { id: "git", status: "ok" },
    ] });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("previews, writes, lists, and shows cards without running commands", () => {
    const vaultPath = copyFixture("v2-basic");
    const marker = path.join(tempDir("tool-marker"), "ran");
    const command = `touch ${marker}`;
    const args = [
      "--json",
      "--vault",
      vaultPath,
      "tool",
      "add",
      "demo-tool",
      "--kind",
      "mcp",
      "--title",
      "Demo Tool",
      "--summary",
      "A recorded MCP server for tests.",
      "--homepage",
      "https://example.com/demo",
      "--install-command",
      `Install=${command}`,
      "--run",
      command,
      "--tag",
      "mcp",
    ];

    const preview = runCli(args);
    expect(preview.status).toBe(0);
    expect(preview.json?.command).toBe("tool.add");
    expect(preview.json?.data).toMatchObject({ name: "demo-tool", preview: true, replaces: false });
    expect(fs.existsSync(path.join(vaultPath, "tools", "demo-tool.yml"))).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);

    const applied = runCli([...args, "--yes"]);
    expect(applied.status).toBe(0);
    expect(applied.json?.data).toMatchObject({ name: "demo-tool", artifact: "build/tools.json" });
    expect(fs.existsSync(path.join(vaultPath, "tools", "demo-tool.yml"))).toBe(true);
    expect(fs.existsSync(path.join(vaultPath, "build", "tools.json"))).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);

    const list = runCli(["--json", "--vault", vaultPath, "tool", "list"]);
    expect(list.status).toBe(0);
    expect((list.json?.data as { name: string }[]).map((tool) => tool.name)).toEqual(["demo-tool"]);

    const mcpOnly = runCli(["--json", "--vault", vaultPath, "tool", "list", "--kind", "mcp"]);
    expect(mcpOnly.status).toBe(0);
    expect((mcpOnly.json?.data as { name: string }[]).map((tool) => tool.name)).toEqual(["demo-tool"]);

    const cliOnly = runCli(["--json", "--vault", vaultPath, "tool", "list", "--kind", "cli"]);
    expect(cliOnly.status).toBe(0);
    expect(cliOnly.json?.data).toEqual([]);

    const badKind = runCli(["--json", "--vault", vaultPath, "tool", "list", "--kind", "server"]);
    expect(badKind.status).toBe(2);
    expect(badKind.json?.errors[0]?.code).toBe("invalid-input");

    const show = runCli(["--json", "--vault", vaultPath, "tool", "show", "demo-tool"]);
    expect(show.status).toBe(0);
    expect(show.json?.data).toMatchObject({ name: "demo-tool", kind: "mcp", run: command });
    const showText = runCli(["--vault", vaultPath, "tool", "show", "demo-tool"]).stdout;
    expect(showText).toContain("Connect");
    expect(showText).toContain("register this MCP server");

    const unknown = runCli(["--json", "--vault", vaultPath, "tool", "show", "missing"]);
    expect(unknown.status).toBe(2);
    expect(unknown.json?.errors[0]?.code).toBe("unknown-tool");
  });

  it("guards duplicates, missing fields, and v1 vaults", () => {
    const vaultPath = copyFixture("v2-basic");
    const base = ["--json", "--vault", vaultPath, "tool", "add", "demo-tool"];
    const required = [
      "--kind",
      "cli",
      "--title",
      "Demo",
      "--summary",
      "Demo card.",
      "--homepage",
      "https://example.com/demo",
      "--install-command",
      "Install=echo demo",
    ];

    const missing = runCli(base);
    expect(missing.status).toBe(2);
    expect(missing.json?.errors[0]?.code).toBe("invalid-input");

    expect(runCli([...base, ...required, "--yes"]).status).toBe(0);
    const duplicate = runCli([...base, ...required, "--yes"]);
    expect(duplicate.status).toBe(1);
    expect(duplicate.json?.errors[0]?.code).toBe("path-conflict");

    const forced = runCli([...base, ...required.slice(0, -1), "Install=echo replaced", "--force", "--yes"]);
    expect(forced.status).toBe(0);
    expect(fs.readFileSync(path.join(vaultPath, "tools", "demo-tool.yml"), "utf8")).toContain("echo replaced");

    const v1 = copyFixture("v1-basic");
    const legacy = runCli(["--json", "--vault", v1, "tool", "add", "demo-tool", ...required, "--yes"]);
    expect(legacy.status).toBe(1);
    expect(legacy.json?.errors[0]?.code).toBe("not-writable-v1");
  });
});

describe("tool readiness", () => {
  it("validates a tool card with declared readiness checks without unknown-key warnings", async () => {
    const vaultPath = copyFixture("v2-basic");
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "git", kind: "executable", label: "Git", name: "git" },
    ] });

    const report = await validateVault(vaultPath);
    expect(report.ok).toBe(true);
    expect(report.warnings.filter((issue) => issue.code === "tool.unknown-key")).toEqual([]);
  });

  it("rejects duplicate readiness check IDs", () => {
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "runtime", kind: "executable", label: "Git", name: "git" },
      { id: "runtime", kind: "env", label: "Token", name: "TOOL_TOKEN" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: Array.from({ length: 65 }, (_, index) => ({
      id: `check-${index}`, kind: "env", label: `Check ${index}`, name: "TOOL_TOKEN",
    })) })).toThrow(VaultDeskError);
  });

  it("does not hash symlinks, including a parent directory outside the vault", async () => {
    const vaultPath = copyFixture("v2-basic");
    const external = tempDir("external-hash-target");
    fs.writeFileSync(path.join(external, "requirements.txt"), "outside\n");
    fs.symlinkSync(external, path.join(vaultPath, "linked-external"));
    fs.symlinkSync(path.join(vaultPath, "README.md"), path.join(vaultPath, "linked-readme"));
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "outside", kind: "file-hash", label: "Outside", path: "linked-external/requirements.txt", expected_hash: "sha256:" + "a".repeat(64) },
      { id: "inside", kind: "file-hash", label: "Inside symlink", path: "linked-readme", expected_hash: "sha256:" + "a".repeat(64) },
    ] });
    const report = await verifyToolReadiness(vaultPath, "demo-tool");
    expect(report.status).toBe("incomplete");
    expect(report.checks.map((check) => check.status)).toEqual(["error", "error"]);
  });

  it.skipIf(path.basename(process.execPath) !== "node")("checks declared Node.js version intervals through a native override", async () => {
    const vaultPath = copyFixture("v2-basic");
    const ranges = [
      { min_version: "22.23.4", max_version_exclusive: "23.0.0" },
      { min_version: "24.22.1", max_version_exclusive: "25.0.0" },
      { min_version: "26.12.1" },
    ];
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "node-runtime", kind: "node", label: "Node.js compatibility", ranges },
    ] });
    const report = await verifyToolReadiness(vaultPath, "demo-tool", { nodePath: process.execPath });
    const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
    const compatible = (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) ||
      (major === 24 && (minor > 22 || (minor === 22 && patch >= 1))) ||
      major > 26 || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1)));
    expect(report.status).toBe(compatible ? "ready" : "incomplete");
    expect(report.nodePath).toBe(process.execPath);
    expect(report.checks[0]).toMatchObject({ id: "node-runtime", nodePath: process.execPath });
    expect(report.checks[0].detail).toContain(process.versions.node);
  });

  it.skipIf(!fs.existsSync(path.join(os.homedir(), ".nvm/versions/node/v24.22.1/bin/node")))(
    "finds the highest compatible nvm Node without PATH in a Finder launch", async () => {
      const vaultPath = copyFixture("v2-basic");
      writeToolCard(vaultPath, { ...baseCard, checks: [
        { id: "node", kind: "node", label: "Node", ranges: [
          { min_version: "24.22.1", max_version_exclusive: "25.0.0" },
        ] },
      ] });
      const previousPath = process.env.PATH;
      process.env.PATH = "/usr/bin:/bin";
      let report;
      try {
        report = await verifyToolReadiness(vaultPath, "demo-tool");
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }
      expect(report.status).toBe("ready");
      expect(report.nodePath).toBe(path.join(os.homedir(), ".nvm/versions/node/v24.22.1/bin/node"));
    });

  it.skipIf(path.basename(process.execPath) !== "node")("does not inherit Node preload options into a version probe", async () => {
    const vaultPath = copyFixture("v2-basic");
    const dir = tempDir("node-preload");
    const marker = path.join(dir, "preloaded");
    const preload = path.join(dir, "preload.cjs");
    fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`);
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "node", kind: "node", label: "Node", ranges: [{ min_version: "0.0.0" }] },
    ] });
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require=" + preload;
    let report;
    try {
      report = await verifyToolReadiness(vaultPath, "demo-tool", { nodePath: process.execPath });
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
    expect(report.status).toBe("ready");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("rejects card-supplied Node commands and non-native Node overrides", async () => {
    const vaultPath = copyFixture("v2-basic");
    const ranges = [{ min_version: "22.23.4", max_version_exclusive: "23.0.0" }];
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "node", kind: "node", label: "Node", ranges, executable: "/tmp/node" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "node", kind: "node", label: "Node", ranges: [
        { min_version: "23.0.0", max_version_exclusive: "22.23.4" },
      ] },
    ] })).toThrow(VaultDeskError);
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "node", kind: "node", label: "Node", ranges },
    ] });
    const dir = tempDir("fake-node");
    const marker = path.join(dir, "ran");
    const fake = path.join(dir, "node");
    fs.writeFileSync(fake, "#!/bin/sh\ntouch " + marker + "\n");
    fs.chmodSync(fake, 0o755);
    await expect(verifyToolReadiness(vaultPath, "demo-tool", { nodePath: fake })).rejects.toThrow(VaultDeskError);
    await expect(verifyToolReadiness(vaultPath, "demo-tool", { nodePath: "node" })).rejects.toThrow(VaultDeskError);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("checks prerequisites by profile and detects a changed requirements baseline", async () => {
    const vaultPath = copyFixture("v2-basic");
    const readme = path.join(vaultPath, "README.md");
    const expectedHash = "sha256:" + createHash("sha256").update(fs.readFileSync(readme)).digest("hex");
    const absent = path.join(tempDir("tool-absent"), "absent");
    delete process.env.VAULTDESK_READINESS_UNSET_TEST;
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "manifest", kind: "file-hash", label: "Requirements baseline", path: "README.md", expected_hash: expectedHash },
      { id: "git", kind: "executable", label: "Git", name: "git" },
      { id: "api", kind: "env", label: "Optional API", name: "VAULTDESK_READINESS_UNSET_TEST", optional: true, profiles: ["api"] },
      { id: "pdf", kind: "path", label: "PDF binary", path: absent, profiles: ["pdf"] },
    ] });

    const all = await verifyToolReadiness(vaultPath, "demo-tool");
    expect(all.status).toBe("ready");
    expect(all.checks.map((check) => check.id)).toEqual(["manifest", "git"]);
    const pdf = await verifyToolReadiness(vaultPath, "demo-tool", { profile: "pdf" });
    expect(pdf.status).toBe("incomplete");
    expect(pdf.checks.find((check) => check.id === "pdf")?.status).toBe("missing");
    const api = await verifyToolReadiness(vaultPath, "demo-tool", { profile: "api" });
    expect(api.status).toBe("ready");
    expect(api.checks.map((check) => check.id)).toEqual(["manifest", "git", "api"]);
    expect(api.checks[2]).toMatchObject({ status: "missing", optional: true });
    await expect(verifyToolReadiness(vaultPath, "demo-tool", { profile: "unknown" })).rejects.toThrow(VaultDeskError);

    fs.appendFileSync(readme, "changed\n");
    const changed = await verifyToolReadiness(vaultPath, "demo-tool", { profile: "api" });
    expect(changed.status).toBe("incomplete");
    expect(changed.checks[0].status).toBe("drift");
  });

  it("rejects card-supplied Python paths and relative path checks", async () => {
    const vaultPath = copyFixture("v2-basic");
    const dir = tempDir("fake-python");
    const marker = path.join(dir, "ran");
    const fake = path.join(dir, "python");
    fs.writeFileSync(fake, "#!/bin/sh\ntouch " + marker + "\n");
    fs.chmodSync(fake, 0o755);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "bad", label: "Bad", kind: "python", executable: "/bin/sh" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "native", label: "Native Python", kind: "python", executable: "/usr/bin/python3" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "native-package", label: "Native Python package", kind: "python-package", interpreter: "/usr/bin/python3", requirement: "pip" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "relative", label: "Relative path", kind: "path", path: "../tool" },
    ] })).toThrow(VaultDeskError);
    expect(() => parseToolCard({ ...baseCard, checks: [
      { id: "escape", label: "Escape", kind: "file-hash", path: "../outside", expected_hash: "sha256:" + "a".repeat(64) },
    ] })).toThrow(VaultDeskError);
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "python", label: "Python", kind: "python", executable: "python3" },
    ] });
    expect(fs.existsSync(marker)).toBe(false);
    await expect(verifyToolReadiness(vaultPath, "demo-tool", { pythonPath: fake })).rejects.toThrow(VaultDeskError);
    await expect(verifyToolReadiness(vaultPath, "demo-tool", { pythonPath: "python3" })).rejects.toThrow(VaultDeskError);
  });

  it.skipIf(!fs.existsSync("/usr/bin/python3"))("uses a controlled PATH and checks native Python asynchronously", async () => {
    const vaultPath = copyFixture("v2-basic");
    const dir = tempDir("untrusted-python-path");
    const marker = path.join(dir, "ran");
    const fake = path.join(dir, "python3");
    fs.writeFileSync(fake, "#!/bin/sh\ntouch " + marker + "\n");
    fs.chmodSync(fake, 0o755);
    writeToolCard(vaultPath, { ...baseCard, checks: [
      { id: "python", label: "Python version", kind: "python", executable: "python3", min_version: "99.0" },
    ] });
    const previousPath = process.env.PATH;
    process.env.PATH = dir + path.delimiter + (previousPath ?? "");
    let report;
    try {
      report = await verifyToolReadiness(vaultPath, "demo-tool");
    } finally {
      process.env.PATH = previousPath;
    }
    expect(report.status).toBe("incomplete");
    expect(report.pythonPath).toMatch(/\/python3(?:\.\d+)?$/);
    expect(report.checks[0].status).toBe("incompatible");
    expect(report.checks[0].detail).toMatch(/^Python \d+\.\d+\.\d+/);
    expect(fs.existsSync(marker)).toBe(false);
    const overridden = await verifyToolReadiness(vaultPath, "demo-tool", { pythonPath: "/usr/bin/python3" });
    expect(overridden.pythonPath).toMatch(/\/python3(?:\.\d+)?$/);
  });

  it.skipIf(!fs.existsSync(path.join(os.homedir(), "miniconda3/bin/python3")))(
    "prefers the Miniconda base Python regardless of system PATH order", async () => {
      const vaultPath = copyFixture("v2-basic");
      writeToolCard(vaultPath, { ...baseCard, checks: [
        { id: "python", kind: "python", label: "Python", executable: "python3", min_version: "3.10" },
      ] });
      const condaDir = path.join(os.homedir(), "miniconda3/bin");
      const previousPath = process.env.PATH;
      let condaReport;
      let systemReport;
      try {
        process.env.PATH = condaDir + path.delimiter + "/usr/bin";
        condaReport = await verifyToolReadiness(vaultPath, "demo-tool");
        process.env.PATH = "/usr/bin";
        systemReport = await verifyToolReadiness(vaultPath, "demo-tool");
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }
      expect(condaReport.pythonPath).toContain("miniconda3/bin/python3");
      expect(systemReport.pythonPath).toContain("miniconda3/bin/python3");
      const overridden = await verifyToolReadiness(vaultPath, "demo-tool", { pythonPath: "/usr/bin/python3" });
      const systemPython = spawnSync("/usr/bin/python3", ["-I", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
      expect(systemPython.status).toBe(0);
      expect(overridden.pythonPath).toBe(systemPython.stdout.trim());
    });

  it("distinguishes a card without checks from a ready environment", async () => {
    const vaultPath = copyFixture("v2-basic");
    writeToolCard(vaultPath, baseCard);
    expect(await verifyToolReadiness(vaultPath, "demo-tool")).toMatchObject({ status: "unconfigured", checks: [] });
  });
});
