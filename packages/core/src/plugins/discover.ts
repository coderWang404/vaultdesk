import path from "node:path";
import type { Origin } from "@vaultdesk/schema";
import { frontmatterDescription, parseFrontmatter } from "../frontmatter.js";
import {
  canonicalPath,
  exists,
  hashDirectory,
  isDirectory,
  isFile,
  isInside,
  listDirectory,
  readText,
  relativeSlash,
} from "../fsx.js";
import type {
  PluginAgent,
  PluginAsset,
  PluginAssetKind,
  PluginManifest,
  SkillRecord,
} from "../types.js";

const MANIFEST_FILES: { relativePath: string; agent: PluginAgent }[] = [
  { relativePath: "plugin.json", agent: "generic" },
  { relativePath: path.join(".claude-plugin", "plugin.json"), agent: "claude" },
  { relativePath: path.join(".codex-plugin", "plugin.json"), agent: "codex" },
  { relativePath: path.join(".qoder-plugin", "plugin.json"), agent: "qoder" },
];

const ASSET_DIRECTORIES: { name: string; kind: PluginAssetKind }[] = [
  { name: "skills", kind: "skills" },
  { name: "commands", kind: "commands" },
  { name: "agents", kind: "agents" },
  { name: "hooks", kind: "hooks" },
  { name: "rules", kind: "rules" },
  { name: "workflows", kind: "workflows" },
  { name: "output-styles", kind: "other" },
];

const ASSET_FILES: { name: string; kind: PluginAssetKind }[] = [
  { name: ".mcp.json", kind: "mcp" },
  { name: "mcp.json", kind: "mcp" },
];

const MANIFEST_ASSET_KEYS: { key: string; kind: PluginAssetKind }[] = [
  { key: "skills", kind: "skills" },
  { key: "commands", kind: "commands" },
  { key: "agents", kind: "agents" },
  { key: "hooks", kind: "hooks" },
  { key: "mcpServers", kind: "mcp" },
  { key: "rules", kind: "rules" },
  { key: "outputStyles", kind: "other" },
  { key: "workflows", kind: "workflows" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function relative(root: string, target: string): string {
  return relativeSlash(root, target);
}

function readManifest(filePath: string): { record: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(readText(filePath));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { record: {}, error: "manifest must be a JSON object" };
    }
    return { record: parsed as Record<string, unknown> };
  } catch (error) {
    return { record: {}, error: (error as Error).message };
  }
}

export function detectPluginManifests(root: string): PluginManifest[] {
  const manifests: PluginManifest[] = [];
  for (const candidate of MANIFEST_FILES) {
    const filePath = path.join(root, candidate.relativePath);
    if (!isFile(filePath)) continue;
    const base: PluginManifest = {
      agent: candidate.agent,
      path: filePath,
      relativePath: candidate.relativePath,
    };
    if (!isInside(filePath, root)) {
      manifests.push({ ...base, parseError: "manifest path escapes the plugin root" });
      continue;
    }
    const { record, error } = readManifest(filePath);
    if (error) {
      manifests.push({ ...base, parseError: error });
      continue;
    }
    manifests.push({
      ...base,
      name: asString(record.name),
      version: asString(record.version),
      description: asString(record.description),
      license: asString(record.license),
    });
  }
  return manifests;
}

function collectManifestPaths(value: unknown, root: string, out: string[]): void {
  if (typeof value === "string") {
    if (!value.trim()) return;
    const resolved = path.resolve(root, value);
    if (isInside(resolved, root)) out.push(resolved);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectManifestPaths(entry, root, out);
    return;
  }
  const record = asRecord(value);
  for (const entry of Object.values(record)) {
    if (typeof entry === "string" || Array.isArray(entry)) collectManifestPaths(entry, root, out);
  }
}

function manifestRecords(root: string, manifests: PluginManifest[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const manifest of manifests) {
    if (manifest.parseError) continue;
    const { record, error } = readManifest(manifest.path);
    if (!error) records.push(record);
  }
  return records;
}

export function discoverPluginAssets(
  root: string,
  manifests: PluginManifest[],
): { assets: PluginAsset[]; otherCount: number; hasHooks: boolean } {
  const assets: PluginAsset[] = [];
  const seen = new Set<string>();
  const add = (kind: PluginAssetKind, target: string): void => {
    if (!exists(target) || !isInside(target, root)) return;
    const key = canonicalPath(target);
    if (seen.has(key)) return;
    seen.add(key);
    assets.push({ kind, path: target, relativePath: relative(root, target) });
  };

  for (const entry of ASSET_DIRECTORIES) {
    add(entry.kind, path.join(root, entry.name));
  }
  for (const entry of ASSET_FILES) {
    add(entry.kind, path.join(root, entry.name));
  }
  for (const record of manifestRecords(root, manifests)) {
    for (const entry of MANIFEST_ASSET_KEYS) {
      const paths: string[] = [];
      collectManifestPaths(record[entry.key], root, paths);
      for (const target of paths) add(entry.kind, target);
    }
  }

  const known = new Set(assets.map((asset) => asset.relativePath));
  let otherCount = 0;
  for (const entry of listDirectory(root)) {
    if (entry.name.startsWith(".") && entry.name !== ".mcp.json") continue;
    if (["plugin.json", "LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "README.md"].includes(entry.name)) continue;
    if (known.has(entry.name)) continue;
    if (ASSET_DIRECTORIES.some((asset) => asset.name === entry.name)) continue;
    if (ASSET_FILES.some((asset) => asset.name === entry.name)) continue;
    otherCount += 1;
  }

  const hooksDir = path.join(root, "hooks");
  const hasHooks =
    (isDirectory(hooksDir) && listDirectory(hooksDir).length > 0) ||
    manifestRecords(root, manifests).some((record) => {
      const hooks = record.hooks;
      return Boolean(hooks) && (typeof hooks !== "object" || Object.keys(asRecord(hooks)).length > 0);
    });

  return { assets, otherCount, hasHooks };
}

export function discoverPluginSkills(input: {
  root: string;
  vaultPath: string;
  sourceName: string;
  origin: Origin;
  repo?: string;
  ref?: string;
  manifests: PluginManifest[];
  warnings: string[];
}): SkillRecord[] {
  const { root, manifests, warnings } = input;
  const candidates: string[] = [];
  const addCandidate = (dir: string): void => {
    if (!isDirectory(dir) || !isFile(path.join(dir, "SKILL.md"))) return;
    if (!isInside(dir, root)) {
      warnings.push(`Plugin ${input.sourceName} skill path escapes the plugin root: ${relative(root, dir)}`);
      return;
    }
    candidates.push(dir);
  };

  for (const record of manifestRecords(root, manifests)) {
    const paths: string[] = [];
    collectManifestPaths(record.skills, root, paths);
    for (const target of paths) {
      if (!isDirectory(target)) continue;
      addCandidate(target);
      for (const entry of listDirectory(target)) {
        if (entry.isDirectory()) addCandidate(path.join(target, entry.name));
      }
    }
  }
  const skillsRoot = path.join(root, "skills");
  for (const entry of listDirectory(skillsRoot)) {
    if (entry.isDirectory() || entry.isSymbolicLink()) addCandidate(path.join(skillsRoot, entry.name));
  }

  const seen = new Set<string>();
  const skills: SkillRecord[] = [];
  for (const dir of candidates) {
    const key = canonicalPath(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = path.basename(dir);
    const skillFile = path.join(dir, "SKILL.md");
    let description: string | undefined;
    try {
      const parsed = parseFrontmatter(readText(skillFile));
      if (parsed.error) warnings.push(`${relative(root, skillFile)}: ${parsed.error}`);
      description = frontmatterDescription(parsed.data);
    } catch (error) {
      warnings.push(`${relative(root, skillFile)}: ${(error as Error).message}`);
    }
    skills.push({
      name,
      description,
      shape: "plugin-skill",
      origin: input.origin,
      sourceName: input.sourceName,
      pluginName: input.sourceName,
      workingPath: dir,
      relativePath: relativeSlash(input.vaultPath, dir),
      repo: input.repo,
      ref: input.ref,
      userInvocable: !description?.toLowerCase().includes("(internal"),
      isEntrypoint: false,
      installed: [],
      contentHash: hashDirectory(dir),
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function pluginLicense(root: string, manifests: PluginManifest[]): string | undefined {
  for (const manifest of manifests) {
    if (manifest.license) return manifest.license;
  }
  const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].find((name) => isFile(path.join(root, name)));
  return licenseFile;
}

export function inspectPlugin(input: {
  root: string;
  vaultPath: string;
  sourceName: string;
  origin: Origin;
  repo?: string;
  ref?: string;
  warnings: string[];
}): {
  manifests: PluginManifest[];
  assets: PluginAsset[];
  otherCount: number;
  hasHooks: boolean;
  license?: string;
  skills: SkillRecord[];
} {
  const manifests = detectPluginManifests(input.root);
  const { assets, otherCount, hasHooks } = discoverPluginAssets(input.root, manifests);
  const skills = discoverPluginSkills({ ...input, manifests });
  return {
    manifests,
    assets,
    otherCount,
    hasHooks,
    license: pluginLicense(input.root, manifests),
    skills,
  };
}

const COMPANION_ASSETS: { name: string; kind: PluginAssetKind }[] = [
  { name: "commands", kind: "commands" },
  { name: "agents", kind: "agents" },
  { name: "hooks", kind: "hooks" },
  { name: "rules", kind: "rules" },
  { name: "workflows", kind: "workflows" },
];

export interface PluginComposition {
  skills: string[];
  assets: PluginAssetKind[];
}

export function pluginComposition(dir: string): PluginComposition {
  const skills: string[] = [];
  const skillsRoot = path.join(dir, "skills");
  for (const entry of listDirectory(skillsRoot)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (isFile(path.join(skillsRoot, entry.name, "SKILL.md"))) skills.push(entry.name);
  }
  const assets: PluginAssetKind[] = [];
  for (const entry of COMPANION_ASSETS) {
    const target = path.join(dir, entry.name);
    if (isDirectory(target) && listDirectory(target).length > 0) assets.push(entry.kind);
  }
  for (const entry of ASSET_FILES) {
    if (isFile(path.join(dir, entry.name))) assets.push(entry.kind);
  }
  return { skills: skills.sort(), assets: [...new Set(assets)] };
}

export function isComposedPlugin(composition: PluginComposition): boolean {
  return composition.skills.length > 0 && composition.assets.length > 0;
}

export function isPluginRoot(dir: string): boolean {
  if (detectPluginManifests(dir).length > 0) return true;
  return isComposedPlugin(pluginComposition(dir));
}
