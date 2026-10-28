import path from "node:path";
import YAML from "yaml";
import { toolCardSchema, type ToolCard } from "@vaultdesk/schema";
import { VaultDeskError } from "./errors.js";
import {
  canonicalPath,
  isDirectory,
  isFile,
  listDirectory,
  readText,
  relativeSlash,
  writeTextAtomic,
} from "./fsx.js";
import type { ToolRecord } from "./types.js";

export function toolCardPath(vaultPath: string, name: string): string {
  return path.join(canonicalPath(vaultPath), "tools", `${name}.yml`);
}

export function listToolCards(vaultPath: string): { tools: ToolRecord[]; warnings: string[] } {
  const root = path.join(canonicalPath(vaultPath), "tools");
  if (!isDirectory(root)) return { tools: [], warnings: [] };
  const tools: ToolRecord[] = [];
  const warnings: string[] = [];
  for (const entry of listDirectory(root)) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const file = path.join(root, entry.name);
    let raw: unknown;
    try {
      raw = YAML.parse(readText(file));
    } catch (error) {
      warnings.push(`tools/${entry.name}: ${(error as Error).message}`);
      continue;
    }
    const parsed = toolCardSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(
        `tools/${entry.name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "card"}: ${issue.message}`).join("; ")}`,
      );
      continue;
    }
    tools.push({
      ...parsed.data,
      path: file,
      relativePath: relativeSlash(canonicalPath(vaultPath), file),
    });
  }
  return { tools: tools.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

export function toolDocument(card: ToolCard): Record<string, unknown> {
  return {
    schema: 1,
    name: card.name,
    kind: card.kind,
    title: card.title,
    summary: card.summary,
    homepage: card.homepage,
    ...(card.docs ? { docs: card.docs } : {}),
    ...(card.recorded_version ? { recorded_version: card.recorded_version } : {}),
    install: card.install.map((method) => ({ label: method.label, command: method.command })),
    ...(card.run ? { run: card.run } : {}),
    ...(card.requirements.length > 0 ? { requirements: card.requirements } : {}),
    ...(card.related_skills.length > 0 ? { related_skills: card.related_skills } : {}),
    ...(card.tags.length > 0 ? { tags: card.tags } : {}),
    ...(card.notes ? { notes: card.notes } : {}),
  };
}

export function parseToolCard(input: unknown): ToolCard {
  const parsed = toolCardSchema.safeParse(input);
  if (!parsed.success) {
    throw new VaultDeskError("invalid-input", "Tool card is invalid.", {
      details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return parsed.data;
}

export function writeToolCard(
  vaultPath: string,
  input: unknown,
  options: { force?: boolean } = {},
): ToolRecord {
  const card = parseToolCard(input);
  const file = toolCardPath(vaultPath, card.name);
  if (isFile(file) && !options.force) {
    throw new VaultDeskError("path-conflict", `Tool card already exists: tools/${card.name}.yml`, {
      details: ["Pass --force to replace it."],
    });
  }
  writeTextAtomic(file, YAML.stringify(toolDocument(card), { lineWidth: 0 }));
  return {
    ...card,
    path: file,
    relativePath: relativeSlash(canonicalPath(vaultPath), file),
  };
}
