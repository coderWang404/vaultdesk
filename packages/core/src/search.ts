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

function scoreSkill(tokens: string[], fields: {
  skill: string;
  source: string;
  description?: string;
  repo?: string;
  origin: string;
  shape: string;
  packageKind?: string;
  installedTargets: string[];
}): number {
  if (tokens.length === 0) return 1;
  const haystack = [
    fields.skill,
    fields.source,
    fields.description ?? "",
    fields.repo ?? "",
    fields.origin,
    fields.shape,
    fields.packageKind ?? "",
    ...fields.installedTargets,
  ]
    .join(" ")
    .toLowerCase();
  if (!tokens.every((token) => haystack.includes(token))) return 0;

  const skill = fields.skill.toLowerCase();
  const source = fields.source.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (skill === token) score += 120;
    else if (skill.startsWith(token)) score += 70;
    else if (skill.includes(token)) score += 45;
    if (source === token) score += 40;
    else if (source.includes(token)) score += 25;
    if (fields.description?.toLowerCase().includes(token)) score += 18;
    if (fields.repo?.toLowerCase().includes(token)) score += 12;
    if (fields.installedTargets.some((target) => target.toLowerCase().includes(token))) score += 8;
    if (fields.origin === token) score += 6;
  }
  return score;
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
      const score = scoreSkill(tokens, {
        skill: skill.name,
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
  }

  hits.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill) || a.vaultName.localeCompare(b.vaultName));
  return { hits: hits.slice(0, limit), warnings };
}
