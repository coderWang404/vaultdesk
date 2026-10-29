import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VaultDeskError,
  addGithubPlugin,
  addGithubSource,
  adoptPendingSkills,
  autoSyncVault,
  adoptExternalSkill,
  applyImport,
  applyMigration,
  applyPluginImport,
  buildVault,
  checkSources,
  commitPaths,
  detectLocalPlugin,
  distributeCurrentSource,
  expandHome,
  externalSkillCardPath,
  forkSkill,
  hashDirectory,
  initVault,
  installSkills,
  isDirectory,
  isFile,
  isInside,
  listPresets,
  listPendingSkills,
  openVault,
  parseExternalSkillCard,
  parseToolCard,
  planInstall,
  planMigration,
  previewAddGithub,
  previewAdoptExternal,
  previewFork,
  previewGithubPlugin,
  previewImport,
  previewPluginImport,
  previewPresetVerify,
  previewUpdate,
  push,
  readVaultFile,
  readBundledAgentSkill,
  removeSource,
  removePluginTarget,
  removeTarget,
  resolveCommitPaths,
  restoreBackup,
  registerPluginTarget,
  runPresetVerifyCommand,
  serializeError,
  setSourceUpdateMode,
  sourceDiff,
  toolCardPath,
  updateSources,
  validateVault,
  verifyTarget,
  withWriteLock,
  writeExternalSkillCard,
  writeExternalSkillsArtifact,
  writeToolCard,
  writeToolsArtifact,
  type AdoptPreview,
  type CheckReport,
  type ExternalSkillRecord,
  type ForkPreview,
  type ImportPreview,
  type InstallResult,
  type MigrationPlan,
  type MigrationResult,
  type PluginImportPreview,
  type PluginRecord,
  type SourceDiff,
  type SourceRecord,
  type ToolRecord,
  type UpdateResult,
  type ValidationReport,
  type VaultSnapshot,
} from "@vaultdesk/core";
import { toolKindSchema } from "@vaultdesk/schema";

const VALUE_FLAGS = new Set([
  "vault",
  "name",
  "mode",
  "kind",
  "entrypoint",
  "dest",
  "id",
  "repo",
  "ref",
  "path",
  "as",
  "backup",
  "message",
  "title",
  "summary",
  "homepage",
  "docs",
  "recorded-version",
  "install-command",
  "run",
  "requirement",
  "related-skill",
  "tag",
  "notes",
  "owner",
  "owner-version",
  "related-tool",
  "expected-hash",
  "description",
]);
const BOOLEAN_FLAGS = new Set([
  "json",
  "yes",
  "commit",
  "install",
  "force",
  "delete-files",
  "dry-run",
  "full",
  "git",
  "no-state",
  "plugin",
  "no-plugin",
  "pin",
  "help",
  "version",
]);

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, text: string): string => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (text: string): string => paint("1", text);
const dim = (text: string): string => paint("2", text);
const red = (text: string): string => paint("31", text);
const green = (text: string): string => paint("32", text);
const yellow = (text: string): string => paint("33", text);
const cyan = (text: string): string => paint("36", text);

interface Parsed {
  positionals: string[];
  flags: Map<string, string[]>;
  json: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  vaultArg?: string;
}

function parseArgs(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let stopFlags = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (stopFlags) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      stopFlags = true;
      continue;
    }
    if (token === "-y") {
      flags.set("yes", []);
      continue;
    }
    if (token === "-h") {
      flags.set("help", []);
      continue;
    }
    if (token === "-v") {
      flags.set("version", []);
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = token.slice(2, equals === -1 ? undefined : equals);
    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new VaultDeskError("invalid-input", `Flag --${name} does not take a value.`);
      flags.set(name, []);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new VaultDeskError("invalid-input", `Unknown flag: --${name}`);
    }
    let value: string;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined) throw new VaultDeskError("invalid-input", `Flag --${name} requires a value.`);
      value = next;
      index += 1;
    }
    const existing = flags.get(name) ?? [];
    existing.push(value);
    flags.set(name, existing);
  }
  return {
    positionals,
    flags,
    json: flags.has("json"),
    yes: flags.has("yes"),
    help: flags.has("help"),
    version: flags.has("version"),
    vaultArg: flags.get("vault")?.[0],
  };
}

function valueOf(parsed: Parsed, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function valuesOf(parsed: Parsed, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

function hasFlag(parsed: Parsed, name: string): boolean {
  return parsed.flags.has(name);
}

function version(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "1.2.2";
  } catch {
    return "1.2.2";
  }
}

function bundledAgentSkillDir(): string {
  const override = process.env.VAULTDESK_AGENT_SKILL_DIR;
  if (override) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "agent-skill", "vaultdesk"),
    path.resolve(here, "../../../agent-skill/vaultdesk"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "SKILL.md")));
  if (!found) {
    throw new VaultDeskError("operation-failed", "The bundled agent skill is missing from this build.");
  }
  return found;
}

const HELP = `VaultDesk ${version()}
Local-first vault for agent skills, plugins, and external tool records.

Usage:
  vaultdesk <group> <action> [arguments] [options]

Commands:
  vault status                     Inspect the vault, validation, and recovery state
  vault validate                   Validate metadata and working copies
  vault migrate [--yes] [--full]   Preview or apply the v1 -> v2 migration
  vault init [path] [--git]        Create an empty v2 vault
  source list                      List sources and their state
  source show <name>               Show one source and its skills
  source check [names...]          Check upstream commits and update local check state
  source diff <name>               Show the upstream diff for one source
  source update [names...]         Preview or apply upstream updates
  source auto-sync [--yes]         Update, distribute, commit and push auto sources
  source pending <name>            Show unregistered upstream skill paths
  source adopt <name> --path <path>... --yes
                                   Accept selected new skills from a Git source
  source distribute <name> --yes   Distribute a current source to managed targets
  source mode <name> --mode <mode> --yes
                                   Set auto, review-before-apply or frozen
  source add <path> [--plugin|--no-plugin]
                                   Import a local folder, plugin root, or skill suite
  source add --repo owner/name     Add a GitHub source or plugin (preview by default)
  source remove <name>             Remove a source registration
  source fork <skill> [--as name]  Fork a GitHub skill into a local skill
  plugin list                      List registered plugins, assets, and status
  plugin show <name>               Show one plugin, its manifests, and contained skills
  plugin target list               List explicitly registered plugin targets
  plugin target add <names...> --id <id> --dest <dir> --yes
  plugin target remove <id> --yes [--delete-files]
  build                            Preview or rebuild build/skills
  target list                      List install targets
  target install <names...> --dest <dir> [--id id]
  target remove <id>               Unregister a target; optionally move files to backup
  target verify <id>               Verify files in place (no tool discovery claim)
  target restore <id> --backup <path> --name <skill>
  agent skill                      Print the agent skill bundled with VaultDesk
  git status                       Show branch, HEAD, and changes
  git commit --path <path>... --message <text>
  git push                         Push the current branch
  presets list                     List candidate tool locations (unverified)
  presets verify <id> [--yes]      Preview or run an optional preset verify_command
  tool list [--kind <kind>]        List recorded external tool cards
  tool show <name>                 Show one tool card, install methods, and links
  tool add <name> [options]        Record an external tool card (preview by default)
  external list                    List tool-managed skills and observed state
  external show <name>             Show one external skill record
  external add <name> [options]    Record a tool-managed skill (preview by default)
  external remove <name>           Remove an external skill record (files stay)
  external adopt <skill> [options] Convert a standalone managed skill to external

Tool card options (tool add):
  --kind plugin|mcp|cli|app  --title <text>  --summary <text>  --homepage <url>
  --install-command <label=command> (repeat)  --docs <url>  --recorded-version <v>
  --run <command>  --requirement <text> (repeat)  --related-skill <name> (repeat)
  --tag <tag> (repeat)  --notes <text>  --force

External skill options (external add / adopt):
  --owner <name>  --path <dir>  --title <text>  --owner-version <v>
  --related-tool <name>  --expected-hash <sha256:...>  --pin
  --description <text>  --notes <text>  --force (add only)

Global options:
  --vault <path>   Vault directory (default: current directory)
  --json           Print one JSON envelope on stdout
  --yes, -y        Apply a write operation; without it, commands preview
  --help, -h       Show this help
  --version, -v    Show the version

Exit codes:
  0 success   1 operation failed   2 usage or validation   3 network or authentication

Safety:
  Manual writes require --yes. GitHub-origin skills are read-only until forked.
  Auto sources update registered destinations in the background; review and frozen modes do not.
  Automatic sync never overwrites unknown or manually edited directories.
  External skills are owned by their tools; VaultDesk records the path and only observes it.
`;

interface CommandResult {
  data: unknown;
  warnings: string[];
  human: string[];
  exitCode?: number;
}

function vaultPathOf(parsed: Parsed, override?: string): string {
  return path.resolve(expandHome(override ?? parsed.vaultArg ?? process.cwd()));
}

function notice(parsed: Parsed): string {
  return parsed.yes ? "" : dim("Preview only. Re-run with --yes to apply.");
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (row: string[]): string =>
    row.map((cell, column) => (cell ?? "").padEnd(widths[column] ?? 0)).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)];
}

function issueLines(report: ValidationReport): string[] {
  const lines: string[] = [];
  for (const issue of report.errors) {
    lines.push(`${red("error")} ${issue.code}${issue.path ? ` ${dim(issue.path)}` : ""}\n  ${issue.message}`);
  }
  for (const issue of report.warnings) {
    lines.push(`${yellow("warning")} ${issue.code}${issue.path ? ` ${dim(issue.path)}` : ""}\n  ${issue.message}`);
  }
  return lines;
}

function statusText(status: string): string {
  switch (status) {
    case "current":
      return green("current");
    case "update-available":
      return cyan("update-available");
    case "not-downloaded":
      return yellow("not-downloaded");
    case "auth-failed":
      return red("auth-failed");
    case "error":
      return red("error");
    case "local":
      return dim("local");
    default:
      return dim(status);
  }
}

function shapeText(shape: SourceRecord["shape"], kind?: SourceRecord["kind"]): string {
  if (shape === "plugin") return "plugin";
  if (shape === "package") return `package/${kind ?? "?"}`;
  return "standalone";
}

function printSnapshot(snapshot: VaultSnapshot): string[] {
  const lines: string[] = [];
  const mode = snapshot.readOnly ? "read-only" : "writable";
  lines.push(bold(`${snapshot.name}`) + `  ${dim(`v${snapshot.schemaVersion} · ${mode}`)}`);
  lines.push(dim(snapshot.path));
  lines.push("");
  const git = snapshot.git;
  lines.push(
    `Git      ${
      git.isRepo
        ? `${git.branch ?? "detached"} @ ${(git.head ?? "").slice(0, 12)}${git.dirty ? ` ${yellow("dirty")}` : ` ${green("clean")}`}`
        : dim("not a repository")
    }`,
  );
  lines.push(
    `Sources  ${snapshot.counts.sources} sources · ${snapshot.counts.packages} packages · ${snapshot.counts.skills} skills · ${snapshot.counts.plugins} plugins · ${snapshot.counts.pluginSkills} plugin skills`,
  );
  lines.push(`Tools    ${snapshot.counts.tools} external tool cards · ${snapshot.tools.filter((tool) => tool.kind === "mcp").length} MCP`);
  lines.push(
    `External ${snapshot.counts.externalSkills} tool-managed skills · ${
      snapshot.externalSkills.filter((skill) => skill.status !== "ok" && skill.status !== "observed").length
    } need attention`,
  );
  lines.push(
    `Targets  ${snapshot.counts.targets} targets · ${snapshot.counts.managedInstalls} managed installs`,
  );
  if (snapshot.operation) {
    lines.push("");
    lines.push(
      yellow(
        `An unfinished ${snapshot.operation.kind} operation was recorded on ${snapshot.operation.started_at}. Review .vault/operation.json.`,
      ),
    );
  }
  if (snapshot.sources.length > 0) {
    lines.push("");
    lines.push(bold("Sources"));
    lines.push(
      ...table(
        ["NAME", "SHAPE", "ORIGIN", "REF", "COMMIT", "SKILLS", "STATUS"],
        snapshot.sources.map((source) => [
          source.name,
          shapeText(source.shape, source.kind),
          source.origin,
          source.origin === "github" ? source.ref : "-",
          source.locked?.commit ? source.locked.commit.slice(0, 12) : "-",
          String(
            source.shape === "plugin"
              ? (snapshot.plugins.find((plugin) => plugin.name === source.name)?.skills.length ?? 0)
              : source.skills.length,
          ),
          statusText(source.status),
        ]),
      ),
    );
    for (const source of snapshot.sources) {
      if (source.lastError) lines.push(red(`${source.name}: ${source.lastError}`));
    }
  }
  if (snapshot.targets.length > 0) {
    lines.push("");
    lines.push(bold("Targets"));
    lines.push(
      ...table(
        ["ID", "DEST", "SKILLS", "EXISTS"],
        snapshot.targets.map((target) => [
          target.id,
          target.dest,
          String(target.skills.length),
          target.exists ? "yes" : red("missing"),
        ]),
      ),
    );
  }
  const errors = snapshot.issues.filter((issue) => issue.severity === "error");
  const warnings = snapshot.issues.filter((issue) => issue.severity === "warning");
  if (errors.length > 0 || warnings.length > 0) {
    lines.push("");
    for (const issue of [...errors, ...warnings]) {
      const label = issue.severity === "error" ? red("error") : yellow("warning");
      lines.push(`${label} ${issue.code}${issue.path ? ` ${dim(issue.path)}` : ""}\n  ${issue.message}`);
    }
  }
  return lines;
}

function printValidation(report: ValidationReport): string[] {
  const lines: string[] = [];
  if (report.ok && report.warnings.length === 0) {
    lines.push(green("Validation passed with no warnings."));
    return lines;
  }
  lines.push(report.ok ? green("Validation passed.") : red("Validation failed."));
  lines.push(`${report.errors.length} errors · ${report.warnings.length} warnings`);
  if (report.errors.length || report.warnings.length) {
    lines.push("");
    lines.push(...issueLines(report));
  }
  return lines;
}

function printSource(source: SourceRecord, plugin?: PluginRecord): string[] {
  const lines: string[] = [];
  const shape = shapeText(source.shape, source.kind);
  lines.push(bold(source.name) + `  ${dim(`${shape} · ${source.origin} · ${statusText(source.status)}`)}`);
  if (source.description) lines.push(source.description);
  lines.push("");
  if (source.origin === "github") {
    lines.push(`Repo     ${source.repo ?? "-"}${source.remoteUrl ? dim(` (${source.remoteUrl})`) : ""}`);
    lines.push(`Ref      ${source.ref}`);
    lines.push(`Commit   ${source.locked?.commit ?? dim("not pinned")}`);
  }
  if (source.contentPath) lines.push(`Content  ${source.contentPath}`);
  if (source.entrypoint) lines.push(`Entry    ${source.entrypoint}`);
  if (source.version) lines.push(`Version  ${source.version}`);
  if (source.lastCheckedAt) lines.push(`Checked  ${source.lastCheckedAt}`);
  if (source.lastAppliedAt) lines.push(`Applied  ${source.lastAppliedAt}`);
  if (source.lastError) lines.push(red(`Error    ${source.lastError}`));
  if (plugin) {
    lines.push(`Files    ${plugin.workingPath}`);
    lines.push(
      `Plugin   ${plugin.manifests.length} manifests · ${plugin.assets.length} assets · ${plugin.skills.length} contained skills${plugin.hasHooks ? ` ${yellow("hooks present")}` : ""}`,
    );
  }
  lines.push("");
  lines.push(bold("Skills"));
  lines.push(
    ...table(
      ["NAME", "ENTRY", "INVOCABLE", "INSTALLED", "HASH"],
      (plugin ? plugin.skills : source.skills).map((skill) => [
        skill.name,
        skill.isEntrypoint ? "yes" : "-",
        skill.userInvocable ? "yes" : "no",
        skill.installed.map((entry) => entry.targetId).join(", ") || "-",
        (skill.contentHash || "").replace(/^sha256:/, "").slice(0, 10) || "-",
      ]),
    ),
  );
  return lines;
}

function printDiff(diff: SourceDiff): string[] {
  const lines: string[] = [];
  lines.push(
    bold(`${diff.name}: ${diff.files.length} changed files`) +
      `  ${dim(`${diff.summary.added} added · ${diff.summary.modified} modified · ${diff.summary.deleted} deleted · ${diff.summary.binary} binary`)}`,
  );
  lines.push(dim(`${(diff.fromCommit ?? "unpinned").slice(0, 12)} -> ${diff.toCommit.slice(0, 12)}`));
  for (const warning of diff.warnings) lines.push(yellow(`warning: ${warning}`));
  for (const file of diff.files) {
    const marker =
      file.status === "added"
        ? green("+")
        : file.status === "deleted"
          ? red("-")
          : file.status === "type-changed"
            ? yellow("~")
            : cyan("M");
    lines.push("");
    lines.push(`${marker} ${bold(file.path)}  ${dim(`${file.status} · ${file.bytesBefore} -> ${file.bytesAfter} bytes`)}`);
    if (file.binary) {
      lines.push(dim("binary file; content not shown"));
    } else if (file.truncated) {
      lines.push(dim("patch omitted: file is too large"));
    } else if (file.patch) {
      for (const line of file.patch.split("\n").slice(2)) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) lines.push(green(line));
        else if (line.startsWith("-")) lines.push(red(line));
        else if (line.startsWith("@@")) lines.push(cyan(line));
        else lines.push(line);
      }
    }
  }
  return lines;
}

function printCheck(report: CheckReport): string[] {
  const lines: string[] = [
    ...table(
      ["NAME", "ORIGIN", "STATUS", "LOCAL", "REMOTE"],
      report.results.map((result) => [
        result.name,
        result.origin,
        statusText(result.status),
        result.currentCommit ? result.currentCommit.slice(0, 12) : "-",
        result.remoteCommit ? result.remoteCommit.slice(0, 12) : "-",
      ]),
    ),
    "",
    dim(`Checked at ${report.checkedAt}`),
  ];
  for (const result of report.results) {
    if (result.message) lines.push(yellow(`${result.name}: ${result.message}`));
  }
  return lines;
}

function printPlan(result: InstallResult): string[] {
  const lines: string[] = [];
  lines.push(bold(`Install plan for ${result.targetId}`));
  lines.push(dim(result.dest));
  lines.push("");
  lines.push(
    ...table(
      ["SKILL", "STATE", "ACTION", "BACKUP"],
      result.plan.slots.map((slot) => [
        slot.skill,
        slot.state,
        slot.action,
        slot.backupPath ?? "-",
      ]),
    ),
  );
  if (result.plan.warnings.length > 0) {
    lines.push("");
    for (const warning of result.plan.warnings) lines.push(yellow(`warning: ${warning}`));
  }
  if (result.installed > 0) {
    lines.push("");
    lines.push(green(`Installed ${result.installed} skills.`));
    const verification = result.verification;
    lines.push(
      verification.filesInPlace
        ? green("Files in place.")
        : red(`Verification found differences: ${verification.missing.length} missing, ${verification.modified.length} modified.`),
    );
  }
  return lines;
}

function printMigration(plan: MigrationPlan | MigrationResult, full: boolean): string[] {
  const actual = "plan" in plan ? plan.plan : plan;
  const lines: string[] = [];
  lines.push(bold(`Migration v1 -> v2`) + `  ${dim(actual.vaultPath)}`);
  lines.push(`Branch   ${actual.branch}`);
  lines.push(`Writes   ${actual.writes.length}`);
  for (const write of actual.writes) lines.push(`  ${green("+")} ${write.path}`);
  lines.push(`Deletes  ${actual.deletes.length}`);
  for (const deleted of actual.deletes) lines.push(`  ${red("-")} ${deleted}`);
  lines.push(`Keeps    ${actual.unaffected.join(", ")}`);
  lines.push(
    `State    ${
      actual.cleanWorktree ? green("worktree clean") : red("worktree must be clean before applying")
    }`,
  );
  for (const warning of actual.warnings) lines.push(yellow(`warning: ${warning}`));
  if (full) {
    lines.push("");
    lines.push(actual.diff);
  } else {
    lines.push("");
    lines.push(dim("Run with --full to print the complete unified diff."));
  }
  if ("commit" in plan && plan.commit) {
    lines.push("");
    lines.push(green(`Committed ${plan.commit.slice(0, 12)} on ${plan.branch}. Not pushed.`));
  }
  return lines;
}

function printImport(preview: ImportPreview & { commit?: string; repo?: string }): string[] {
  const lines: string[] = [];
  const shape = preview.shape === "package" ? `package/${preview.kind}` : "standalone";
  lines.push(bold(`Import ${preview.suggestedName}`) + `  ${dim(shape)}`);
  lines.push(dim(preview.inputPath));
  if (preview.repo) lines.push(`Repo     ${preview.repo}${preview.commit ? ` @ ${preview.commit.slice(0, 12)}` : ""}`);
  lines.push(`Target   ${preview.targetRoot}`);
  if (preview.entrypoint) lines.push(`Entry    ${preview.entrypoint}`);
  lines.push("");
  lines.push(
    ...table(
      ["SKILL", "PATH", "DESCRIPTION"],
      preview.skills.map((skill) => [
        skill.name,
        skill.relativePath,
        (skill.description ?? "").slice(0, 70),
      ]),
    ),
  );
  if (preview.conflicts.length > 0) {
    lines.push("");
    for (const conflict of preview.conflicts) lines.push(red(`conflict: ${conflict}`));
  }
  for (const warning of preview.warnings) lines.push(yellow(`warning: ${warning}`));
  return lines;
}

function printPluginImport(preview: PluginImportPreview): string[] {
  const lines: string[] = [];
  lines.push(bold(`Import plugin ${preview.suggestedName}`));
  lines.push(dim(preview.inputPath));
  if (preview.repo) {
    lines.push(`Repo     ${preview.repo}${preview.commit ? ` @ ${preview.commit.slice(0, 12)}` : ""}`);
  }
  lines.push(`Root     ${preview.relativePath}`);
  lines.push(`Target   plugins/${preview.suggestedName}`);
  lines.push(
    `Detected ${
      preview.detectedBy === "manifest"
        ? "manifest"
        : preview.detectedBy === "composition"
          ? "composition (skills + MCP/commands/agents/hooks)"
          : "forced override"
    }`,
  );
  lines.push("");
  lines.push(bold("Manifests"));
  if (preview.manifests.length === 0) {
    lines.push(dim(preview.detectedBy === "override" ? "None (shape forced)" : "None (detected by composition)"));
  } else {
    lines.push(
      ...table(
        ["AGENT", "NAME", "VERSION", "PATH"],
        preview.manifests.map((manifest) => [
          manifest.agent,
          manifest.name ?? "-",
          manifest.version ?? "-",
          manifest.relativePath + (manifest.parseError ? ` ${red("invalid")}` : ""),
        ]),
      ),
    );
  }
  const assetKinds = new Map<string, number>();
  for (const asset of preview.assets) assetKinds.set(asset.kind, (assetKinds.get(asset.kind) ?? 0) + 1);
  lines.push("");
  lines.push(
    `Assets   ${[...assetKinds.entries()].map(([kind, count]) => `${count} ${kind}`).join(" · ") || "-"}`,
  );
  if (preview.hasHooks) lines.push(yellow("Hooks are present and will never be executed by VaultDesk."));
  lines.push("");
  lines.push(bold("Contained skills"));
  lines.push(
    ...table(
      ["SKILL", "PATH", "DESCRIPTION"],
      preview.skills.map((skill) => [skill.name, skill.relativePath, (skill.description ?? "").slice(0, 60)]),
    ),
  );
  if (preview.conflicts.length > 0) {
    lines.push("");
    for (const conflict of preview.conflicts) lines.push(red(`conflict: ${conflict}`));
  }
  for (const warning of preview.warnings) lines.push(yellow(`warning: ${warning}`));
  return lines;
}

function printPlugin(plugin: PluginRecord): string[] {
  const lines: string[] = [];
  lines.push(bold(plugin.name) + `  ${dim(`${plugin.origin} · ${statusText(plugin.status)}`)}`);
  if (plugin.description) lines.push(plugin.description);
  lines.push("");
  if (plugin.origin === "github") {
    lines.push(`Repo     ${plugin.repo ?? "-"}`);
    lines.push(`Ref      ${plugin.ref}`);
    lines.push(`Commit   ${plugin.locked?.commit ?? dim("not pinned")}`);
  }
  if (plugin.contentPath) lines.push(`Content  ${plugin.contentPath}`);
  if (plugin.version) lines.push(`Version  ${plugin.version}`);
  if (plugin.license) lines.push(`License  ${plugin.license}`);
  lines.push(`Files    ${plugin.workingPath}`);
  if (plugin.vendorRoot) lines.push(`Vendor   ${plugin.vendorRoot}`);
  if (plugin.lastCheckedAt) lines.push(`Checked  ${plugin.lastCheckedAt}`);
  if (plugin.lastAppliedAt) lines.push(`Applied  ${plugin.lastAppliedAt}`);
  if (plugin.lastError) lines.push(red(`Error    ${plugin.lastError}`));
  lines.push("");
  lines.push(bold("Manifests"));
  lines.push(
    ...table(
      ["AGENT", "NAME", "VERSION", "PATH"],
      plugin.manifests.map((manifest) => [
        manifest.agent,
        manifest.name ?? "-",
        manifest.version ?? "-",
        manifest.relativePath + (manifest.parseError ? ` ${red("invalid")}` : ""),
      ]),
    ),
  );
  lines.push("");
  lines.push(bold("Assets"));
  if (plugin.assets.length === 0) lines.push(dim("No assets discovered."));
  else {
    lines.push(...table(["KIND", "PATH"], plugin.assets.map((asset) => [asset.kind, asset.relativePath])));
  }
  if (plugin.otherCount > 0) lines.push(dim(`${plugin.otherCount} other entries at the plugin root.`));
  if (plugin.hasHooks) lines.push(yellow("Hooks are present. VaultDesk stores them and never executes them."));
  lines.push("");
  lines.push(bold("Contained skills"));
  if (plugin.skills.length === 0) lines.push(dim("No skills inside this plugin."));
  else {
    lines.push(
      ...table(
        ["NAME", "INVOCABLE", "HASH"],
        plugin.skills.map((skill) => [
          skill.name,
          skill.userInvocable ? "yes" : "no",
          (skill.contentHash || "").replace(/^sha256:/, "").slice(0, 10) || "-",
        ]),
      ),
    );
  }
  return lines;
}

function pluginPayload(vaultPath: string, plugin: PluginRecord): Record<string, unknown> {
  return {
    name: plugin.name,
    origin: plugin.origin,
    ...(plugin.repo ? { repo: plugin.repo } : {}),
    ...(plugin.ref ? { ref: plugin.ref } : {}),
    ...(plugin.contentPath ? { contentPath: plugin.contentPath } : {}),
    ...(plugin.locked?.commit ? { commit: plugin.locked.commit } : {}),
    status: plugin.status,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.license ? { license: plugin.license } : {}),
    rootPath: plugin.workingPath,
    ...(plugin.vendorRoot ? { vendorPath: plugin.vendorRoot } : {}),
    vaultPath,
    manifests: plugin.manifests,
    assets: plugin.assets,
    hasHooks: plugin.hasHooks,
    containedSkills: plugin.skills.map((skill) => ({
      name: skill.name,
      path: skill.workingPath,
      relativePath: skill.relativePath,
      ...(skill.description ? { description: skill.description } : {}),
    })),
    ...(plugin.locked ? { locked: plugin.locked } : {}),
    ...(plugin.lastCheckedAt ? { lastCheckedAt: plugin.lastCheckedAt } : {}),
    ...(plugin.lastAppliedAt ? { lastAppliedAt: plugin.lastAppliedAt } : {}),
    ...(plugin.lastError ? { lastError: plugin.lastError } : {}),
  };
}

function printFork(preview: ForkPreview): string[] {
  const lines: string[] = [];
  lines.push(bold(`Fork ${preview.skill}`) + `  ${dim(`${preview.sourceName} -> ${preview.newSourceName}`)}`);
  lines.push(`Target   ${preview.targetPath}`);
  if (preview.from) {
    lines.push(`From     ${preview.from.repo}@${preview.from.commit?.slice(0, 12) ?? preview.from.ref}`);
  }
  if (preview.removesFromPackage) lines.push(yellow("The skill will be detached from its package."));
  for (const warning of preview.warnings) lines.push(yellow(`warning: ${warning}`));
  return lines;
}

function printPresets(): string[] {
  const presets = listPresets();
  return [
    ...table(
      ["ID", "LABEL", "DEST", "VERIFICATION"],
      presets.map((preset) => [
        preset.id,
        preset.label,
        preset.dest,
        preset.verified_at ? green(`verified ${preset.verified_at}`) : yellow("unverified candidate"),
      ]),
    ),
    "",
    dim("Locations are candidates only. Confirm your tool's current discovery rules before installing."),
  ];
}

function toolKindText(kind: ToolRecord["kind"]): string {
  switch (kind) {
    case "plugin":
      return "plugin";
    case "mcp":
      return "mcp";
    case "cli":
      return "cli";
    case "app":
      return "app";
  }
}

function printTool(tool: ToolRecord): string[] {
  const lines: string[] = [];
  const tags = tool.tags.length > 0 ? ` · ${tool.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  lines.push(bold(tool.name) + `  ${dim(`${toolKindText(tool.kind)}${tags}`)}`);
  lines.push(tool.title);
  lines.push(tool.summary);
  lines.push("");
  lines.push(`Homepage ${tool.homepage}`);
  if (tool.docs) lines.push(`Docs     ${tool.docs}`);
  if (tool.recorded_version) lines.push(`Version  ${tool.recorded_version}`);
  lines.push("");
  lines.push(bold("Install"));
  for (const method of tool.install) lines.push(`  ${method.label.padEnd(10)} ${method.command}`);
  if (tool.run) {
    lines.push("");
    lines.push(bold(tool.kind === "mcp" ? "Connect" : "Run"));
    lines.push(`  ${tool.run}`);
  }
  if (tool.requirements.length > 0) {
    lines.push("");
    lines.push(bold("Requirements"));
    for (const requirement of tool.requirements) lines.push(`  ${requirement}`);
  }
  if (tool.related_skills.length > 0) {
    lines.push("");
    lines.push(`Related skills ${tool.related_skills.join(", ")}`);
  }
  if (tool.notes) {
    lines.push("");
    lines.push(tool.notes);
  }
  lines.push("");
  lines.push(
    dim(
      tool.kind === "mcp"
        ? `Card ${tool.relativePath} · record only; VaultDesk does not install, start, or register this MCP server.`
        : `Card ${tool.relativePath} · record only; VaultDesk does not install or run this tool.`,
    ),
  );
  return lines;
}

function externalStatusText(status: ExternalSkillRecord["status"]): string {
  switch (status) {
    case "ok":
      return green("synced");
    case "observed":
      return dim("observed");
    case "drift":
      return yellow("drift");
    case "missing":
      return yellow("missing");
    case "invalid":
      return red("invalid");
    case "conflict":
      return red("conflict");
  }
}

function printExternalSkill(skill: ExternalSkillRecord): string[] {
  const lines: string[] = [];
  lines.push(bold(skill.name) + `  ${dim(`external · owned by ${skill.owner}`)}`);
  if (skill.title) lines.push(skill.title);
  if (skill.description) lines.push(skill.description);
  lines.push("");
  lines.push(`Path     ${skill.skillPath}`);
  lines.push(`Owner    ${skill.owner}`);
  if (skill.version) lines.push(`Version  ${skill.version}${skill.observedVersion ? dim(` · observed ${skill.observedVersion}`) : ""}`);
  else if (skill.observedVersion) lines.push(`Version  ${skill.observedVersion}`);
  if (skill.relatedTool) lines.push(`Tool     ${skill.relatedTool}`);
  lines.push(`State    ${externalStatusText(skill.status)}`);
  if (skill.observedHash) lines.push(`Hash     ${skill.observedHash}`);
  if (skill.expectedHash) lines.push(`Expected ${skill.expectedHash}`);
  if (skill.modifiedAt) lines.push(`Changed  ${skill.modifiedAt}`);
  if (skill.markerPresent) lines.push(yellow("A .vault-managed marker is still present at this path."));
  if (skill.notes) {
    lines.push("");
    lines.push(skill.notes);
  }
  lines.push("");
  lines.push(
    dim(
      `Card ${skill.relativePath} · record only; VaultDesk does not install, update, or run ${skill.owner}.`,
    ),
  );
  return lines;
}

function printAdoptPreview(preview: AdoptPreview): string[] {
  const lines = [
    bold(`Adopt ${preview.skill} as external`),
    `Owner    ${preview.owner}`,
    `Path     ${preview.skillPath}`,
    `Card     ${preview.cardPath}`,
    `Source   ${preview.sourceName}`,
    `Targets  ${preview.targetIds.length > 0 ? preview.targetIds.join(", ") : "none"}`,
    `Removes  ${preview.contentPath}${preview.vendorPath ? ` · ${preview.vendorPath}` : ""}`,
  ];
  if (preview.expectedHash) lines.push(`Expected ${preview.expectedHash}`);
  if (preview.relatedTool) lines.push(`Tool     ${preview.relatedTool}`);
  if (preview.markerPath) lines.push(`Marker   ${preview.markerPath} ${dim("(will be removed)")}`);
  for (const warning of preview.warnings) lines.push(yellow(`warning: ${warning}`));
  lines.push("");
  lines.push(dim("The tool becomes the owner. VaultDesk keeps only the card and observed state."));
  return lines;
}

function parseInstallFlag(value: string): { label: string; command: string } {
  const equals = value.indexOf("=");
  if (equals <= 0) {
    throw new VaultDeskError("invalid-input", `--install-command expects label=command, got: ${value}`);
  }
  return { label: value.slice(0, equals).trim(), command: value.slice(equals + 1).trim() };
}

async function dispatch(parsed: Parsed): Promise<CommandResult> {
  const [group, action, ...rest] = parsed.positionals;
  const command = [group, action].filter(Boolean).join(".");
  if (!group) throw new VaultDeskError("invalid-input", "Missing command. Run vaultdesk --help.");
  const options = parsed;

  switch (group) {
    case "vault": {
      const vaultPath = vaultPathOf(parsed);
      if (action === "init") {
        const target = rest[0] ? path.resolve(expandHome(rest[0])) : vaultPath;
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "vault init takes at most one path.");
        if (!parsed.yes) {
          return {
            data: { path: target, name: valueOf(options, "name") ?? path.basename(target), preview: true },
            warnings: [],
            human: [
              bold("Create vault"),
              target,
              `Name     ${valueOf(options, "name") ?? path.basename(target)}`,
              `Git      ${hasFlag(options, "git") ? "initialize" : "no repository"}`,
              "",
              notice(parsed),
            ],
          };
        }
        const result = await initVault(target, { name: valueOf(options, "name"), git: hasFlag(options, "git") });
        return {
          data: result,
          warnings: result.warnings,
          human: [
            green(`Created vault ${result.name}`),
            result.path,
            ...result.files.map((file) => `  ${file}`),
            result.gitInitialized ? green("Initialized an empty Git repository.") : dim("No Git repository was created."),
            ...result.warnings.map((warning) => yellow(`warning: ${warning}`)),
          ],
        };
      }
      if (action === "status" || action === undefined) {
        const snapshot = await openVault(vaultPath);
        return {
          data: snapshot,
          warnings: snapshot.warnings,
          human: printSnapshot(snapshot),
        };
      }
      if (action === "validate") {
        const report = await validateVault(vaultPath);
        return { data: report, warnings: report.warnings.map((warning) => warning.message), human: printValidation(report) };
      }
      if (action === "migrate") {
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          const plan = await planMigration(vaultPath);
          return {
            data: plan,
            warnings: plan.warnings,
            human: [...printMigration(plan, hasFlag(options, "full")), "", notice(parsed)],
          };
        }
        const result = await applyMigration(vaultPath);
        return {
          data: result,
          warnings: result.plan.warnings,
          human: printMigration(result, hasFlag(options, "full")),
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown vault action: ${action}`);
    }

    case "source": {
      const vaultPath = vaultPathOf(parsed);
      if (action === "list") {
        const snapshot = await openVault(vaultPath);
        return {
          data: snapshot.sources,
          warnings: snapshot.warnings,
          human: [
            ...table(
              ["NAME", "SHAPE", "ORIGIN", "REF", "SKILLS", "STATUS"],
              snapshot.sources.map((source) => [
                source.name,
                shapeText(source.shape, source.kind),
                source.origin,
                source.origin === "github" ? source.ref : "-",
                String(
                  source.shape === "plugin"
                    ? (snapshot.plugins.find((plugin) => plugin.name === source.name)?.skills.length ?? 0)
                    : source.skills.length,
                ),
                statusText(source.status),
              ]),
            ),
            ...snapshot.sources.filter((source) => source.lastError).map((source) => red(`${source.name}: ${source.lastError}`)),
          ],
        };
      }
      if (action === "show") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "source show requires a source or skill name.");
        const snapshot = await openVault(vaultPath);
        const source = snapshot.sources.find(
          (entry) => entry.name === name || entry.skills.some((skill) => skill.name === name),
        );
        if (!source) throw new VaultDeskError("unknown-source", `Unknown source or skill: ${name}`);
        const plugin = snapshot.plugins.find((entry) => entry.name === source.name);
        return { data: source, warnings: [], human: printSource(source, plugin) };
      }
      if (action === "check") {
        const report = await checkSources(vaultPath, {
          names: rest.length > 0 ? rest : undefined,
          persist: !hasFlag(options, "no-state"),
        });
        return { data: report, warnings: report.warnings, human: printCheck(report) };
      }
      if (action === "diff") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "source diff requires a source name.");
        const diff = await sourceDiff(vaultPath, name);
        return { data: diff, warnings: diff.warnings, human: printDiff(diff) };
      }
      if (action === "auto-sync") {
        if (rest.length > 0) throw new VaultDeskError("invalid-input", "source auto-sync does not take names.");
        if (!parsed.yes) {
          const snapshot = await openVault(vaultPath);
          return {
            data: { sources: snapshot.sources.filter((source) => source.origin === "github" && source.updateMode === "auto").map((source) => source.name) },
            warnings: [],
            human: [bold("Automatic source sync"), "Updates eligible Git sources, distributes managed skills, then commits and pushes each successful source.", notice(parsed)],
          };
        }
        const report = await autoSyncVault(vaultPath);
        return {
          data: report,
          warnings: report.sources.filter((source) => source.status === "error" || source.status === "push-failed" || source.pendingSkills?.length).map((source) => source.name + ": " + (source.message || source.status)),
          exitCode: report.errors > 0 ? 1 : 0,
          human: [
            bold("Automatic source sync"),
            ...report.sources.map((source) => `${source.name}: ${source.status}${source.commit ? " (" + source.commit.slice(0, 12) + ")" : ""}${source.message ? " — " + source.message : ""}`),
            `${report.updated} updated · ${report.errors} errors`,
          ],
        };
      }
      if (action === "mode") {
        const name = rest[0];
        const mode = valueOf(options, "mode");
        if (!name || rest.length !== 1 || (mode !== "auto" && mode !== "review-before-apply" && mode !== "frozen")) {
          throw new VaultDeskError("invalid-input", "source mode requires one name and --mode auto|review-before-apply|frozen.");
        }
        if (!parsed.yes) {
          return { data: { name, mode, preview: true }, warnings: [], human: [bold(`Set ${name} update mode to ${mode}`), notice(parsed)] };
        }
        await setSourceUpdateMode(vaultPath, name, mode);
        return { data: { name, mode }, warnings: [], human: [green(`Set ${name} update mode to ${mode}.`)] };
      }
      if (action === "pending") {
        const name = rest[0];
        if (!name || rest.length !== 1) throw new VaultDeskError("invalid-input", "source pending requires one source name.");
        const pending = await listPendingSkills(vaultPath, name);
        return { data: pending, warnings: [], human: pending.length
          ? [bold(`Pending skills in ${name}`), ...table(["NAME", "UPSTREAM PATH"], pending.map((entry) => [entry.name, entry.sourcePath])), dim(`Use source adopt ${name} --path <upstream path> --yes.`)]
          : [green(`No pending skills in ${name}.`)] };
      }
      if (action === "adopt") {
        const name = rest[0];
        const paths = valuesOf(options, "path");
        if (!name || rest.length !== 1 || paths.length === 0) {
          throw new VaultDeskError("invalid-input", "source adopt requires one source name and at least one --path.");
        }
        const pending = await listPendingSkills(vaultPath, name);
        if (!parsed.yes) {
          return { data: { source: name, selectedPaths: paths, pending, preview: true }, warnings: [], human: [
            bold(`Adopt new skills in ${name}`), ...paths.map((entry) => `  ${entry}`), "Plugin updates require selecting every pending skill.", notice(parsed),
          ] };
        }
        const result = await adoptPendingSkills(vaultPath, name, paths);
        return { data: result, warnings: result.message ? [result.message] : [], exitCode: result.status === "error" || result.status === "push-failed" ? 1 : 0, human: [
          green(`Adopted selected skills in ${name}: ${result.status}.`), ...(result.commit ? [`Commit ${result.commit.slice(0, 12)}`] : []), ...(result.message ? [result.message] : []),
        ] };
      }
      if (action === "distribute") {
        const name = rest[0];
        if (!name || rest.length !== 1) throw new VaultDeskError("invalid-input", "source distribute requires one source name.");
        if (!parsed.yes) {
          return { data: { source: name, preview: true }, warnings: [], human: [bold(`Distribute current source ${name}`), notice(parsed)] };
        }
        const changedPaths = await distributeCurrentSource(vaultPath, name);
        return { data: { source: name, changedPaths }, warnings: [], human: [green(`Distributed ${name} to ${changedPaths.length} managed paths.`), ...changedPaths] };
      }
      if (action === "update") {
        const names = rest.length > 0 ? rest : undefined;
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          const preview = await previewUpdate(vaultPath, names);
          const lines: string[] = [];
          if (preview.changes.length === 0) lines.push(green("No upstream changes."));
          for (const change of preview.changes) {
            lines.push(...printDiff(change.diff));
            lines.push("");
          }
          lines.push(notice(parsed));
          return { data: preview, warnings: preview.warnings, human: lines };
        }
        const result = await updateSources(vaultPath, {
          names,
          commit: hasFlag(options, "commit"),
          install: hasFlag(options, "install"),
          force: hasFlag(options, "force"),
          commitMessage: valueOf(options, "message"),
        });
        const lines: string[] = [];
        if (!result.applied) lines.push(green("No upstream changes."));
        else {
          lines.push(green(`Updated ${result.names.join(", ")}.`));
          lines.push(`${result.changes.reduce((total, change) => total + change.files.length, 0)} files rewritten.`);
          if (result.install) lines.push(`Reinstalled ${result.install.length} targets.`);
          if (result.commit) lines.push(`Committed ${result.commit.slice(0, 12)}.`);
        }
        for (const warning of result.warnings) lines.push(yellow(`warning: ${warning}`));
        return { data: result, warnings: result.warnings, human: lines };
      }
      if (action === "add") {
        const localPath = rest[0];
        const repo = valueOf(options, "repo");
        if (localPath && repo) throw new VaultDeskError("invalid-input", "Use either a local path or --repo, not both.");
        if (!localPath && !repo) throw new VaultDeskError("invalid-input", "source add requires a path or --repo owner/name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "source add takes one path.");
        const kindRaw = valueOf(options, "kind");
        if (kindRaw && kindRaw !== "suite" && kindRaw !== "collection") {
          throw new VaultDeskError("invalid-input", "kind must be suite or collection.");
        }
        const kind = kindRaw as "suite" | "collection" | undefined;
        const name = valueOf(options, "name");
        const entrypoint = valueOf(options, "entrypoint");
        const forcePlugin = hasFlag(options, "plugin");
        const noPlugin = hasFlag(options, "no-plugin");
        if (forcePlugin && noPlugin) {
          throw new VaultDeskError("invalid-input", "Use either --plugin or --no-plugin, not both.");
        }
        const apply = parsed.yes && !hasFlag(options, "dry-run");
        const refusePluginSkillFlags = (): void => {
          if (kindRaw || entrypoint) {
            throw new VaultDeskError("invalid-input", "Plugin imports do not take --kind or --entrypoint.");
          }
        };
        const pluginAdded = (sourceName: string, wrote: string[], commit?: string): CommandResult => ({
          data: { sourceName, shape: "plugin", wrote, ...(commit ? { commit } : {}) },
          warnings: [],
          human: [
            green(`Imported plugin ${sourceName}${commit ? ` at ${commit.slice(0, 12)}` : ""}.`),
            ...wrote,
            dim("Plugins are installed by the agent; VaultDesk only stores and displays them."),
          ],
        });
        if (repo) {
          const input = {
            repo,
            ref: valueOf(options, "ref"),
            path: valueOf(options, "path"),
            name,
            kind,
            entrypoint,
          };
          const pluginInput = { repo, ref: input.ref, path: input.path, name, force: forcePlugin };
          let pluginPreview: PluginImportPreview | undefined;
          if (!noPlugin) {
            try {
              pluginPreview = await previewGithubPlugin(vaultPath, pluginInput);
            } catch (error) {
              if (!(error instanceof VaultDeskError) || error.code !== "not-a-plugin") throw error;
            }
          }
          if (pluginPreview) {
            refusePluginSkillFlags();
            if (!apply) {
              return {
                data: pluginPreview,
                warnings: pluginPreview.warnings,
                human: [...printPluginImport(pluginPreview), "", notice(parsed)],
              };
            }
            const result = await addGithubPlugin(vaultPath, pluginInput);
            return pluginAdded(result.sourceName, result.wrote, result.commit);
          }
          if (!apply) {
            const preview = await previewAddGithub(vaultPath, input);
            return { data: preview, warnings: preview.warnings, human: [...printImport(preview), "", notice(parsed)] };
          }
          const result = await addGithubSource(vaultPath, input);
          return {
            data: result,
            warnings: [],
            human: [green(`Added ${result.sourceName} from GitHub at ${result.commit.slice(0, 12)}.`), ...result.wrote],
          };
        }
        const inputPath = path.resolve(expandHome(localPath as string));
        if (!noPlugin && detectLocalPlugin(inputPath, { force: forcePlugin })) {
          refusePluginSkillFlags();
          if (!apply) {
            const preview = await previewPluginImport(inputPath, vaultPath, { name, force: forcePlugin });
            return {
              data: preview,
              warnings: preview.warnings,
              human: [...printPluginImport(preview), "", notice(parsed)],
            };
          }
          const result = await applyPluginImport(inputPath, vaultPath, { name, force: forcePlugin });
          return pluginAdded(result.sourceName, result.wrote);
        }
        if (!apply) {
          const preview = await previewImport(inputPath, vaultPath, name, { kind, entrypoint });
          return { data: preview, warnings: preview.warnings, human: [...printImport(preview), "", notice(parsed)] };
        }
        const result = await applyImport(inputPath, vaultPath, { name, kind, entrypoint });
        return {
          data: result,
          warnings: [],
          human: [green(`Imported ${result.sourceName}.`), ...result.wrote],
        };
      }
      if (action === "remove") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "source remove requires a source name.");
        const snapshot = await openVault(vaultPath);
        const source = snapshot.sources.find((entry) => entry.name === name);
        if (!source) throw new VaultDeskError("unknown-source", `Unknown source: ${name}`);
        const referencing = snapshot.targets.filter((target) => target.names.includes(name) || target.skills.some((skill) => source.skills.some((entry) => entry.name === skill)));
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { source, referencingTargets: referencing.map((target) => target.id), deleteFiles: hasFlag(options, "delete-files") },
            warnings: [],
            human: [
              bold(`Remove source ${name}`),
              `Metadata ${source.metadataPath ?? "-"}`,
              `Workspace ${hasFlag(options, "delete-files") ? "delete working and vendor copies" : "keep working and vendor copies"}`,
              referencing.length > 0
                ? yellow(`Referenced by targets: ${referencing.map((target) => target.id).join(", ")}`)
                : dim("No install targets reference this source."),
              "",
              notice(parsed),
            ],
          };
        }
        const result = await removeSource(vaultPath, name, { deleteFiles: hasFlag(options, "delete-files") });
        return {
          data: result,
          warnings: [],
          human: [green(`Removed source ${name}.`), ...result.removedPaths],
        };
      }
      if (action === "fork") {
        const skill = rest[0];
        if (!skill) throw new VaultDeskError("invalid-input", "source fork requires a skill name.");
        const as = valueOf(options, "as");
        const apply = parsed.yes && !hasFlag(options, "dry-run");
        if (!apply) {
          const preview = await previewFork(vaultPath, skill, as);
          return { data: preview, warnings: preview.warnings, human: [...printFork(preview), "", notice(parsed)] };
        }
        const result = await forkSkill(vaultPath, skill, as);
        return {
          data: result,
          warnings: result.warnings,
          human: [green(`Forked ${result.skill} -> ${result.newSourceName}.`), result.targetPath],
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown source action: ${action}`);
    }

    case "plugin": {
      const vaultPath = vaultPathOf(parsed);
      const snapshot = await openVault(vaultPath);
      if (action === "target") {
        const [verb, ...args] = rest;
        if (verb === "list") {
          const targets = readVaultFile(vaultPath).plugin_targets ?? [];
          return { data: targets, warnings: [], human: targets.length
            ? table(["ID", "DEST", "PLUGINS", "AUTO"], targets.map((entry) => [entry.id, entry.dest, entry.names.join(", "), entry.install_after_update ? "yes" : "no"]))
            : [dim("No plugin targets registered.")] };
        }
        if (verb === "add") {
          const id = valueOf(options, "id");
          const dest = valueOf(options, "dest");
          const names = [...args, ...valuesOf(options, "name")];
          if (!id || !dest || names.length === 0) throw new VaultDeskError("invalid-input", "plugin target add requires plugin names, --id and --dest.");
          if (!parsed.yes) return { data: { id, dest, names, preview: true }, warnings: [], human: [bold(`Register plugin target ${id}`), `Destination ${dest}`, `Plugins ${names.join(", ")}`, notice(parsed)] };
          await registerPluginTarget(vaultPath, { id, dest, names });
          return { data: { id, dest, names }, warnings: [], human: [green(`Registered plugin target ${id}.`), "Run source distribute <plugin> --yes now, or wait for the next automatic check."] };
        }
        if (verb === "remove") {
          const id = args[0];
          if (!id || args.length !== 1) throw new VaultDeskError("invalid-input", "plugin target remove requires one target ID.");
          if (!parsed.yes) return { data: { id, deleteFiles: hasFlag(options, "delete-files"), preview: true }, warnings: [], human: [bold(`Remove plugin target ${id}`), hasFlag(options, "delete-files") ? "Managed files will move to backup." : "Installed files will stay.", notice(parsed)] };
          const result = await removePluginTarget(vaultPath, id, { deleteFiles: hasFlag(options, "delete-files") });
          return { data: result, warnings: [], human: [green(`Removed plugin target ${id}.`), ...result.filesMoved] };
        }
        throw new VaultDeskError("invalid-input", `Unknown plugin target action: ${verb}`);
      }
      if (action === "list" || action === undefined) {
        if (snapshot.plugins.length === 0) {
          return { data: [], warnings: snapshot.warnings, human: [dim("No plugins registered.")] };
        }
        return {
          data: snapshot.plugins.map((plugin) => pluginPayload(snapshot.path, plugin)),
          warnings: snapshot.warnings,
          human: table(
            ["NAME", "ORIGIN", "VERSION", "MANIFESTS", "SKILLS", "ASSETS", "STATUS"],
            snapshot.plugins.map((plugin) => [
              plugin.name,
              plugin.origin,
              plugin.version ?? "-",
              plugin.manifests.map((manifest) => manifest.agent).join(", ") || "-",
              String(plugin.skills.length),
              String(plugin.assets.length),
              statusText(plugin.status),
            ]),
          ),
        };
      }
      if (action === "show") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "plugin show requires a plugin or contained skill name.");
        const plugin = snapshot.plugins.find(
          (entry) => entry.name === name || entry.skills.some((skill) => skill.name === name),
        );
        if (!plugin) throw new VaultDeskError("unknown-plugin", `Unknown plugin or plugin skill: ${name}`);
        return { data: pluginPayload(snapshot.path, plugin), warnings: snapshot.warnings, human: printPlugin(plugin) };
      }
      throw new VaultDeskError("invalid-input", `Unknown plugin action: ${action}`);
    }

    case "build": {
      if (action) throw new VaultDeskError("invalid-input", "build does not take an action.");
      const vaultPath = vaultPathOf(parsed);
      if (!parsed.yes || hasFlag(options, "dry-run")) {
        const snapshot = await openVault(vaultPath);
        return {
          data: {
            skills: snapshot.skills.map((skill) => skill.name),
            tools: snapshot.tools.map((tool) => tool.name),
            externalSkills: snapshot.externalSkills.map((skill) => skill.name),
            preview: true,
          },
          warnings: snapshot.warnings,
          human: [
            bold(
              `Rebuild ${snapshot.skills.length} skills, ${snapshot.tools.length} tool cards, and ${snapshot.externalSkills.length} external records`,
            ),
            ...snapshot.skills.map((skill) => `  ${skill.name}`),
            ...snapshot.tools.map((tool) => `  ${tool.name} ${dim("(tool card)")}`),
            ...snapshot.externalSkills.map((skill) => `  ${skill.name} ${dim(`(external · ${skill.owner})`)}`),
            "",
            notice(parsed),
          ],
        };
      }
      const result = await buildVault(vaultPath);
      return {
        data: result,
        warnings: [],
        human: [
          green(`Built ${result.skills.length} skills into build/skills.`),
          green(`Wrote ${result.tools.length} tool cards to build/tools.json.`),
          green(`Wrote ${result.externalSkills.length} external records to build/external-skills.json.`),
        ],
      };
    }

    case "target": {
      const vaultPath = vaultPathOf(parsed);
      if (action === "list") {
        const snapshot = await openVault(vaultPath);
        return {
          data: snapshot.targets,
          warnings: snapshot.warnings,
          human: [
            ...table(
              ["ID", "DEST", "NAMES", "SKILLS", "EXISTS", "LAST INSTALLED"],
              snapshot.targets.map((target) => [
                target.id,
                target.dest,
                target.names.join(", "),
                String(target.skills.length),
                target.exists ? "yes" : red("missing"),
                target.lastInstalledAt ?? "-",
              ]),
            ),
          ],
        };
      }
      if (action === "install") {
        const names = rest;
        if (names.length === 0) throw new VaultDeskError("invalid-input", "target install requires at least one source or skill.");
        const dest = valueOf(options, "dest");
        if (!dest) throw new VaultDeskError("invalid-input", "target install requires --dest.");
        const id = valueOf(options, "id");
        const dryRun = !parsed.yes || hasFlag(options, "dry-run");
        const result = await installSkills(vaultPath, { names, dest, id, dryRun });
        return {
          data: result,
          warnings: result.plan.warnings,
          human: [...printPlan(result), ...(dryRun ? ["", notice(parsed)] : [])],
        };
      }
      if (action === "remove") {
        const id = rest[0];
        if (!id) throw new VaultDeskError("invalid-input", "target remove requires a target id.");
        const snapshot = await openVault(vaultPath);
        const target = snapshot.targets.find((entry) => entry.id === id);
        if (!target) throw new VaultDeskError("unknown-target", `Unknown install target: ${id}`);
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { target, deleteFiles: hasFlag(options, "delete-files") },
            warnings: [],
            human: [
              bold(`Remove target ${id}`),
              `Dest     ${target.dest}`,
              `Skills   ${target.skills.join(", ") || "-"}`,
              hasFlag(options, "delete-files")
                ? yellow("Managed files will be moved to backup before unregistering.")
                : dim("Installed files stay in place; only the registration is removed."),
              "",
              notice(parsed),
            ],
          };
        }
        const result = await removeTarget(vaultPath, id, { deleteFiles: hasFlag(options, "delete-files") });
        return {
          data: result,
          warnings: [],
          human: [
            green(`Removed target ${id}.`),
            ...(result.filesMoved.length > 0 ? [`Moved ${result.filesMoved.length} skills to ${result.backupPath ?? "backup"}.`] : []),
          ],
        };
      }
      if (action === "verify") {
        const id = rest[0];
        if (!id) throw new VaultDeskError("invalid-input", "target verify requires a target id.");
        const verification = await verifyTarget(vaultPath, id);
        return {
          data: verification,
          warnings: [],
          human: [
            verification.filesInPlace
              ? green("Files in place.")
              : red("Files in place: no. Some files are missing or modified."),
            `Checked  ${verification.checked}`,
            `Missing  ${verification.missing.join(", ") || "-"}`,
            `Modified ${verification.modified.join(", ") || "-"}`,
            dim("This checks files only. It does not claim any agent tool has discovered the skills."),
          ],
        };
      }
      if (action === "restore") {
        const id = rest[0];
        const backup = valueOf(options, "backup");
        const name = valueOf(options, "name");
        if (!id || !backup || !name) {
          throw new VaultDeskError("invalid-input", "target restore requires <id> --backup <path> --name <skill>.");
        }
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { targetId: id, backupPath: backup, name, preview: true },
            warnings: [],
            human: [bold(`Restore ${name} into ${id}`), `Backup   ${backup}`, "", notice(parsed)],
          };
        }
        const result = await restoreBackup(vaultPath, { targetId: id, backupPath: backup, name });
        return {
          data: result,
          warnings: [],
          human: [green(`Restored ${result.restored}.`), ...(result.previousBackup ? [`Previous slot moved to ${result.previousBackup}.`] : [])],
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown target action: ${action}`);
    }

    case "git": {
      const vaultPath = vaultPathOf(parsed);
      const snapshot = await openVault(vaultPath);
      if (action === "status" || action === undefined) {
        const git = snapshot.git;
        const lines: string[] = [];
        lines.push(git.isRepo ? bold(`${git.branch ?? "detached"}`) + ` @ ${(git.head ?? "").slice(0, 12)}` : red("Not a Git repository."));
        if (git.remote) lines.push(`Remote   ${git.remote}`);
        if (git.upstream) lines.push(`Upstream ${git.upstream}  ahead ${git.ahead ?? 0} · behind ${git.behind ?? 0}`);
        lines.push(git.dirty ? yellow("Dirty worktree.") : green("Clean worktree."));
        if (git.changes.length > 0) {
          lines.push("");
          lines.push(
            ...table(
              ["STATUS", "PATH"],
              git.changes.map((change) => [change.status, change.path]),
            ),
          );
        }
        return { data: git, warnings: [], human: lines };
      }
      if (action === "commit") {
        const message = valueOf(options, "message");
        const requested = [...valuesOf(options, "path"), ...rest].map((entry) => entry.trim()).filter(Boolean);
        if (!message) throw new VaultDeskError("invalid-input", "git commit requires --message.");
        if (requested.length === 0) throw new VaultDeskError("invalid-input", "git commit requires at least one --path.");
        const paths = resolveCommitPaths(snapshot.git, requested);
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          const changes = snapshot.git.changes.filter((change) =>
            paths.includes(change.path),
          );
          return {
            data: { message, paths, changes, preview: true },
            warnings: [],
            human: [
              bold("Commit preview"),
              `Message  ${message}`,
              `Paths    ${paths.join(", ")}`,
              "",
              ...table(["STATUS", "PATH"], changes.map((change) => [change.status, change.path])),
              "",
              notice(parsed),
            ],
          };
        }
        const commit = await commitPaths(vaultPath, paths, message);
        return {
          data: { commit, message, paths },
          warnings: [],
          human: [green(`Committed ${commit.slice(0, 12)}.`), dim("Not pushed.")],
        };
      }
      if (action === "push") {
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { branch: snapshot.git.branch, remote: snapshot.git.remote, preview: true },
            warnings: [],
            human: [
              bold(`Push ${snapshot.git.branch ?? "(detached)"}`),
              `Remote   ${snapshot.git.remote ?? dim("none")}`,
              "",
              notice(parsed),
            ],
          };
        }
        const result = await push(vaultPath);
        return {
          data: result,
          warnings: [],
          human: [green("Pushed current branch."), result.stdout.trim()].filter(Boolean),
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown git action: ${action}`);
    }

    case "agent": {
      if (action !== "skill" || rest.length > 0) {
        throw new VaultDeskError("invalid-input", "Usage: vaultdesk agent skill");
      }
      const skill = readBundledAgentSkill(bundledAgentSkillDir());
      return {
        data: skill,
        warnings: [],
        human: [
          bold(`Agent skill · ${skill.name}`),
          `Path     ${skill.path}`,
          `Summary  ${skill.description}`,
          "",
          skill.content.trimEnd(),
        ],
      };
    }

    case "presets": {
      if (action === "list" || action === undefined) {
        const presets = listPresets();
        return { data: presets, warnings: [], human: printPresets() };
      }
      if (action === "verify") {
        const id = rest[0];
        if (!id) throw new VaultDeskError("invalid-input", "presets verify requires a preset id.");
        const preview = previewPresetVerify(id);
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: preview,
            warnings: [],
            human: [
              bold(`Verify preset · ${preview.label}`),
              `Destination  ${preview.dest}`,
              `Command      ${preview.command}`,
              "",
              yellow("This command comes from the preset file and runs with your user permissions."),
              yellow("VaultDesk only shows its output; it does not claim the tool loaded any skill."),
              "",
              notice(parsed),
            ],
          };
        }
        const result = await runPresetVerifyCommand(id, { confirm: true });
        return {
          data: result,
          warnings: result.timedOut
            ? [`The verify command timed out after ${result.durationMs}ms and was killed.`]
            : result.truncated
              ? ["The verify command output was truncated."]
              : [],
          human: [
            bold(`Verify preset · ${preview.label}`),
            `Command  ${preview.command}`,
            `Exit     ${result.exitCode ?? result.signal ?? "unknown"}${result.timedOut ? yellow(" (timed out)") : ""}`,
            `Took     ${result.durationMs}ms`,
            ...(result.stdout.trim() ? ["", bold("stdout"), result.stdout.trimEnd()] : []),
            ...(result.stderr.trim() ? ["", bold("stderr"), result.stderr.trimEnd()] : []),
            "",
            dim("Path-level target verification is separate: vaultdesk target verify <id>."),
          ],
          exitCode: result.exitCode === 0 ? 0 : 1,
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown presets action: ${action}`);
    }

    case "external": {
      const vaultPath = vaultPathOf(parsed);
      if (action === "list" || action === undefined) {
        const snapshot = await openVault(vaultPath);
        if (snapshot.externalSkills.length === 0) {
          return {
            data: [],
            warnings: snapshot.warnings,
            human: [
              dim("No tool-managed skills recorded."),
              dim("Record one with: vaultdesk external add <name> --owner <tool> --path <dir>"),
            ],
          };
        }
        return {
          data: snapshot.externalSkills,
          warnings: snapshot.warnings,
          human: table(
            ["NAME", "OWNER", "STATE", "TOOL", "PATH"],
            snapshot.externalSkills.map((skill) => [
              skill.name,
              skill.owner,
              externalStatusText(skill.status),
              skill.relatedTool ?? "-",
              skill.skillPath,
            ]),
          ),
        };
      }
      if (action === "show") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "external show requires a skill name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "external show takes one skill name.");
        const snapshot = await openVault(vaultPath);
        const skill = snapshot.externalSkills.find((entry) => entry.name === name);
        if (!skill) throw new VaultDeskError("unknown-external", `Unknown external skill: ${name}`);
        return { data: skill, warnings: snapshot.warnings, human: printExternalSkill(skill) };
      }
      if (action === "add") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "external add requires a skill name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "external add takes one skill name.");
        const snapshot = await openVault(vaultPath);
        if (snapshot.format !== "v2") {
          throw new VaultDeskError("not-writable-v1", "Migrate this vault before recording external skills.");
        }
        const owner = valueOf(options, "owner");
        const skillPathInput = valueOf(options, "path");
        const missing = [!owner ? "--owner" : null, !skillPathInput ? "--path" : null].filter(
          (entry): entry is string => Boolean(entry),
        );
        if (missing.length > 0) {
          throw new VaultDeskError("invalid-input", `external add requires ${missing.join(", ")}.`);
        }
        const namespaceOwner =
          snapshot.skills.find((skill) => skill.name === name) ??
          snapshot.plugins.find((plugin) => plugin.name === name) ??
          snapshot.plugins.flatMap((plugin) => plugin.skills).find((skill) => skill.name === name) ??
          snapshot.sources.find((source) => source.name === name && source.shape !== "standalone");
        if (namespaceOwner) {
          const managed = snapshot.skills.some((skill) => skill.name === name);
          throw new VaultDeskError(
            "path-conflict",
            managed
              ? `${name} is a managed skill in this vault. Use external adopt to transfer ownership.`
              : `${name} already exists as a source, plugin, or plugin skill in this vault.`,
          );
        }
        const skillPath = path.resolve(expandHome(skillPathInput as string));
        if (isInside(skillPath, snapshot.path)) {
          throw new VaultDeskError("invalid-input", "The external skill path must be outside the vault.");
        }
        const exists = isDirectory(skillPath);
        const hasSkillFile = isFile(path.join(skillPath, "SKILL.md"));
        const markerPath = path.join(skillPath, ".vault-managed");
        if (isFile(markerPath)) {
          throw new VaultDeskError(
            "path-conflict",
            `The path carries a .vault-managed marker. Adopt it from its owning vault or remove ${markerPath} first.`,
          );
        }
        const expectedHashInput = valueOf(options, "expected-hash");
        if (expectedHashInput && hasFlag(options, "pin")) {
          throw new VaultDeskError("invalid-input", "Use either --expected-hash or --pin, not both.");
        }
        const card = parseExternalSkillCard({
          schema: 1,
          name,
          owner,
          path: skillPathInput,
          ...(valueOf(options, "title") ? { title: valueOf(options, "title") } : {}),
          ...(valueOf(options, "owner-version") ? { version: valueOf(options, "owner-version") } : {}),
          ...(expectedHashInput
            ? { expected_hash: expectedHashInput }
            : hasFlag(options, "pin") && exists
              ? { expected_hash: hashDirectory(skillPath) }
              : {}),
          ...(valueOf(options, "related-tool") ? { related_tool: valueOf(options, "related-tool") } : {}),
          ...(valueOf(options, "description") ? { description: valueOf(options, "description") } : {}),
          ...(valueOf(options, "notes") ? { notes: valueOf(options, "notes") } : {}),
        });
        const file = externalSkillCardPath(vaultPath, card.name);
        const replaces = isFile(file);
        if (replaces && !hasFlag(options, "force")) {
          throw new VaultDeskError("path-conflict", `External skill card already exists: external-skills/${card.name}.yml`, {
            details: ["Pass --force to replace it."],
          });
        }
        const warnings = !exists
          ? [`${skillPath} does not exist yet; the card reports missing until the tool installs it.`]
          : !hasSkillFile
            ? [`${skillPath} has no SKILL.md; the card reports invalid until the tool writes one.`]
            : [];
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { ...card, skillPath, cardPath: file, preview: true, replaces, exists, hasSkillFile },
            warnings,
            human: [
              bold(`Record external skill ${card.name}`),
              `Owner    ${card.owner}`,
              `Path     ${skillPath}${exists ? "" : yellow(" (missing)")}${exists && !hasSkillFile ? yellow(" (no SKILL.md)") : ""}`,
              `Card     external-skills/${card.name}.yml${replaces ? yellow(" (replaces)") : ""}`,
              ...(card.expected_hash ? [`Expected ${card.expected_hash}`] : []),
              ...(card.related_tool ? [`Tool     ${card.related_tool}`] : []),
              ...warnings.map((warning) => yellow(`warning: ${warning}`)),
              "",
              dim("Record only: VaultDesk will never write to this path."),
              notice(parsed),
            ],
          };
        }
        const { record, fresh } = await withWriteLock(vaultPath, async () => {
          const written = writeExternalSkillCard(vaultPath, card, { force: true });
          const next = await openVault(vaultPath);
          writeExternalSkillsArtifact(next);
          return { record: written, fresh: next };
        });
        const observed = fresh.externalSkills.find((entry) => entry.name === card.name);
        return {
          data: observed ?? record,
          warnings: fresh.warnings,
          human: [
            green(`Recorded external skill ${card.name}.`),
            record.relativePath,
            "Wrote build/external-skills.json.",
            dim(`Owned by ${card.owner}; VaultDesk only observes ${skillPath}.`),
          ],
        };
      }
      if (action === "remove") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "external remove requires a skill name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "external remove takes one skill name.");
        const snapshot = await openVault(vaultPath);
        const skill = snapshot.externalSkills.find((entry) => entry.name === name);
        if (!skill) throw new VaultDeskError("unknown-external", `Unknown external skill: ${name}`);
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { ...skill, preview: true },
            warnings: [],
            human: [
              bold(`Remove external record ${name}`),
              `Card     ${skill.relativePath}`,
              `Path     ${skill.skillPath} ${dim("(untouched)")}`,
              "",
              dim("Only the vault record is removed. The tool keeps owning its files."),
              notice(parsed),
            ],
          };
        }
        const cardPath = externalSkillCardPath(vaultPath, name);
        const fresh = await withWriteLock(vaultPath, async () => {
          if (isFile(cardPath)) fs.rmSync(cardPath);
          const next = await openVault(vaultPath);
          writeExternalSkillsArtifact(next);
          return next;
        });
        return {
          data: { name, cardPath, removed: true },
          warnings: fresh.warnings,
          human: [
            green(`Removed external record ${name}.`),
            dim(`${skill.skillPath} was not touched.`),
            "Wrote build/external-skills.json.",
          ],
        };
      }
      if (action === "adopt") {
        const skillName = rest[0];
        if (!skillName) throw new VaultDeskError("invalid-input", "external adopt requires a skill name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "external adopt takes one skill name.");
        const owner = valueOf(options, "owner");
        const skillPathInput = valueOf(options, "path");
        const missing = [!owner ? "--owner" : null, !skillPathInput ? "--path" : null].filter(
          (entry): entry is string => Boolean(entry),
        );
        if (missing.length > 0) {
          throw new VaultDeskError("invalid-input", `external adopt requires ${missing.join(", ")}.`);
        }
        const input = {
          owner: owner as string,
          path: skillPathInput as string,
          ...(valueOf(options, "title") ? { title: valueOf(options, "title") } : {}),
          ...(valueOf(options, "owner-version") ? { version: valueOf(options, "owner-version") } : {}),
          ...(valueOf(options, "expected-hash") ? { expectedHash: valueOf(options, "expected-hash") } : {}),
          ...(valueOf(options, "related-tool") ? { relatedTool: valueOf(options, "related-tool") } : {}),
          ...(valueOf(options, "description") ? { description: valueOf(options, "description") } : {}),
          ...(valueOf(options, "notes") ? { notes: valueOf(options, "notes") } : {}),
          ...(hasFlag(options, "pin") ? { pin: true } : {}),
        };
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          const preview = await previewAdoptExternal(vaultPath, skillName, input);
          return {
            data: { ...preview, preview: true },
            warnings: preview.warnings,
            human: [...printAdoptPreview(preview), "", notice(parsed)],
          };
        }
        const result = await adoptExternalSkill(vaultPath, skillName, input);
        return {
          data: result,
          warnings: result.warnings,
          human: [
            green(`Adopted ${skillName} as external.`),
            `Card     ${result.cardPath}`,
            `Owner    ${result.owner}`,
            `Path     ${result.skillPath}`,
            `Removed  ${result.contentPath}${result.vendorPath ? ` · ${result.vendorPath}` : ""}`,
            "Wrote build/external-skills.json.",
            dim("The tool owns the files from now on. VaultDesk only observes them."),
          ],
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown external action: ${action}`);
    }

    case "tool": {
      const vaultPath = vaultPathOf(parsed);
      if (action === "list" || action === undefined) {
        const snapshot = await openVault(vaultPath);
        const kindValue = valueOf(options, "kind");
        const parsedKind = kindValue ? toolKindSchema.safeParse(kindValue) : null;
        if (parsedKind && !parsedKind.success) {
          throw new VaultDeskError(
            "invalid-input",
            `--kind expects plugin, mcp, cli, or app, got: ${kindValue}`,
          );
        }
        const tools = parsedKind?.success
          ? snapshot.tools.filter((tool) => tool.kind === parsedKind.data)
          : snapshot.tools;
        if (tools.length === 0) {
          return {
            data: [],
            warnings: snapshot.warnings,
            human: [
              dim(
                parsedKind?.success
                  ? `No ${parsedKind.data} tool cards recorded.`
                  : "No tool cards recorded.",
              ),
              dim("Add one with: vaultdesk tool add <name> --kind <kind> --title <text> ..."),
            ],
          };
        }
        return {
          data: tools,
          warnings: snapshot.warnings,
          human: table(
            ["NAME", "KIND", "TITLE", "VERSION", "TAGS", "CARD"],
            tools.map((tool) => [
              tool.name,
              toolKindText(tool.kind),
              tool.title,
              tool.recorded_version ?? "-",
              tool.tags.map((tag) => `#${tag}`).join(" ") || "-",
              tool.relativePath,
            ]),
          ),
        };
      }
      if (action === "show") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "tool show requires a tool name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "tool show takes one tool name.");
        const snapshot = await openVault(vaultPath);
        const tool = snapshot.tools.find((entry) => entry.name === name);
        if (!tool) throw new VaultDeskError("unknown-tool", `Unknown tool card: ${name}`);
        return { data: tool, warnings: [], human: printTool(tool) };
      }
      if (action === "add") {
        const name = rest[0];
        if (!name) throw new VaultDeskError("invalid-input", "tool add requires a tool name.");
        if (rest.length > 1) throw new VaultDeskError("invalid-input", "tool add takes one tool name.");
        const snapshot = await openVault(vaultPath);
        if (snapshot.format !== "v2") {
          throw new VaultDeskError("not-writable-v1", "Migrate this vault before recording tool cards.");
        }
        const kind = valueOf(options, "kind");
        const title = valueOf(options, "title");
        const summary = valueOf(options, "summary");
        const homepage = valueOf(options, "homepage");
        const installValues = valuesOf(options, "install-command");
        const missing = [
          !kind ? "--kind" : null,
          !title ? "--title" : null,
          !summary ? "--summary" : null,
          !homepage ? "--homepage" : null,
          installValues.length === 0 ? "--install-command" : null,
        ].filter((entry): entry is string => Boolean(entry));
        if (missing.length > 0) {
          throw new VaultDeskError("invalid-input", `tool add requires ${missing.join(", ")}.`);
        }
        const recordedVersion = valueOf(options, "recorded-version");
        const docs = valueOf(options, "docs");
        const run = valueOf(options, "run");
        const notes = valueOf(options, "notes");
        const card = parseToolCard({
          name,
          kind,
          title,
          summary,
          homepage,
          ...(docs ? { docs } : {}),
          ...(recordedVersion ? { recorded_version: recordedVersion } : {}),
          install: installValues.map(parseInstallFlag),
          ...(run ? { run } : {}),
          requirements: valuesOf(options, "requirement"),
          related_skills: valuesOf(options, "related-skill"),
          tags: valuesOf(options, "tag"),
          ...(notes ? { notes } : {}),
        });
        const file = toolCardPath(vaultPath, card.name);
        const exists = isFile(file);
        if (exists && !hasFlag(options, "force")) {
          throw new VaultDeskError("path-conflict", `Tool card already exists: tools/${card.name}.yml`, {
            details: ["Pass --force to replace it."],
          });
        }
        const previewRecord: ToolRecord = {
          ...card,
          path: file,
          relativePath: `tools/${card.name}.yml`,
        };
        if (!parsed.yes || hasFlag(options, "dry-run")) {
          return {
            data: { ...previewRecord, preview: true, replaces: exists },
            warnings: [],
            human: [...printTool(previewRecord), "", notice(parsed)],
          };
        }
        const record = await withWriteLock(vaultPath, async () =>
          writeToolCard(vaultPath, card, { force: true }),
        );
        const fresh = await openVault(vaultPath);
        writeToolsArtifact(fresh);
        return {
          data: { ...record, artifact: "build/tools.json" },
          warnings: fresh.warnings,
          human: [
            green(`Recorded tool card ${record.name}.`),
            record.relativePath,
            "Wrote build/tools.json.",
            dim("Record only: VaultDesk did not install or run this tool."),
          ],
        };
      }
      throw new VaultDeskError("invalid-input", `Unknown tool action: ${action}`);
    }

    default:
      throw new VaultDeskError("invalid-input", `Unknown command: ${command}. Run vaultdesk --help.`);
  }
}

function warningOf(data: unknown): string[] {
  if (data && typeof data === "object" && "warnings" in data) {
    const warnings = (data as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings)) return warnings.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

async function main(): Promise<void> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    const serialized = serializeError(error);
    if (process.argv.includes("--json")) {
      process.stdout.write(
        JSON.stringify({ schema: 1, command: "unknown", data: null, warnings: [], errors: [serialized] }, null, 2) + "\n",
      );
    } else {
      process.stderr.write(`error [${serialized.code}]: ${serialized.message}\n`);
    }
    process.exitCode = error instanceof VaultDeskError ? error.exitCode : 1;
    return;
  }

  if (parsed.version) {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (parsed.help || parsed.positionals.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  const command = [parsed.positionals[0], parsed.positionals[1]].filter(Boolean).join(".");
  try {
    const result = await dispatch(parsed);
    const warnings = result.warnings.length > 0 ? result.warnings : warningOf(result.data);
    if (parsed.json) {
      process.stdout.write(
        JSON.stringify({ schema: 1, command, data: result.data, warnings: [...new Set(warnings)], errors: [] }, null, 2) + "\n",
      );
    } else {
      process.stdout.write(result.human.join("\n") + "\n");
      for (const warning of [...new Set(warnings)]) {
        process.stderr.write(yellow(`warning: ${warning}`) + "\n");
      }
    }
    if (typeof result.exitCode === "number") process.exitCode = result.exitCode;
  } catch (error) {
    const serialized = serializeError(error);
    if (parsed.json) {
      process.stdout.write(
        JSON.stringify({ schema: 1, command, data: null, warnings: [], errors: [serialized] }, null, 2) + "\n",
      );
    } else {
      process.stderr.write(red(`error [${serialized.code}]: ${serialized.message}`) + "\n");
      if (serialized.details !== undefined) {
        process.stderr.write(JSON.stringify(serialized.details, null, 2) + "\n");
      }
    }
    process.exitCode = error instanceof VaultDeskError ? error.exitCode : 1;
  }
}

void main();
