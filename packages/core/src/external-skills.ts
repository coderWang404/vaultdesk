import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { externalSkillCardSchema, type ExternalSkillCard } from "@vaultdesk/schema";
import { VaultDeskError } from "./errors.js";
import { parseFrontmatter, frontmatterDescription } from "./frontmatter.js";
import {
  canonicalPath,
  expandHome,
  hashDirectory,
  isDirectory,
  isFile,
  listDirectory,
  readText,
  relativeSlash,
  writeTextAtomic,
} from "./fsx.js";
import type { ExternalSkillRecord, ExternalSkillStatus, VaultSnapshot } from "./types.js";

export function externalSkillCardPath(vaultPath: string, name: string): string {
  return path.join(canonicalPath(vaultPath), "external-skills", `${name}.yml`);
}

function observedVersionOf(skillFile: string): string | undefined {
  try {
    const parsed = parseFrontmatter(readText(skillFile));
    const metadata = parsed.data.metadata;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const version = (metadata as Record<string, unknown>).version;
      if (typeof version === "string" && version.trim()) return version.trim();
    }
  } catch {
    // Observation is best-effort; validation reports unreadable files separately.
  }
  return undefined;
}

function observe(card: ExternalSkillCard, metadataPath: string, vaultPath: string): ExternalSkillRecord {
  const skillPath = path.resolve(expandHome(card.path));
  const exists = isDirectory(skillPath);
  const skillFile = path.join(skillPath, "SKILL.md");
  const hasSkillFile = isFile(skillFile);
  let observedHash: string | undefined;
  let observedVersion: string | undefined;
  let modifiedAt: string | undefined;
  let description = card.description;

  if (exists) {
    observedHash = hashDirectory(skillPath);
    const stampPath = hasSkillFile ? skillFile : skillPath;
    try {
      modifiedAt = fs.statSync(stampPath).mtime.toISOString();
    } catch {
      modifiedAt = undefined;
    }
  }
  if (hasSkillFile) {
    observedVersion = observedVersionOf(skillFile);
    if (!description) {
      try {
        description = frontmatterDescription(parseFrontmatter(readText(skillFile)).data);
      } catch {
        description = undefined;
      }
    }
  }

  const markerPresent = isFile(path.join(skillPath, ".vault-managed"));
  const hashMatches =
    card.expected_hash && observedHash ? observedHash === card.expected_hash : undefined;
  const status: ExternalSkillStatus = !exists
    ? "missing"
    : !hasSkillFile
      ? "invalid"
      : markerPresent
        ? "conflict"
        : hashMatches === false
          ? "drift"
          : hashMatches === true
            ? "ok"
            : "observed";

  return {
    name: card.name,
    owner: card.owner,
    skillPath,
    title: card.title,
    version: card.version,
    expectedHash: card.expected_hash,
    relatedTool: card.related_tool,
    description,
    notes: card.notes,
    metadataPath,
    relativePath: relativeSlash(vaultPath, metadataPath),
    exists,
    hasSkillFile,
    observedHash,
    observedVersion,
    modifiedAt,
    hashMatches,
    markerPresent,
    status,
  };
}

export function listExternalSkills(vaultPath: string): {
  skills: ExternalSkillRecord[];
  warnings: string[];
} {
  const root = path.join(canonicalPath(vaultPath), "external-skills");
  if (!isDirectory(root)) return { skills: [], warnings: [] };
  const skills: ExternalSkillRecord[] = [];
  const warnings: string[] = [];
  for (const entry of listDirectory(root)) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) continue;
    const file = path.join(root, entry.name);
    let raw: unknown;
    try {
      raw = YAML.parse(readText(file));
    } catch (error) {
      warnings.push(`external-skills/${entry.name}: ${(error as Error).message}`);
      continue;
    }
    const parsed = externalSkillCardSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(
        `external-skills/${entry.name}: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "card"}: ${issue.message}`)
          .join("; ")}`,
      );
      continue;
    }
    skills.push(observe(parsed.data, file, canonicalPath(vaultPath)));
  }
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

export function externalSkillDocument(card: ExternalSkillCard): Record<string, unknown> {
  return {
    schema: 1,
    name: card.name,
    owner: card.owner,
    path: card.path,
    ...(card.title ? { title: card.title } : {}),
    ...(card.version ? { version: card.version } : {}),
    ...(card.expected_hash ? { expected_hash: card.expected_hash } : {}),
    ...(card.related_tool ? { related_tool: card.related_tool } : {}),
    ...(card.description ? { description: card.description } : {}),
    ...(card.notes ? { notes: card.notes } : {}),
  };
}

export function parseExternalSkillCard(input: unknown): ExternalSkillCard {
  const parsed = externalSkillCardSchema.safeParse(input);
  if (!parsed.success) {
    throw new VaultDeskError("invalid-input", "External skill card is invalid.", {
      details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return parsed.data;
}

export function writeExternalSkillCard(
  vaultPath: string,
  input: unknown,
  options: { force?: boolean } = {},
): { card: ExternalSkillCard; path: string; relativePath: string } {
  const card = parseExternalSkillCard(input);
  const file = externalSkillCardPath(vaultPath, card.name);
  if (isFile(file) && !options.force) {
    throw new VaultDeskError("path-conflict", `External skill card already exists: external-skills/${card.name}.yml`, {
      details: ["Pass --force to replace it."],
    });
  }
  writeTextAtomic(file, YAML.stringify(externalSkillDocument(card), { lineWidth: 0 }));
  return {
    card,
    path: file,
    relativePath: relativeSlash(canonicalPath(vaultPath), file),
  };
}

export function externalSkillsArtifact(snapshot: VaultSnapshot): Record<string, unknown> {
  return {
    schema: 1,
    vault: snapshot.name,
    skills: snapshot.externalSkills.map((skill) => ({
      name: skill.name,
      owner: skill.owner,
      path: skill.skillPath,
      ...(skill.title ? { title: skill.title } : {}),
      ...(skill.version ? { version: skill.version } : {}),
      ...(skill.expectedHash ? { expected_hash: skill.expectedHash } : {}),
      ...(skill.relatedTool ? { related_tool: skill.relatedTool } : {}),
      ...(skill.description ? { description: skill.description } : {}),
      observed_hash: skill.observedHash ?? null,
      observed_version: skill.observedVersion ?? null,
      status: skill.status,
    })),
  };
}
