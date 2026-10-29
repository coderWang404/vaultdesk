import path from "node:path";
import YAML from "yaml";
import { slugSchema } from "@vaultdesk/schema";
import {
  copyDirectory,
  exists,
  hashDirectory,
  isDirectory,
  isInside,
  listDirectory,
  relativeSlash,
  writeTextAtomic,
} from "../fsx.js";
import { VaultDeskError } from "../errors.js";
import { slugifyName } from "../import.js";
import { Journal } from "../journal.js";
import { fetchUpstream } from "../sources/fetch.js";
import type {
  ImportSkillCandidate,
  PluginImportPreview,
  PluginImportResult,
  PluginManifest,
  SourceRecord,
} from "../types.js";
import { withWriteLock } from "../vault/lockfile.js";
import { readLock, writeLock } from "../vault/state.js";
import { openVault, validateVault } from "../vault/validate.js";
import { detectPluginManifests, inspectPlugin, isComposedPlugin, isPluginRoot, pluginComposition } from "./discover.js";

interface PluginImportOptions {
  name?: string;
  contentPath?: string;
  remoteUrl?: string;
  force?: boolean;
}

function manifestName(manifests: PluginManifest[]): string | undefined {
  for (const manifest of manifests) {
    if (!manifest.parseError && manifest.name) return manifest.name;
  }
  return undefined;
}

function previewSkills(root: string, skills: { name: string; workingPath: string; description?: string }[]): ImportSkillCandidate[] {
  return skills.map((skill) => ({
    name: skill.name,
    path: skill.workingPath,
    relativePath: relativeSlash(root, skill.workingPath),
    description: skill.description,
  }));
}

function importConflicts(
  snapshot: Awaited<ReturnType<typeof openVault>>,
  sourceName: string,
): string[] {
  const conflicts: string[] = [];
  if (snapshot.sources.some((source) => source.name === sourceName)) {
    conflicts.push(`source ${sourceName} already exists`);
  }
  if (snapshot.skills.some((skill) => skill.name === sourceName)) {
    conflicts.push(`skill ${sourceName} already exists`);
  }
  if (exists(path.join(snapshot.path, "plugins", sourceName))) {
    conflicts.push(`plugins/${sourceName} already exists`);
  }
  if (exists(path.join(snapshot.path, "third_party", sourceName))) {
    conflicts.push(`third_party/${sourceName} already exists`);
  }
  return conflicts;
}

function sharedSkillWarnings(snapshot: Awaited<ReturnType<typeof openVault>>, names: string[]): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    if (snapshot.skills.some((skill) => skill.name === name)) {
      warnings.push(`Skill ${name} also exists outside this plugin; install resolution ignores plugin skills.`);
    }
  }
  return warnings;
}

export function detectLocalPlugin(inputPath: string, options: { force?: boolean } = {}): string | undefined {
  const root = path.resolve(inputPath);
  if (!isDirectory(root)) return undefined;
  if (options.force || isPluginRoot(root)) return root;
  return undefined;
}

export async function previewPluginImport(
  inputPath: string,
  vaultPath: string,
  options: PluginImportOptions = {},
): Promise<PluginImportPreview> {
  const root = path.resolve(inputPath);
  if (!isDirectory(root)) {
    throw new VaultDeskError("vault-not-found", `Import path does not exist: ${inputPath}`);
  }
  const manifests = detectPluginManifests(root);
  const composition = pluginComposition(root);
  const composed = isComposedPlugin(composition);
  if (manifests.length === 0 && !composed && !options.force) {
    throw new VaultDeskError("not-a-plugin", "No plugin manifest or plugin composition found in this folder.");
  }
  const snapshot = await openVault(vaultPath);
  const suggestedName = options.name ?? slugifyName(manifestName(manifests) ?? path.basename(root));
  if (!slugSchema.safeParse(suggestedName).success) {
    throw new VaultDeskError("invalid-input", `Plugin name must be a lowercase slug: ${suggestedName}`);
  }
  const warnings: string[] = [];
  if (manifests.length === 0) {
    warnings.push(
      composed
        ? `No plugin manifest found; detected a plugin by composition (${composition.skills.length} skill(s), ${composition.assets.join(", ")}).`
        : "No plugin manifest found; imported as a plugin because the shape was forced.",
    );
  }
  const inspected = inspectPlugin({
    root,
    vaultPath,
    sourceName: suggestedName,
    origin: "local",
    warnings,
  });
  const skills = previewSkills(root, inspected.skills);
  warnings.push(...sharedSkillWarnings(snapshot, skills.map((skill) => skill.name)));
  return {
    inputPath: root,
    shape: "plugin",
    detectedBy: manifests.length > 0 ? "manifest" : composed ? "composition" : "override",
    suggestedName,
    rootPath: root,
    relativePath: ".",
    manifests: inspected.manifests,
    assets: inspected.assets,
    skills,
    hasHooks: inspected.hasHooks,
    conflicts: importConflicts(snapshot, suggestedName),
    warnings,
  };
}

function findPluginRoots(root: string, depth = 3): string[] {
  const found: string[] = [];
  const visit = (dir: string, prefix: string, remaining: number): void => {
    if (remaining < 0) return;
    for (const entry of listDirectory(dir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isPluginRoot(abs)) found.push(rel);
      else visit(abs, rel, remaining - 1);
    }
  };
  visit(root, "", depth);
  return found;
}

function resolveFetchedPluginRoot(
  repoRoot: string,
  contentPath?: string,
  force = false,
): { root: string; relativePath: string; warnings: string[] } {
  if (contentPath) {
    const root = path.resolve(repoRoot, contentPath);
    if (!isInside(root, repoRoot)) {
      throw new VaultDeskError("invalid-input", `content_path escapes the repository: ${contentPath}`);
    }
    if (!isDirectory(root)) {
      throw new VaultDeskError("upstream-not-found", `Path not found in repository: ${contentPath}`);
    }
    if (!force && !isPluginRoot(root)) {
      throw new VaultDeskError("not-a-plugin", `No plugin manifest or plugin composition found at ${contentPath}.`);
    }
    return { root, relativePath: contentPath, warnings: [] };
  }
  if (force || isPluginRoot(repoRoot)) return { root: repoRoot, relativePath: ".", warnings: [] };
  const candidates = findPluginRoots(repoRoot);
  if (candidates.length === 1) {
    return {
      root: path.join(repoRoot, candidates[0] as string),
      relativePath: candidates[0] as string,
      warnings: [`Detected plugin root at ${candidates[0]}.`],
    };
  }
  if (candidates.length > 1) {
    throw new VaultDeskError(
      "invalid-input",
      `Repository contains multiple plugin roots; pass --path with one of: ${candidates.join(", ")}`,
    );
  }
  throw new VaultDeskError("not-a-plugin", "No plugin manifest or plugin composition found in this repository.");
}

function parseRepo(input: string): { repo?: string; remoteUrl?: string } {
  if (input.startsWith("file://") || input.startsWith("/") || input.startsWith(".")) {
    return { remoteUrl: input };
  }
  const cleaned = input.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const [owner, repoName] = cleaned.split("/");
  if (!owner || !repoName) throw new VaultDeskError("invalid-input", "repo must be owner/name");
  return { repo: `${owner}/${repoName}` };
}

export async function previewGithubPlugin(
  vaultPath: string,
  input: { repo: string; ref?: string; path?: string; name?: string; remoteUrl?: string; force?: boolean },
): Promise<PluginImportPreview & { commit: string }> {
  const parsed = parseRepo(input.repo);
  const repo = parsed.repo ?? input.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const remoteUrl = input.remoteUrl ?? parsed.remoteUrl;
  const ref = input.ref ?? "main";
  const pseudo = {
    name: "fetch",
    shape: "plugin" as const,
    origin: "github" as const,
    repo,
    remoteUrl,
    ref,
    updateMode: "review-before-apply" as const,
    workingPath: "",
    skills: [],
    status: "unknown" as const,
  } satisfies SourceRecord;
  const fetched = await fetchUpstream(pseudo);
  const resolved = resolveFetchedPluginRoot(fetched.root, input.path, input.force);
  const manifests = detectPluginManifests(resolved.root);
  const composition = pluginComposition(resolved.root);
  const composed = isComposedPlugin(composition);
  const snapshot = await openVault(vaultPath);
  const fallbackName =
    resolved.relativePath === "." ? (repo.split("/")[1] ?? path.basename(fetched.root)) : path.basename(resolved.root);
  const suggestedName = input.name ?? slugifyName(manifestName(manifests) ?? fallbackName);
  if (!slugSchema.safeParse(suggestedName).success) {
    throw new VaultDeskError("invalid-input", `Plugin name must be a lowercase slug: ${suggestedName}`);
  }
  const warnings = [...resolved.warnings, `Pinned to ${fetched.commit.slice(0, 12)} on ${ref}.`];
  if (manifests.length === 0) {
    warnings.push(
      composed
        ? `No plugin manifest found; detected a plugin by composition (${composition.skills.length} skill(s), ${composition.assets.join(", ")}).`
        : "No plugin manifest found; imported as a plugin because the shape was forced.",
    );
  }
  const inspected = inspectPlugin({
    root: resolved.root,
    vaultPath,
    sourceName: suggestedName,
    origin: "github",
    repo,
    ref,
    warnings,
  });
  const skills = previewSkills(resolved.root, inspected.skills);
  warnings.push(...sharedSkillWarnings(snapshot, skills.map((skill) => skill.name)));
  return {
    inputPath: fetched.root,
    shape: "plugin",
    detectedBy: manifests.length > 0 ? "manifest" : composed ? "composition" : "override",
    suggestedName,
    rootPath: resolved.root,
    relativePath: resolved.relativePath,
    manifests: inspected.manifests,
    assets: inspected.assets,
    skills,
    hasHooks: inspected.hasHooks,
    conflicts: importConflicts(snapshot, suggestedName),
    warnings,
    repo,
    ref,
    commit: fetched.commit,
  };
}

function sourceMetadata(input: {
  name: string;
  origin: "local" | "github";
  repo?: string;
  remoteUrl?: string;
  ref: string;
  version?: string;
  description?: string;
  contentPath?: string;
}): Record<string, unknown> {
  return {
    schema: 1,
    name: input.name,
    shape: "plugin",
    origin: input.origin,
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.remoteUrl ? { remote_url: input.remoteUrl } : {}),
    ...(input.origin === "github" ? { ref: input.ref } : {}),
    ...(input.contentPath && input.contentPath !== "." ? { content_path: input.contentPath } : {}),
    ...(input.version ? { version: input.version } : {}),
    ...(input.description ? { description: input.description } : {}),
    update_mode: "review-before-apply",
    skills: [],
  };
}

function manifestVersion(manifests: PluginManifest[]): string | undefined {
  for (const manifest of manifests) {
    if (!manifest.parseError && manifest.version) return manifest.version;
  }
  return undefined;
}

function manifestDescription(manifests: PluginManifest[]): string | undefined {
  for (const manifest of manifests) {
    if (!manifest.parseError && manifest.description) return manifest.description;
  }
  return undefined;
}

export function refreshPluginSourceMetadata(
  vaultPath: string,
  source: SourceRecord,
  manifests: PluginManifest[],
): void {
  if (!source.metadataPath) return;
  writeTextAtomic(
    source.metadataPath,
    YAML.stringify(
      sourceMetadata({
        name: source.name,
        origin: source.origin,
        repo: source.repo,
        remoteUrl: source.remoteUrl,
        ref: source.ref,
        version: manifestVersion(manifests),
        description: manifestDescription(manifests),
        contentPath: source.contentPath,
      }),
      { lineWidth: 0 },
    ),
  );
}

async function assertImportable(vaultPath: string): Promise<void> {
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before importing.");
  if (snapshot.issues.some((issue) => issue.severity === "error")) {
    throw new VaultDeskError("validation-failed", "Fix validation errors before importing.");
  }
}

export async function applyPluginImport(
  inputPath: string,
  vaultPath: string,
  options: PluginImportOptions = {},
): Promise<PluginImportResult> {
  await assertImportable(vaultPath);
  const preview = await previewPluginImport(inputPath, vaultPath, options);
  if (preview.conflicts.length > 0) {
    throw new VaultDeskError("path-conflict", "Plugin import conflicts with existing vault content.", {
      details: preview.conflicts,
    });
  }
  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "import", [
      { id: "copy", label: "Copy plugin root" },
      { id: "metadata", label: "Write source metadata" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "copy";
    try {
      journal.start("copy");
      const target = path.join(vaultPath, "plugins", preview.suggestedName);
      if (exists(target)) throw new VaultDeskError("path-conflict", `Target already exists: ${target}`);
      copyDirectory(preview.rootPath, target);
      journal.done("copy", "plugin root");

      active = "metadata";
      journal.start("metadata");
      writeTextAtomic(
        path.join(vaultPath, "sources", `${preview.suggestedName}.yml`),
        YAML.stringify(
          sourceMetadata({
            name: preview.suggestedName,
            origin: "local",
            ref: "main",
            version: manifestVersion(preview.manifests),
            description: manifestDescription(preview.manifests),
          }),
          { lineWidth: 0 },
        ),
      );
      journal.done("metadata");

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Imported vault failed validation.", {
          details: validation.errors,
        });
      }
      journal.done("validate");
      journal.finish();
      return {
        sourceName: preview.suggestedName,
        shape: "plugin",
        skillNames: preview.skills.map((skill) => skill.name),
        wrote: [relativeSlash(vaultPath, target)],
      };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

export async function addGithubPlugin(
  vaultPath: string,
  input: { repo: string; ref?: string; path?: string; name?: string; remoteUrl?: string; force?: boolean },
): Promise<PluginImportResult & { commit: string }> {
  await assertImportable(vaultPath);
  const preview = await previewGithubPlugin(vaultPath, input);
  if (preview.conflicts.length > 0) {
    throw new VaultDeskError("path-conflict", "Plugin import conflicts with existing vault content.", {
      details: preview.conflicts,
    });
  }
  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "import", [
      { id: "copy", label: "Vendor and sync upstream plugin" },
      { id: "metadata", label: "Write source metadata and lock" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "copy";
    try {
      journal.start("copy");
      const vendor = path.join(vaultPath, "third_party", preview.suggestedName);
      const working = path.join(vaultPath, "plugins", preview.suggestedName);
      for (const target of [vendor, working]) {
        if (exists(target)) throw new VaultDeskError("path-conflict", `Target already exists: ${target}`);
      }
      copyDirectory(preview.rootPath, vendor);
      copyDirectory(preview.rootPath, working);
      journal.done("copy", "plugin root");

      active = "metadata";
      journal.start("metadata");
      writeTextAtomic(
        path.join(vaultPath, "sources", `${preview.suggestedName}.yml`),
        YAML.stringify(
          sourceMetadata({
            name: preview.suggestedName,
            origin: "github",
            repo: preview.repo,
            remoteUrl: input.remoteUrl,
            ref: preview.ref ?? "main",
            version: manifestVersion(preview.manifests),
            description: manifestDescription(preview.manifests),
            contentPath: preview.relativePath,
          }),
          { lineWidth: 0 },
        ),
      );
      const inspected = inspectPlugin({
        root: working,
        vaultPath,
        sourceName: preview.suggestedName,
        origin: "github",
        repo: preview.repo,
        ref: preview.ref,
        warnings: [],
      });
      const skillHashes: Record<string, string> = {};
      for (const skill of inspected.skills) {
        skillHashes[skill.name] = hashDirectory(skill.workingPath);
      }
      const lock = readLock(vaultPath) ?? { schema: 1 as const, sources: {} };
      lock.sources[preview.suggestedName] = {
        commit: preview.commit,
        hash: hashDirectory(working),
        skills: skillHashes,
      };
      writeLock(vaultPath, lock);
      journal.done("metadata");

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Vault failed validation after adding the plugin.", {
          details: validation.errors,
        });
      }
      journal.done("validate");
      journal.finish();
      return {
        sourceName: preview.suggestedName,
        shape: "plugin",
        skillNames: inspected.skills.map((skill) => skill.name),
        wrote: [relativeSlash(vaultPath, vendor), relativeSlash(vaultPath, working)],
        commit: preview.commit,
      };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}
