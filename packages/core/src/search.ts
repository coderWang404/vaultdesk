import path from "node:path";
import { loadVault } from "./vault/model.js";
import type { SearchHit } from "./types.js";

export interface SearchVaultRef {
  path: string;
  label?: string;
}

export interface SearchOptions {
  query: string;
  vaults: SearchVaultRef[];
  limit?: number;
}

export interface SearchReport {
  hits: SearchHit[];
  warnings: string[];
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreEntry(tokens: string[], fields: {
  name: string;
  source: string;
  description?: string;
  repo?: string;
  origin: string;
  shape: string;
  packageKind?: string;
  installedTargets: string[];
  extra?: (string | undefined)[];
}): number {
  if (tokens.length === 0) return 1;
  const extra = (fields.extra ?? []).filter((value): value is string => Boolean(value));
  const haystack = [
    fields.name,
    fields.source,
    fields.description ?? "",
    fields.repo ?? "",
    fields.origin,
    fields.shape,
    fields.packageKind ?? "",
    ...fields.installedTargets,
    ...extra,
  ]
    .join(" ")
    .toLowerCase();
  if (!tokens.every((token) => haystack.includes(token))) return 0;

  const name = fields.name.toLowerCase();
  const source = fields.source.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 120;
    else if (name.startsWith(token)) score += 70;
    else if (name.includes(token)) score += 45;
    if (source === token) score += 40;
    else if (source.includes(token)) score += 25;
    if (fields.description?.toLowerCase().includes(token)) score += 18;
    if (fields.repo?.toLowerCase().includes(token)) score += 12;
    if (fields.installedTargets.some((target) => target.toLowerCase().includes(token))) score += 8;
    if (fields.origin === token) score += 6;
    if (extra.some((value) => value.toLowerCase().includes(token))) score += 5;
  }
  return score;
}

function vaultRelative(vaultPath: string, target: string): string {
  return path.relative(vaultPath, target).split(path.sep).join("/");
}

export async function searchVaults(options: SearchOptions): Promise<SearchReport> {
  const tokens = tokenize(options.query);
  const limit = options.limit ?? 40;
  const hits: SearchHit[] = [];
  const warnings: string[] = [];

  for (const ref of options.vaults) {
    let snapshot;
    try {
      snapshot = await loadVault(ref.path);
    } catch (error) {
      warnings.push(`${ref.label || ref.path}: ${(error as Error).message}`);
      continue;
    }
    for (const skill of snapshot.skills) {
      const installedTargets = skill.installed.map((entry) => entry.targetId);
      const score = scoreEntry(tokens, {
        name: skill.name,
        source: skill.sourceName,
        description: skill.description,
        repo: skill.repo,
        origin: skill.origin,
        shape: skill.shape,
        packageKind: skill.packageKind,
        installedTargets,
      });
      if (score <= 0) continue;
      hits.push({
        vaultPath: snapshot.path,
        vaultName: ref.label || snapshot.name,
        skill: skill.name,
        sourceName: skill.sourceName,
        origin: skill.origin,
        shape: skill.shape,
        description: skill.description,
        relativePath: skill.relativePath,
        installedTargets: [...new Set(installedTargets)].sort(),
        score,
      });
    }

    for (const tool of snapshot.tools) {
      const score = scoreEntry(tokens, {
        name: tool.name,
        source: "tools",
        description: tool.summary,
        origin: "external",
        shape: "tool",
        installedTargets: [],
        extra: [
          tool.title,
          tool.kind,
          tool.recorded_version,
          tool.homepage,
          tool.docs,
          ...tool.tags,
          ...tool.related_skills,
          ...tool.requirements,
          tool.run,
          ...tool.install.map((method) => `${method.label} ${method.command}`),
        ],
      });
      if (score <= 0) continue;
      hits.push({
        vaultPath: snapshot.path,
        vaultName: ref.label || snapshot.name,
        skill: tool.name,
        sourceName: "tools",
        origin: "external",
        shape: "tool",
        toolKind: tool.kind,
        description: tool.summary,
        relativePath: tool.relativePath,
        installedTargets: [],
        score,
      });
    }

    for (const external of snapshot.externalSkills) {
      const score = scoreEntry(tokens, {
        name: external.name,
        source: external.owner,
        description: external.description,
        origin: "external",
        shape: "external-skill",
        installedTargets: [],
        extra: [
          external.title,
          external.skillPath,
          external.version,
          external.observedVersion,
          external.relatedTool,
          external.status,
        ],
      });
      if (score <= 0) continue;
      hits.push({
        vaultPath: snapshot.path,
        vaultName: ref.label || snapshot.name,
        skill: external.name,
        sourceName: external.owner,
        origin: "external",
        shape: "external-skill",
        description: external.description,
        relativePath: external.relativePath,
        installedTargets: [],
        score,
      });
    }

    for (const plugin of snapshot.plugins) {
      const manifestFields = plugin.manifests.flatMap((manifest) => [
        manifest.agent,
        manifest.name,
        manifest.version,
      ]);
      const score = scoreEntry(tokens, {
        name: plugin.name,
        source: plugin.name,
        description: plugin.description,
        repo: plugin.repo,
        origin: plugin.origin,
        shape: "plugin",
        installedTargets: [],
        extra: [
          plugin.version,
          plugin.license,
          ...manifestFields,
          ...plugin.assets.map((asset) => asset.kind),
        ],
      });
      if (score <= 0) continue;
      hits.push({
        vaultPath: snapshot.path,
        vaultName: ref.label || snapshot.name,
        skill: plugin.name,
        sourceName: plugin.name,
        origin: plugin.origin,
        shape: "plugin",
        description: plugin.description,
        relativePath: vaultRelative(snapshot.path, plugin.workingPath),
        installedTargets: [],
        score,
      });
    }

    for (const plugin of snapshot.plugins) {
      const manifestFields = plugin.manifests.map((manifest) => manifest.agent);
      for (const skill of plugin.skills) {
        const score = scoreEntry(tokens, {
          name: skill.name,
          source: plugin.name,
          description: skill.description,
          repo: plugin.repo,
          origin: plugin.origin,
          shape: "plugin-skill",
          installedTargets: [],
          extra: [plugin.description, plugin.version, ...manifestFields],
        });
        if (score <= 0) continue;
        hits.push({
          vaultPath: snapshot.path,
          vaultName: ref.label || snapshot.name,
          skill: skill.name,
          sourceName: plugin.name,
          pluginName: plugin.name,
          origin: plugin.origin,
          shape: "plugin-skill",
          description: skill.description,
          relativePath: skill.relativePath,
          installedTargets: [],
          score,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill) || a.vaultName.localeCompare(b.vaultName));
  return { hits: hits.slice(0, limit), warnings };
}
