import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildAgentCatalog,
  canonicalPath,
  expandHome,
  listRegisteredVaults,
  openVault,
  type AgentCatalog,
  type RegisteredVault,
} from "@vaultdesk/core";
import path from "node:path";

export interface VaultDeskMcpOptions {
  fixedVault?: string;
  settingsFile?: string;
  version?: string;
}

interface CatalogArgs {
  vault?: string;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\b(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
      .replace(/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[redacted]")
      .replace(/\b(token|api[_-]?key|secret|password|signature|access[_-]?key)\s*([=:])\s*([^\s&,'";]+)/gi, "$1$2[redacted]")
      .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)\s*=\s*([^\s&,'";]+)/g, "[redacted]=[redacted]")
      .replace(/(--?(?:token|api[-_]?key|secret|password|access[-_]?key)|(?:authorization|x-api-key)\s*:)\s+([^\s&,'";]+)/gi, "$1 [redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, "[redacted]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return value;
}

function json(value: unknown): { content: [{ type: "text"; text: string }]; structuredContent: Record<string, unknown> } {
  const safeValue = sanitize(value);
  const structuredContent = safeValue && typeof safeValue === "object" && !Array.isArray(safeValue)
    ? safeValue as Record<string, unknown>
    : { value: safeValue };
  return {
    content: [{ type: "text", text: JSON.stringify(safeValue, null, 2) }],
    structuredContent,
  };
}

function errorResult(message: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: String(sanitize(message)) }], isError: true };
}

function registeredVaults(settingsFile?: string): RegisteredVault[] {
  return listRegisteredVaults(settingsFile);
}

function readyVaults(settingsFile?: string): RegisteredVault[] {
  return registeredVaults(settingsFile).filter((entry) => entry.status === "ready");
}

function resolveVault(requested: string | undefined, fixedVault: string | undefined, settingsFile?: string): string {
  const requestedPath = requested ? canonicalPath(expandHome(requested)) : undefined;
  const fixedPath = fixedVault ? canonicalPath(expandHome(fixedVault)) : undefined;
  if (fixedPath && requestedPath && fixedPath !== requestedPath) {
    throw new Error("This MCP server is pinned to a different Vault.");
  }
  const selected = fixedPath ?? requestedPath;
  if (selected) {
    const registered = registeredVaults(settingsFile).some((entry) => entry.path === selected && entry.status === "ready");
    if (!fixedPath && !registered) {
      throw new Error("The requested Vault is not registered in VaultDesk.");
    }
    return selected;
  }
  const entries = readyVaults(settingsFile);
  if (entries.length !== 1) {
    throw new Error(entries.length === 0
      ? "No registered Vault is available. Open a Vault in VaultDesk first."
      : "More than one Vault is registered. Pass the vault path to this tool or pin the MCP server with --vault.");
  }
  return entries[0]!.path;
}

async function catalogFor(args: CatalogArgs, options: VaultDeskMcpOptions): Promise<AgentCatalog> {
  const snapshot = await openVault(resolveVault(args.vault, options.fixedVault, options.settingsFile));
  return buildAgentCatalog(snapshot);
}

function listSummary(catalog: AgentCatalog): Record<string, unknown> {
  return {
    vault: catalog.vault,
    sources: catalog.sources.map((source) => ({
      name: source.name,
      origin: source.origin,
      updateMode: source.updateMode,
      automaticUpdates: source.automaticUpdates,
      status: source.status,
      skillNames: source.skillNames,
    })),
    skills: catalog.skills.map((skill) => ({
      name: skill.name,
      sourceName: skill.sourceName,
      shape: skill.shape,
      origin: skill.origin,
      masterStatus: skill.master.status,
      installedTargets: skill.installedTargets.map((target) => ({
        targetId: target.targetId,
        path: target.path,
        status: target.status,
        installAfterUpdate: target.installAfterUpdate,
      })),
      agentLoaded: skill.agentLoaded,
    })),
    plugins: catalog.plugins.map((plugin) => ({
      name: plugin.name,
      origin: plugin.origin,
      containedSkills: plugin.containedSkills,
      assetKinds: plugin.assetKinds,
      targetFiles: plugin.targetFiles,
      agentLoaded: plugin.agentLoaded,
      agentConnected: plugin.agentConnected,
    })),
    tools: catalog.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      kind: tool.kind,
      capabilities: tool.capabilities,
      summary: tool.summary,
      install: tool.install,
      run: tool.run,
      requirements: tool.requirements,
      relatedSkills: tool.relatedSkills,
      readiness: tool.readiness,
      installState: tool.installState,
      enabledState: tool.enabledState,
      connectedState: tool.connectedState,
    })),
    externalSkills: catalog.externalSkills,
    agent: catalog.agent,
  };
}

export function createVaultDeskMcpServer(options: VaultDeskMcpOptions = {}): McpServer {
  const server = new McpServer(
    { name: "vaultdesk", version: options.version ?? "1.2.9" },
    { instructions: "VaultDesk is read-only here. It reports ownership, distribution, install instructions, and observed file state; it never installs, starts, updates, or registers tools." },
  );

  server.registerTool("vaultdesk_list_vaults", {
    title: "List registered Vaults",
    description: "List VaultDesk Vaults explicitly registered by the desktop app. Does not scan the filesystem.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json(registeredVaults(options.settingsFile)));

  server.registerTool("vaultdesk_get_catalog", {
    title: "Get the agent tool catalog",
    description: "Return source ownership, skills, plugins, targets, tool cards, install methods, and observed file state. Agent loaded/connected state remains unknown without an agent-specific probe.",
    inputSchema: { vault: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      return json(await catalogFor(args, options));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("vaultdesk_list_assets", {
    title: "List available agent assets",
    description: "List concise skill, plugin, MCP, CLI, and app records with ownership and installation guidance.",
    inputSchema: { vault: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      return json(listSummary(await catalogFor(args, options)));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("vaultdesk_search_assets", {
    title: "Search agent assets",
    description: "Search the registered catalog by name, description, source, owner, tag, or capability.",
    inputSchema: { query: z.string().min(1), vault: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const catalog = await catalogFor(args, options);
      const query = args.query.toLocaleLowerCase();
      const skills = catalog.skills.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(query));
      const plugins = catalog.plugins.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(query));
      const tools = catalog.tools.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(query));
      const externalSkills = catalog.externalSkills.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(query));
      return json({ query: args.query, skills, plugins, tools, externalSkills });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("vaultdesk_get_tool", {
    title: "Get tool installation guidance",
    description: "Return one external tool card, its install commands, runtime checks, related skills, and observed integration states. Does not run any command.",
    inputSchema: { name: z.string().min(1), vault: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const catalog = await catalogFor(args, options);
      const tool = catalog.tools.find((item) => item.name === args.name);
      if (!tool) return errorResult(`Tool card not found: ${args.name}`);
      return json({
        tool,
        relatedSkills: catalog.skills.filter((skill) => tool.relatedSkills.includes(skill.name)),
        relatedExternalSkills: catalog.externalSkills.filter((skill) => tool.relatedSkills.includes(skill.name) || skill.relatedTool === tool.name),
        integration: {
          installState: tool.installState,
          enabledState: tool.enabledState,
          connectedState: tool.connectedState,
          readiness: tool.readiness,
          note: "Catalog queries do not run checks. Use vaultdesk tool verify for declared runtime requirements; agent activation and connection require evidence from the agent itself.",
        },
      });
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

export async function serveVaultDeskMcp(options: VaultDeskMcpOptions = {}): Promise<void> {
  const server = createVaultDeskMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
