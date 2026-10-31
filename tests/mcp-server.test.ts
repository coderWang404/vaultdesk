import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { copyFixture, repoRoot, snapshotTree, tempDir } from "./helpers.js";
import { createVaultDeskMcpServer } from "../packages/cli/src/mcp-server.js";

const cliRequire = createRequire(path.join(repoRoot, "packages/cli/package.json"));
const { Client } = cliRequire("@modelcontextprotocol/sdk/client") as {
  Client: new (info: { name: string; version: string }) => any;
};
const { InMemoryTransport } = cliRequire("@modelcontextprotocol/sdk/inMemory.js") as {
  InMemoryTransport: { createLinkedPair(): any[] };
};

async function withMcp<T>(settingsFile: string, callback: (client: any) => Promise<T>): Promise<T> {
  const server = createVaultDeskMcpServer({ settingsFile });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function responseText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
}

describe("VaultDesk MCP server", () => {
  it("exposes read-only catalog tools and does not change registered Vaults", async () => {
    const vault = copyFixture("v2-basic");
    const root = tempDir("mcp-catalog");
    const settings = path.join(root, "settings.json");
    fs.writeFileSync(settings, "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "recent-vaults.json"), JSON.stringify({
      vaults: [{ path: vault, name: "Fixture" }],
    }), "utf8");
    fs.mkdirSync(path.join(vault, "tools"), { recursive: true });
    fs.writeFileSync(path.join(vault, "tools", "filesystem-mcp.yml"), [
      "schema: 1",
      "name: filesystem-mcp",
      "kind: mcp",
      "title: Filesystem MCP",
      "summary: Fixture MCP",
      "homepage: https://example.com/filesystem-mcp",
      "install:",
      "  - label: Install",
      "    command: npm install filesystem-mcp",
      "run: npx filesystem-mcp",
      "tags: [mcp]",
      "",
    ].join("\n"), "utf8");
    const before = snapshotTree(vault);

    await withMcp(settings, async (client) => {
      const tools = await client.listTools();
      expect(tools.tools.map((tool: { name: string }) => tool.name)).toEqual([
        "vaultdesk_list_vaults",
        "vaultdesk_get_catalog",
        "vaultdesk_list_assets",
        "vaultdesk_search_assets",
        "vaultdesk_get_tool",
      ]);
      expect(tools.tools.every((tool: { annotations?: { readOnlyHint?: boolean } }) => tool.annotations?.readOnlyHint === true)).toBe(true);

      const listed = await client.callTool({ name: "vaultdesk_list_vaults", arguments: {} });
      expect(JSON.stringify(listed)).toContain("Fixture");

      const catalog = await client.callTool({ name: "vaultdesk_get_catalog", arguments: {} });
      expect(responseText(catalog)).toContain('"connected": "unknown"');
      expect(responseText(catalog)).toContain('"agentLoaded": "unknown"');

      const tool = await client.callTool({ name: "vaultdesk_get_tool", arguments: { name: "filesystem-mcp" } });
      expect(responseText(tool)).toContain("install");
      expect(responseText(tool)).toContain("connectedState");
    });

    expect(snapshotTree(vault)).toEqual(before);
  });

  it("rejects unregistered and non-pinned Vault paths", async () => {
    const registeredVault = copyFixture("v2-basic");
    const unregisteredVault = copyFixture("v2-plugins");
    const root = tempDir("mcp-reject-unregistered");
    const settings = path.join(root, "settings.json");
    fs.writeFileSync(settings, "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "recent-vaults.json"), JSON.stringify({
      vaults: [{ path: registeredVault, name: "Registered" }],
    }), "utf8");

    await withMcp(settings, async (client) => {
      const result = await client.callTool({ name: "vaultdesk_get_catalog", arguments: { vault: unregisteredVault } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("not registered");
    });

    const pinned = createVaultDeskMcpServer({ fixedVault: registeredVault, settingsFile: settings });
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([pinned.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "vaultdesk_get_catalog", arguments: { vault: unregisteredVault } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("pinned to a different Vault");
    } finally {
      await client.close();
      await pinned.close();
    }
  });

  it("redacts credentials and tokens from catalog strings", async () => {
    const vault = copyFixture("v2-basic");
    const root = tempDir("mcp-redaction");
    const settings = path.join(root, "settings.json");
    const toolFile = path.join(vault, "tools", "private-mcp.yml");
    fs.writeFileSync(settings, "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "recent-vaults.json"), JSON.stringify({ vaults: [{ path: vault }] }), "utf8");
    fs.mkdirSync(path.dirname(toolFile), { recursive: true });
    fs.writeFileSync(toolFile, [
      "schema: 1",
      "name: private-mcp",
      "kind: mcp",
      "title: Private MCP",
      "summary: Secret fixture",
      "homepage: 'https://user:password123@example.com/?token=querysecret'",
      "install:",
      "  - label: Install",
      "    command: MCP_API_KEY=secretvalue npx private-mcp",
      "run: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'",
      "tags: [mcp]",
      "",
    ].join("\n"), "utf8");

    await withMcp(settings, async (client) => {
      const result = await client.callTool({ name: "vaultdesk_get_tool", arguments: { name: "private-mcp" } });
      const output = responseText(result);
      expect(output).not.toContain("password123");
      expect(output).not.toContain("querysecret");
      expect(output).not.toContain("secretvalue");
      expect(output).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
      expect(output).toContain("[redacted]");
    });
  });

  it("speaks MCP JSON-RPC over the real CLI stdio transport", async () => {
    const vault = copyFixture("v2-basic");
    const child = spawn(process.execPath, [path.join(repoRoot, "packages/cli/dist/index.js"), "mcp", "serve", "--vault", vault], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let buffer = "";
    const pending: Array<(line: string) => void> = [];
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      while (true) {
        const index = buffer.indexOf("\n");
        if (index < 0) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        pending.shift()?.(line);
      }
    });
    const nextLine = (): Promise<string> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP subprocess response timed out")), 5_000);
      pending.push((line) => { clearTimeout(timer); resolve(line); });
    });
    const send = (message: Record<string, unknown>): void => child.stdin.write(JSON.stringify(message) + "\n");
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdio-test", version: "1.0.0" },
      } });
      const initialized = JSON.parse(await nextLine()) as { id: number; result?: { serverInfo?: { name?: string } } };
      expect(initialized.id).toBe(1);
      expect(initialized.result?.serverInfo?.name).toBe("vaultdesk");
      send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listed = JSON.parse(await nextLine()) as { id: number; result?: { tools?: Array<{ name: string }> } };
      expect(listed.id).toBe(2);
      expect(listed.result?.tools?.map((tool) => tool.name)).toContain("vaultdesk_get_catalog");
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  });
});
