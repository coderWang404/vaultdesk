import path from "node:path";
import YAML from "yaml";
import {
  copyDirectory,
  exists,
  ensureDir,
  isDirectory,
  isFile,
  listDirectory,
  readText,
  writeTextAtomic,
} from "./fsx.js";
import { VaultDeskError } from "./errors.js";
import { parseFrontmatter, frontmatterDescription } from "./frontmatter.js";
import { openVault, validateVault } from "./vault/validate.js";
import { buildVault } from "./build.js";
import { withWriteLock } from "./vault/lockfile.js";
import { Journal } from "./journal.js";
import { readVaultFile, writeVaultFile } from "./vault/config.js";
import { readLock, writeLock } from "./vault/state.js";
import type { ImportPreview, ImportResult, ImportSkillCandidate, VaultSnapshot } from "./types.js";
import { fetchUpstream } from "./sources/fetch.js";
import type { SourceRecord } from "./types.js";
import { hashDirectory, hashText, relativeSlash } from "./fsx.js";

export function slugifyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "imported-skill";
}

function candidateFrom(dir: string, root: string): ImportSkillCandidate {
  const skillFile = path.join(dir, "SKILL.md");
  let description: string | undefined;
  let name = slugifyName(path.basename(dir));
  try {
    const parsed = parseFrontmatter(readText(skillFile));
    description = frontmatterDescription(parsed.data);
    if (typeof parsed.data.name === "string" && parsed.data.name.trim()) name = parsed.data.name.trim();
  } catch {
    // validation reports unreadable skills later
  }
  return { name, path: dir, relativePath: relativeSlash(root, dir) || ".", description };
}

export function detectImport(inputPath: string): ImportPreview {
  const root = path.resolve(inputPath);
  if (!exists(root) || !isDirectory(root)) {
    throw new VaultDeskError("vault-not-found", `Import path does not exist: ${inputPath}`);
  }
  const rootSkill = path.join(root, "SKILL.md");
  const skillDirs: string[] = [];
  if (isFile(rootSkill)) {
    skillDirs.push(root);
  } else {
    for (const entry of listDirectory(root)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (isFile(path.join(root, entry.name, "SKILL.md"))) skillDirs.push(path.join(root, entry.name));
    }
  }
  if (skillDirs.length === 0) {
    throw new VaultDeskError("invalid-input", "No SKILL.md found in this folder or its immediate subfolders.");
  }
  const skills = skillDirs.map((dir) => candidateFrom(dir, root));
  const names = skills.map((skill) => skill.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  const shape = skills.length === 1 ? "standalone" : "package";
  const kind: "collection" = "collection";
  const warnings: string[] = [];
  if (duplicates.length > 0) warnings.push(`Duplicate skill names in import: ${[...new Set(duplicates)].join(", ")}`);
  if (skills.some((skill) => !skill.description)) warnings.push("Some skills have no description in frontmatter.");
  return {
    inputPath: root,
    shape,
    kind,
    suggestedName: shape === "standalone" ? skills[0]?.name ?? slugifyName(path.basename(root)) : slugifyName(path.basename(root)),
    entrypoint: undefined,
    skills,
    targetRoot: shape === "standalone" ? `skills/${skills[0]?.name ?? ""}` : `packages/${slugifyName(path.basename(root))}`,
    conflicts: [],
    warnings,
  };
}

export async function previewImport(
  inputPath: string,
  vaultPath: string,
  name?: string,
  options: { kind?: "suite" | "collection"; entrypoint?: string } = {},
): Promise<ImportPreview> {
  const detection = detectImport(inputPath);
  const snapshot = await openVault(vaultPath);
  const sourceName = name ?? detection.suggestedName;
  const shape = options.kind ? "package" : detection.shape;
  const kind = options.kind ?? "collection";
  const entrypoint =
    kind === "suite"
      ? options.entrypoint ?? (detection.skills.length === 1 ? detection.skills[0]?.name : undefined)
      : undefined;
  if (kind === "suite" && !entrypoint) {
    throw new VaultDeskError("invalid-input", "A suite import requires --entrypoint.");
  }
  if (entrypoint && !detection.skills.some((skill) => skill.name === entrypoint)) {
    throw new VaultDeskError("invalid-input", `Entrypoint ${entrypoint} is not one of the imported skills.`);
  }
  const conflicts: string[] = [];
  if (snapshot.sources.some((source) => source.name === sourceName)) conflicts.push(`source name ${sourceName} already exists`);
  for (const skill of detection.skills) {
    if (snapshot.skills.some((entry) => entry.name === skill.name)) conflicts.push(`skill name ${skill.name} already exists`);
    const target =
      shape === "package"
        ? path.join(snapshot.path, "packages", sourceName, "skills", skill.name)
        : path.join(snapshot.path, "skills", skill.name);
    if (exists(target)) conflicts.push(`target ${relativeSlash(snapshot.path, target)} already exists`);
  }
  return {
    ...detection,
    shape,
    kind,
    suggestedName: sourceName,
    entrypoint,
    targetRoot: shape === "package" ? `packages/${sourceName}` : `skills/${detection.skills[0]?.name ?? ""}`,
    conflicts,
  };
}

function ensureNameFrontmatter(skillFile: string, name: string): void {
  const content = readText(skillFile);
  const parsed = parseFrontmatter(content);
  if (typeof parsed.data.name === "string" && parsed.data.name.trim()) return;
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (block) {
    writeTextAtomic(skillFile, content.replace(block[0], `---\nname: ${name}\n${block[1]}\n---`));
  }
}

export async function applyImport(
  inputPath: string,
  vaultPath: string,
  options: { name?: string; kind?: "suite" | "collection"; entrypoint?: string } = {},
): Promise<ImportResult> {
  const root = path.resolve(inputPath);
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before importing.");
  if (snapshot.issues.some((issue) => issue.severity === "error")) {
    throw new VaultDeskError("validation-failed", "Fix validation errors before importing.");
  }
  const preview = await previewImport(root, vaultPath, options.name, options);
  if (preview.conflicts.length > 0) {
    throw new VaultDeskError("path-conflict", "Import conflicts with existing vault content.", {
      details: preview.conflicts,
    });
  }

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "import", [
      { id: "copy", label: "Copy imported skills" },
      { id: "metadata", label: "Write source metadata" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "copy";
    const wrote: string[] = [];
    try {
      journal.start("copy");
      for (const skill of preview.skills) {
        const target =
          preview.shape === "package"
            ? path.join(vaultPath, "packages", preview.suggestedName, "skills", skill.name)
            : path.join(vaultPath, "skills", skill.name);
        if (exists(target)) throw new VaultDeskError("path-conflict", `Target already exists: ${target}`);
        ensureDir(path.dirname(target));
        copyDirectory(skill.path, target);
        ensureNameFrontmatter(path.join(target, "SKILL.md"), skill.name);
        wrote.push(relativeSlash(vaultPath, target));
      }
      journal.done("copy", `${wrote.length} skills`);

      active = "metadata";
      journal.start("metadata");
      const metadata =
        preview.shape === "standalone"
          ? {
              schema: 1,
              name: preview.suggestedName,
              shape: "standalone",
              origin: "local",
              update_mode: "review-before-apply",
              skills: [
                {
                  name: preview.skills[0]?.name,
                  target_path: `skills/${preview.skills[0]?.name}`,
                },
              ],
            }
          : {
              schema: 1,
              name: preview.suggestedName,
              shape: "package",
              kind: preview.kind,
              ...(preview.entrypoint ? { entrypoint: preview.entrypoint } : {}),
              origin: "local",
              update_mode: "review-before-apply",
              skills: preview.skills.map((skill) => ({
                name: skill.name,
                user_invocable: true,
              })),
            };
      const file = path.join(vaultPath, "sources", `${preview.suggestedName}.yml`);
      writeTextAtomic(file, YAML.stringify(metadata, { lineWidth: 0 }));
      journal.done("metadata");

      active = "build";
      journal.start("build");
      const build = await buildVault(vaultPath);
      journal.done("build", `${build.skills.length} skills`);

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
        shape: preview.shape,
        kind: preview.shape === "package" ? preview.kind : undefined,
        skillNames: preview.skills.map((skill) => skill.name),
        wrote,
      };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

function detectGithubSkills(root: string, requestedPath?: string): { base: string; skills: ImportSkillCandidate[] } {
  const base = requestedPath ? path.join(root, requestedPath) : root;
  if (!isDirectory(base)) {
    throw new VaultDeskError("upstream-not-found", `Path not found in repository: ${requestedPath ?? "."}`);
  }
  const direct = path.join(base, "SKILL.md");
  if (isFile(direct)) {
    return { base, skills: [candidateFrom(base, root)] };
  }
  const immediate = listDirectory(base)
    .filter((entry) => entry.isDirectory() && isFile(path.join(base, entry.name, "SKILL.md")))
    .map((entry) => candidateFrom(path.join(base, entry.name), root));
  if (immediate.length > 0) return { base, skills: immediate };
  const nested = listDirectory(path.join(base, "skills"))
    .filter((entry) => entry.isDirectory() && isFile(path.join(base, "skills", entry.name, "SKILL.md")))
    .map((entry) => candidateFrom(path.join(base, "skills", entry.name), root));
  if (nested.length > 0) return { base, skills: nested };
  throw new VaultDeskError("invalid-input", "Could not find SKILL.md files in this repository path.");
}

export async function previewAddGithub(
  vaultPath: string,
  input: { repo: string; ref?: string; path?: string; name?: string; kind?: "suite" | "collection"; entrypoint?: string },
): Promise<ImportPreview & { commit: string; repo: string; ref: string }> {
  const [owner, repoName] = input.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
  if (!owner || !repoName) throw new VaultDeskError("invalid-input", "repo must be owner/name");
  const ref = input.ref ?? "main";
  const pseudo = {
    name: "fetch",
    origin: "github" as const,
    shape: "package" as const,
    kind: "collection" as const,
    repo: `${owner}/${repoName}`,
    ref,
    updateMode: "review-before-apply" as const,
    workingPath: "",
    skills: [{ name: "fetch", sourcePath: input.path ?? ".", userInvocable: true, installed: [], contentHash: "", shape: "standalone" as const, origin: "github" as const, sourceName: "fetch", workingPath: "", relativePath: "", isEntrypoint: false }],
    status: "unknown" as const,
  } satisfies SourceRecord;
  const fetched = await fetchUpstream(pseudo);
  const detected = detectGithubSkills(fetched.root, input.path);
  const snapshot = await openVault(vaultPath);
  const repoSlug = slugifyName(repoName);
  const shape = (input.kind || detected.skills.length > 1 ? "package" : "standalone") as "package" | "standalone";
  const sourceName = input.name ?? (shape === "standalone" ? detected.skills[0]?.name ?? repoSlug : repoSlug);
  const kind = input.kind ?? "collection";
  const entrypoint = kind === "suite" ? input.entrypoint ?? (detected.skills.length === 1 ? detected.skills[0]?.name : undefined) : undefined;
  if (kind === "suite" && !entrypoint) throw new VaultDeskError("invalid-input", "A suite GitHub import requires --entrypoint.");
  const conflicts: string[] = [];
  if (snapshot.sources.some((source) => source.name === sourceName)) conflicts.push(`source ${sourceName} exists`);
  for (const skill of detected.skills) {
    if (snapshot.skills.some((entry) => entry.name === skill.name)) conflicts.push(`skill ${skill.name} exists`);
  }
  return {
    inputPath: fetched.root,
    shape,
    kind,
    suggestedName: sourceName,
    entrypoint,
    skills: detected.skills,
    targetRoot: shape === "package" ? `packages/${sourceName}` : `skills/${detected.skills[0]?.name}`,
    conflicts,
    warnings: [`Pinned to ${fetched.commit.slice(0, 12)} on ${ref}.`],
    commit: fetched.commit,
    repo: `${owner}/${repoName}`,
    ref,
  };
}

export async function addGithubSource(
  vaultPath: string,
  input: { repo: string; ref?: string; path?: string; name?: string; kind?: "suite" | "collection"; entrypoint?: string },
): Promise<ImportResult & { commit: string }> {
  const snapshot = await openVault(vaultPath);
  if (snapshot.format !== "v2") throw new VaultDeskError("not-writable-v1", "Migrate this vault before adding sources.");
  const preview = await previewAddGithub(vaultPath, input);
  if (preview.conflicts.length > 0) {
    throw new VaultDeskError("path-conflict", "GitHub import conflicts with existing content.", { details: preview.conflicts });
  }
  const pseudo = {
    name: "fetch",
    origin: "github" as const,
    shape: "package" as const,
    kind: "collection" as const,
    repo: preview.repo,
    ref: preview.ref,
    updateMode: "review-before-apply" as const,
    workingPath: "",
    skills: [
      {
        name: "fetch",
        sourcePath: input.path ?? ".",
        shape: "standalone" as const,
        origin: "github" as const,
        sourceName: "fetch",
        workingPath: "",
        relativePath: "",
        installed: [],
        contentHash: "",
        userInvocable: true,
        isEntrypoint: false,
      },
    ],
    status: "unknown" as const,
  } satisfies SourceRecord;
  const fetched = await fetchUpstream(pseudo);

  return withWriteLock(vaultPath, async () => {
    const journal = Journal.begin(vaultPath, "import", [
      { id: "copy", label: "Vendor and sync upstream skills" },
      { id: "metadata", label: "Write source metadata and lock" },
      { id: "build", label: "Rebuild artifacts" },
      { id: "validate", label: "Validate vault" },
    ]);
    let active = "copy";
    const wrote: string[] = [];
    try {
      journal.start("copy");
      const repoSlug = slugifyName(preview.repo.split("/")[1] ?? preview.suggestedName);
      const sourceSkills: {
        name: string;
        source_path: string;
        vendor_path: string;
        user_invocable: boolean;
      }[] = [];
      for (const candidate of preview.skills) {
        const upstream = path.join(fetched.root, candidate.relativePath);
        const vendorRel = `third_party/${repoSlug}/${candidate.name}`;
        const vendorAbs = path.join(vaultPath, vendorRel);
        const workingAbs =
          preview.shape === "package"
            ? path.join(vaultPath, "packages", preview.suggestedName, "skills", candidate.name)
            : path.join(vaultPath, "skills", candidate.name);
        ensureDir(path.dirname(vendorAbs));
        copyDirectory(upstream, vendorAbs);
        ensureDir(path.dirname(workingAbs));
        copyDirectory(upstream, workingAbs);
        sourceSkills.push({
          name: candidate.name,
          source_path: candidate.relativePath,
          vendor_path: vendorRel,
          user_invocable: true,
        });
        wrote.push(relativeSlash(vaultPath, workingAbs));
      }
      journal.done("copy", `${wrote.length} skills`);

      active = "metadata";
      journal.start("metadata");
      const metadata =
        preview.shape === "standalone"
          ? {
              schema: 1,
              name: preview.suggestedName,
              shape: "standalone",
              origin: "github",
              repo: preview.repo,
              ref: preview.ref,
              update_mode: "review-before-apply",
              skills: [
                {
                  name: sourceSkills[0]?.name,
                  source_path: sourceSkills[0]?.source_path,
                  vendor_path: sourceSkills[0]?.vendor_path,
                  target_path: `skills/${sourceSkills[0]?.name}`,
                  user_invocable: true,
                },
              ],
            }
          : {
              schema: 1,
              name: preview.suggestedName,
              shape: "package",
              kind: preview.kind,
              ...(preview.entrypoint ? { entrypoint: preview.entrypoint } : {}),
              origin: "github",
              repo: preview.repo,
              ref: preview.ref,
              content_path: `packages/${preview.suggestedName}`,
              update_mode: "review-before-apply",
              skills: sourceSkills,
            };
      writeTextAtomic(
        path.join(vaultPath, "sources", `${preview.suggestedName}.yml`),
        YAML.stringify(metadata, { lineWidth: 0 }),
      );
      const hashes: Record<string, string> = {};
      for (const skill of preview.skills) {
        const working =
          preview.shape === "package"
            ? path.join(vaultPath, "packages", preview.suggestedName, "skills", skill.name)
            : path.join(vaultPath, "skills", skill.name);
        hashes[skill.name] = hashDirectory(working);
      }
      const lock = readLock(vaultPath) ?? { schema: 1 as const, sources: {} };
      lock.sources[preview.suggestedName] = {
        commit: fetched.commit,
        hash: hashText(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))),
        skills: hashes,
      };
      writeLock(vaultPath, lock);
      journal.done("metadata");

      active = "build";
      journal.start("build");
      const build = await buildVault(vaultPath);
      journal.done("build", `${build.skills.length} skills`);

      active = "validate";
      journal.start("validate");
      const validation = await validateVault(vaultPath);
      if (!validation.ok) {
        throw new VaultDeskError("validation-failed", "Vault failed validation after adding the source.", {
          details: validation.errors,
        });
      }
      journal.done("validate");
      journal.finish();
      return {
        sourceName: preview.suggestedName,
        shape: preview.shape,
        kind: preview.shape === "package" ? preview.kind : undefined,
        skillNames: preview.skills.map((skill) => skill.name),
        wrote,
        commit: fetched.commit,
      };
    } catch (error) {
      journal.fail(active, (error as Error).message);
      throw error;
    }
  });
}

export function importTargetPath(snapshot: VaultSnapshot, preview: ImportPreview, skillName: string): string {
  return preview.shape === "package"
    ? path.join(snapshot.path, "packages", preview.suggestedName, "skills", skillName)
    : path.join(snapshot.path, "skills", skillName);
}

export function vaultTargetsReferencing(snapshot: VaultSnapshot, sourceName: string): string[] {
  return snapshot.targets.filter((target) => target.names.includes(sourceName)).map((target) => target.id);
}

export function ensureFileConflictFree(filePath: string): void {
  if (exists(filePath)) throw new VaultDeskError("path-conflict", `File already exists: ${filePath}`);
}
