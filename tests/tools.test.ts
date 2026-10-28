import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
