import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  advanceUpstreamRepo,
  assert,
  cliEnv,
  cliPath,
  commitAll,
  copyFixture,
  createWorkspace,
  equal,
  git,
  initGitRepo,
  makeUpstreamRepo,
  repoRoot,
  rewriteTargetDest,
  runCli,
  writeSkill,
  type CliResult,
  type Workspace,
} from "./harness.js";
import { startSmartHttpServer } from "./git-http-server.js";

interface CliError {
  code: string;
  message: string;
  details?: unknown;
}

interface Envelope<T> {
  schema: number;
  command: string;
  data: T;
  warnings: string[];
  errors: CliError[];
}

type Payload = Record<string, any>;

class CliSuite {
  readonly name: string;
  readonly workspaces: Workspace[] = [];

  constructor(name: string) {
    this.name = name;
  }

  workspace(label: string): Workspace {
    const value = createWorkspace(label);
    this.workspaces.push(value);
    return value;
  }

  cleanup(success: boolean): void {
    if (success && process.env.KEEP_E2E !== "1") {
      for (const workspace of this.workspaces) fs.rmSync(workspace.root, { recursive: true, force: true });
    } else {
      for (const workspace of this.workspaces) console.log(`      workspace kept: ${workspace.root}`);
    }
  }
}

async function scenario(name: string, body: (suite: CliSuite) => Promise<void>): Promise<boolean> {
  const suite = new CliSuite(name);
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await body(suite);
    suite.cleanup(true);
    console.log(`  PASS ${name} (${Date.now() - started}ms)`);
    return true;
  } catch (error) {
    console.error(`  FAIL ${name} (${Date.now() - started}ms)`);
    console.error(error);
    suite.cleanup(false);
    return false;
  }
}

function envelope<T>(result: CliResult, label: string): Envelope<T> {
  try {
    const parsed = JSON.parse(result.stdout) as Envelope<T>;
    equal(parsed.schema, 1, `${label} envelope schema`);
    return parsed;
  } catch (error) {
    throw new Error(
      `${label}: expected one JSON envelope.\nstdout: ${result.stdout}\nstderr: ${result.stderr}\n${String(error)}`,
    );
  }
}

function ok<T = Payload>(result: CliResult, label: string): T {
  if (result.status !== 0) {
    throw new Error(`${label}: expected exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  const parsed = envelope<T>(result, label);
  if (parsed.errors.length > 0) {
    throw new Error(`${label}: unexpected errors ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.data;
}

function failure(result: CliResult, status: number, code: string, label: string): CliError {
  if (result.status !== status) {
    throw new Error(
      `${label}: expected exit ${status}, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  const parsed = envelope<null>(result, label);
  equal(parsed.data, null, `${label} failed data is null`);
  equal(parsed.errors.length, 1, `${label} error count`);
  const error = parsed.errors[0] as CliError;
  equal(error.code, code, `${label} error code`);
  return error;
}

function configureGit(dir: string): void {
  git(dir, ["config", "user.email", "e2e@vaultdesk.local"]);
  git(dir, ["config", "user.name", "VaultDesk E2E"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}

function initVault(workspace: Workspace, label: string): string {
  const vaultPath = path.join(workspace.root, label);
  const result = runCli(
    ["vault", "init", vaultPath, "--git", "--name", label, "--yes", "--json"],
    { workspace },
  );
  const data = ok<Payload>(result, `init ${label}`);
  equal(data.gitInitialized, true, `${label} git initialized`);
  assert(fs.existsSync(path.join(vaultPath, "vault.yml")), `${label} vault.yml written`);
  configureGit(vaultPath);
  return vaultPath;
}

function addLocal(workspace: Workspace, vaultPath: string, sourcePath: string, extra: string[] = []): Payload {
  const result = runCli(
    ["source", "add", sourcePath, "--vault", vaultPath, "--yes", "--json", ...extra],
    { workspace },
  );
  return ok<Payload>(result, `import ${path.basename(sourcePath)}`);
}

function writeSkillSet(workspace: Workspace): {
  alpha: string;
  collection: string;
  suite: string;
} {
  const alpha = path.join(workspace.root, "imports", "alpha");
  const collection = path.join(workspace.root, "imports", "collection-bundle");
  const suite = path.join(workspace.root, "imports", "suite-bundle");
  writeSkill(alpha, "alpha", "CLI alpha.", "Alpha body.");
  writeSkill(path.join(collection, "beta"), "beta", "CLI collection beta.");
  writeSkill(path.join(collection, "gamma"), "gamma", "CLI collection gamma.");
  writeSkill(path.join(suite, "delta"), "delta", "CLI suite helper.");
  writeSkill(path.join(suite, "epsilon"), "epsilon", "CLI suite entrypoint.");
  return { alpha, collection, suite };
}

async function runCliAsync(args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "packages/cli/dist/index.js"), ...args], {
      cwd: repoRoot,
      env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function cliSurface(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-surface");
  const help = runCli(["--help"], { workspace });
  equal(help.status, 0, "help exit");
  assert(help.stdout.includes("Usage:") && help.stdout.includes("Exit codes:"), "help text");
  const version = runCli(["--version"], { workspace });
  equal(version.status, 0, "version exit");
  assert(/^\d+\.\d+\.\d+\n$/.test(version.stdout), `version output: ${version.stdout}`);

  const unknownCommand = runCli(["nope", "thing", "--json"], { workspace });
  failure(unknownCommand, 2, "invalid-input", "unknown command");
  equal(envelope(unknownCommand, "unknown command").command, "nope.thing", "unknown command name");

  const unknownFlag = runCli(["vault", "status", "--bogus", "--json"], { workspace });
  failure(unknownFlag, 2, "invalid-input", "unknown flag");
  equal(envelope(unknownFlag, "unknown flag").command, "unknown", "parse failure command label");

  const missingArg = runCli(["source", "show", "--json"], { workspace });
  failure(missingArg, 2, "invalid-input", "missing source name");

  const humanError = runCli(["wat"], { workspace });
  equal(humanError.status, 2, "human error exit");
  equal(humanError.stdout, "", "human error stdout empty");
  assert(humanError.stderr.includes("error [invalid-input]"), "human error stderr");

  const presets = ok<Payload[]>(runCli(["presets", "list", "--json"], { workspace }), "presets list");
  assert(Array.isArray(presets) && presets.length > 0, "presets returned");

  const agentSkill = ok<Payload>(runCli(["agent", "skill", "--json"], { workspace }), "agent skill");
  equal(agentSkill.name, "vaultdesk", "agent skill name");
  assert(fs.existsSync(agentSkill.path), `bundled agent skill path: ${agentSkill.path}`);
  assert(String(agentSkill.content).includes("vaultdesk"), "agent skill content");

  const presetsFile = path.join(workspace.root, "presets.yml");
  fs.writeFileSync(
    presetsFile,
    [
      "schema: 1",
      "tools:",
      "  - id: e2e-tool",
      "    label: E2E Tool",
      "    dest: ~/e2e-tools",
      "    verified_at: null",
      "    verified_version: null",
      "    docs_url: null",
      "    verification_required: true",
      "    verify_command: 'printf \"e2e-ok\"'",
      "",
    ].join("\n"),
    "utf8",
  );
  const presetEnv = { ...cliEnv(workspace), VAULTDESK_PRESETS_FILE: presetsFile };
  const presetPreview = ok<Payload>(runCli(["presets", "verify", "e2e-tool", "--json"], { env: presetEnv }), "preset preview");
  equal(presetPreview.command, 'printf "e2e-ok"', "preset preview command");
  equal(presetPreview.preview, true, "preset preview flag");
  const presetRun = ok<Payload>(
    runCli(["--yes", "presets", "verify", "e2e-tool", "--json"], { env: presetEnv }),
    "preset run",
  );
  equal(presetRun.exitCode, 0, "preset run exit");
  equal(presetRun.stdout, "e2e-ok", "preset run stdout");
  console.log("      help/version, envelope shape, JSON and human usage errors, presets, agent skill OK");
}

async function vaultImportBuild(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-vault");
  const vaultPath = path.join(workspace.root, "vault");
  const preview = runCli(
    ["vault", "init", vaultPath, "--git", "--name", "cli-vault", "--json"],
    { workspace },
  );
  const previewData = ok<Payload>(preview, "init preview");
  equal(previewData.preview, true, "init preview flag");
  assert(!fs.existsSync(vaultPath), "init preview must not create the vault");
  equal(previewData.name, "cli-vault", "init preview name");
  assert(previewData.path === vaultPath, "init preview path");

  const initData = ok<Payload>(
    runCli(["vault", "init", vaultPath, "--git", "--name", "cli-vault", "--yes", "--json"], { workspace }),
    "init apply",
  );
  equal(initData.gitInitialized, true, "init git");
  for (const file of ["vault.yml", "vault.lock", ".gitignore", ".vault/.gitignore", "sources/.gitkeep"]) {
    assert(fs.existsSync(path.join(vaultPath, file)), `init missing ${file}`);
  }
  equal(git(vaultPath, ["branch", "--show-current"]).trim(), "main", "init branch");
  configureGit(vaultPath);

  const status = ok<Payload>(runCli(["vault", "status", "--vault", vaultPath, "--json"], { workspace }), "vault status");
  equal(status.format, "v2", "status format");
  equal(status.readOnly, false, "status writable");
  equal(status.counts.sources, 0, "status sources");
  equal(status.name, "cli-vault", "status name");
  const missing = runCli(["vault", "status", "--vault", path.join(workspace.root, "absent"), "--json"], { workspace });
  failure(missing, 2, "vault-not-found", "status missing vault");

  const validation = ok<Payload>(
    runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }),
    "validate empty",
  );
  equal(validation.ok, true, "empty vault valid");
  equal(validation.errors.length, 0, "empty vault errors");

  const skills = writeSkillSet(workspace);
  const alphaPreview = runCli(["source", "add", skills.alpha, "--vault", vaultPath, "--json"], { workspace });
  const alphaPreviewData = ok<Payload>(alphaPreview, "alpha import preview");
  equal(alphaPreviewData.suggestedName, "alpha", "alpha preview name");
  assert(!fs.existsSync(path.join(vaultPath, "sources/alpha.yml")), "import preview must not write metadata");
  const alphaImport = addLocal(workspace, vaultPath, skills.alpha);
  equal(alphaImport.sourceName, "alpha", "alpha import source name");
  assert(fs.existsSync(path.join(vaultPath, "skills/alpha/SKILL.md")), "alpha copied");
  assert(fs.existsSync(path.join(vaultPath, "sources/alpha.yml")), "alpha metadata");
  assert(fs.existsSync(path.join(vaultPath, "build/skills/alpha/SKILL.md")), "alpha built");

  const duplicate = runCli(["source", "add", skills.alpha, "--vault", vaultPath, "--yes", "--json"], { workspace });
  const duplicateError = failure(duplicate, 1, "path-conflict", "duplicate import");
  assert(String(duplicateError.details).includes("alpha"), "duplicate conflict details");
  assert(!fs.existsSync(path.join(vaultPath, "sources/alpha-2.yml")), "duplicate import wrote no metadata");

  const collection = addLocal(workspace, vaultPath, skills.collection);
  equal(collection.sourceName, "collection-bundle", "collection source name");
  equal(collection.kind, "collection", "collection kind");
  assert(fs.existsSync(path.join(vaultPath, "packages/collection-bundle/skills/beta/SKILL.md")), "collection beta copied");
  assert(fs.existsSync(path.join(vaultPath, "packages/collection-bundle/skills/gamma/SKILL.md")), "collection gamma copied");

  const suiteMissing = runCli(
    ["source", "add", skills.suite, "--vault", vaultPath, "--kind", "suite", "--yes", "--json"],
    { workspace },
  );
  failure(suiteMissing, 2, "invalid-input", "suite missing entrypoint");
  const suiteImport = addLocal(workspace, vaultPath, skills.suite, ["--kind", "suite", "--entrypoint", "epsilon"]);
  equal(suiteImport.sourceName, "suite-bundle", "suite source name");
  equal(suiteImport.kind, "suite", "suite kind");
  const suiteYaml = fs.readFileSync(path.join(vaultPath, "sources/suite-bundle.yml"), "utf8");
  assert(suiteYaml.includes("kind: suite") && suiteYaml.includes("entrypoint: epsilon"), "suite metadata");

  const sourceList = ok<Payload[]>(runCli(["source", "list", "--vault", vaultPath, "--json"], { workspace }), "source list");
  equal(sourceList.length, 3, "source count");
  const shown = ok<Payload>(runCli(["source", "show", "alpha", "--vault", vaultPath, "--json"], { workspace }), "source show");
  equal(shown.name, "alpha", "source show name");
  equal(shown.skills.length, 1, "source show skills");
  failure(
    runCli(["source", "show", "ghost", "--vault", vaultPath, "--json"], { workspace }),
    2,
    "unknown-source",
    "source show unknown",
  );

  const buildPreview = ok<Payload>(runCli(["build", "--vault", vaultPath, "--json"], { workspace }), "build preview");
  equal(buildPreview.preview, true, "build preview flag");
  equal(buildPreview.skills.length, 5, "build preview skill count");
  const built = ok<Payload>(runCli(["build", "--vault", vaultPath, "--yes", "--json"], { workspace }), "build apply");
  equal(built.skills.length, 5, "build applied skill count");
  for (const name of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
    assert(fs.existsSync(path.join(vaultPath, "build/skills", name, "SKILL.md")), `build missing ${name}`);
  }
  const finalValidation = ok<Payload>(
    runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }),
    "validate populated",
  );
  equal(finalValidation.ok, true, "populated vault valid");
  console.log("      init preview/apply, status, validation, previews, 3 import shapes, build OK");
}

async function targetLifecycle(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-target");
  const vaultPath = initVault(workspace, "target-vault");
  const skills = writeSkillSet(workspace);
  addLocal(workspace, vaultPath, skills.alpha);
  addLocal(workspace, vaultPath, skills.collection);
  const dest = path.join(workspace.root, "dest");
  fs.mkdirSync(path.join(dest, "alpha"), { recursive: true });
  fs.writeFileSync(path.join(dest, "alpha", "SKILL.md"), "old cli alpha\n", "utf8");

  const installPreview = ok<Payload>(
    runCli(
      ["target", "install", "alpha", "beta", "--vault", vaultPath, "--dest", dest, "--id", "cli-target", "--json"],
      { workspace },
    ),
    "target install preview",
  );
  equal(installPreview.installed, 0, "install preview writes nothing");
  equal(installPreview.plan.targetId, "cli-target", "install plan id");
  equal(installPreview.plan.slots.length, 2, "install plan slots");
  const alphaSlot = installPreview.plan.slots.find((slot: Payload) => slot.skill === "alpha");
  equal(alphaSlot.state, "unmanaged", "install plan unmanaged state");
  equal(alphaSlot.action, "backup-and-replace", "install plan backup action");
  assert(fs.existsSync(path.join(dest, "alpha", "SKILL.md")), "install preview leaves destination untouched");
  assert(readVaultYaml(vaultPath).includes("targets: []"), "install preview does not register target");

  const installed = ok<Payload>(
    runCli(
      ["target", "install", "alpha", "beta", "--vault", vaultPath, "--dest", dest, "--id", "cli-target", "--yes", "--json"],
      { workspace },
    ),
    "target install apply",
  );
  equal(installed.installed, 2, "installed skills");
  equal(installed.verification.filesInPlace, true, "install verification");
  equal(installed.backups.length, 1, "unmanaged backup count");
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "alpha marker");
  assert(fs.existsSync(path.join(dest, "beta", ".vault-managed")), "beta marker");
  assert(readVaultYaml(vaultPath).includes("cli-target"), "target registered");

  const verified = ok<Payload>(
    runCli(["target", "verify", "cli-target", "--vault", vaultPath, "--json"], { workspace }),
    "target verify clean",
  );
  equal(verified.filesInPlace, true, "verify clean");
  equal(verified.checked, 2, "verify checked");
  fs.appendFileSync(path.join(dest, "alpha", "SKILL.md"), "\nCLI-DRIFT\n", "utf8");
  const drifted = ok<Payload>(
    runCli(["target", "verify", "cli-target", "--vault", vaultPath, "--json"], { workspace }),
    "target verify drift",
  );
  equal(drifted.filesInPlace, false, "verify detects drift");
  assert(drifted.modified.includes("alpha"), "verify modified alpha");

  const repaired = ok<Payload>(
    runCli(
      ["target", "install", "alpha", "beta", "--vault", vaultPath, "--dest", dest, "--id", "cli-target", "--yes", "--json"],
      { workspace },
    ),
    "target reinstall",
  );
  equal(repaired.verification.filesInPlace, true, "reinstall verification");
  assert(!fs.readFileSync(path.join(dest, "alpha", "SKILL.md"), "utf8").includes("CLI-DRIFT"), "reinstall replaced drift");

  const removePreview = ok<Payload>(
    runCli(["target", "remove", "cli-target", "--vault", vaultPath, "--delete-files", "--json"], { workspace }),
    "target remove preview",
  );
  equal(removePreview.deleteFiles, true, "remove preview flag");
  assert(fs.existsSync(path.join(dest, "alpha")), "remove preview keeps files");
  const removed = ok<Payload>(
    runCli(
      ["target", "remove", "cli-target", "--vault", vaultPath, "--delete-files", "--yes", "--json"],
      { workspace },
    ),
    "target remove apply",
  );
  equal(removed.removed, "cli-target", "remove id");
  equal(removed.filesMoved.length, 2, "remove moved managed files");
  assert(!fs.existsSync(path.join(dest, "alpha")), "remove moved alpha away");
  assert(!readVaultYaml(vaultPath).includes("cli-target"), "target unregistered");
  failure(
    runCli(["target", "verify", "cli-target", "--vault", vaultPath, "--json"], { workspace }),
    2,
    "unknown-target",
    "verify removed target",
  );

  ok<Payload>(
    runCli(
      ["target", "install", "alpha", "beta", "--vault", vaultPath, "--dest", dest, "--id", "cli-target", "--yes", "--json"],
      { workspace },
    ),
    "target re-register",
  );
  const alphaBackup = (removed.filesMoved as string[]).find((entry) => entry.endsWith(`${path.sep}alpha`));
  assert(alphaBackup, "alpha backup path from remove");
  const restorePreview = ok<Payload>(
    runCli(
      [
        "target",
        "restore",
        "cli-target",
        "--backup",
        alphaBackup,
        "--name",
        "alpha",
        "--vault",
        vaultPath,
        "--json",
      ],
      { workspace },
    ),
    "target restore preview",
  );
  equal(restorePreview.preview, true, "restore preview flag");
  const restored = ok<Payload>(
    runCli(
      [
        "target",
        "restore",
        "cli-target",
        "--backup",
        alphaBackup,
        "--name",
        "alpha",
        "--vault",
        vaultPath,
        "--yes",
        "--json",
      ],
      { workspace },
    ),
    "target restore apply",
  );
  equal(restored.restored, "alpha", "restored skill");
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "restored alpha marker");
  const targetList = ok<Payload[]>(
    runCli(["target", "list", "--vault", vaultPath, "--json"], { workspace }),
    "target list",
  );
  equal(targetList.length, 1, "target list count");
  console.log("      install preview/apply, backup, verify drift, reinstall, remove, re-register, restore OK");
}

function readVaultYaml(vaultPath: string): string {
  return fs.readFileSync(path.join(vaultPath, "vault.yml"), "utf8");
}

async function gitLifecycle(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-git");
  const vaultPath = initVault(workspace, "git-vault");
  const skills = writeSkillSet(workspace);
  addLocal(workspace, vaultPath, skills.alpha);
  commitAll(vaultPath, "chore: initial vault");
  const remote = path.join(workspace.remotes, "git-vault.git");
  git(workspace.root, ["init", "--bare", remote]);
  git(vaultPath, ["remote", "add", "origin", remote]);
  git(vaultPath, ["push", "-u", "origin", "main"]);

  fs.mkdirSync(path.join(vaultPath, "notes"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "notes/private.md"), "keep out of UI commit\n", "utf8");
  git(vaultPath, ["add", "notes/private.md"]);
  fs.appendFileSync(path.join(vaultPath, "skills/alpha/SKILL.md"), "\nCLI-GIT-EDIT\n", "utf8");

  const status = ok<Payload>(runCli(["git", "status", "--vault", vaultPath, "--json"], { workspace }), "git status");
  equal(status.dirty, true, "git status dirty");
  assert(
    status.changes.some((change: Payload) => change.path === "skills/alpha/SKILL.md"),
    "git status lists edited skill",
  );
  assert(
    status.changes.some((change: Payload) => change.path === "notes/private.md"),
    "git status lists unrelated staged file",
  );

  const commitPreview = ok<Payload>(
    runCli(
      ["git", "commit", "--vault", vaultPath, "--path", "skills/alpha/SKILL.md", "--message", "test: cli edit", "--json"],
      { workspace },
    ),
    "git commit preview",
  );
  equal(commitPreview.preview, true, "commit preview flag");
  equal(commitPreview.paths.length, 1, "commit preview paths");
  equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "chore: initial vault", "commit preview did not commit");

  const committed = ok<Payload>(
    runCli(
      [
        "git",
        "commit",
        "--vault",
        vaultPath,
        "--path",
        "skills/alpha/SKILL.md",
        "--message",
        "test: cli edit",
        "--yes",
        "--json",
      ],
      { workspace },
    ),
    "git commit apply",
  );
  assert(committed.commit, "commit hash returned");
  equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "test: cli edit", "commit message");
  const committedFiles = git(vaultPath, ["show", "--pretty=format:", "--name-only", "HEAD"])
    .split("\n")
    .filter(Boolean);
  equal(committedFiles.join(","), "skills/alpha/SKILL.md", "commit contains explicit path only");
  equal(git(vaultPath, ["status", "--porcelain"]).trim(), "A  notes/private.md", "unrelated staged file survived");

  failure(
    runCli(
      ["git", "commit", "--vault", vaultPath, "--path", "notes/missing.md", "--message", "nope", "--json"],
      { workspace },
    ),
    2,
    "invalid-input",
    "commit unknown path",
  );
  failure(
    runCli(["git", "commit", "--vault", vaultPath, "--path", "notes/private.md", "--json"], { workspace }),
    2,
    "invalid-input",
    "commit without message",
  );

  const pushPreview = ok<Payload>(runCli(["git", "push", "--vault", vaultPath, "--json"], { workspace }), "push preview");
  equal(pushPreview.preview, true, "push preview flag");
  equal(git(workspace.root, ["--git-dir", remote, "rev-parse", "main"]).trim(), git(vaultPath, ["rev-parse", "HEAD~1"]).trim(), "push preview did not push");
  const pushed = ok<Payload>(runCli(["git", "push", "--vault", vaultPath, "--yes", "--json"], { workspace }), "push apply");
  assert(typeof pushed.stdout === "string", "push result stdout");
  equal(git(workspace.root, ["--git-dir", remote, "rev-parse", "main"]).trim(), git(vaultPath, ["rev-parse", "HEAD"]).trim(), "CLI push updated remote");
  console.log("      status, explicit-path commit, staged-file preservation, preview gate, push OK");
}

async function githubLifecycle(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-github");
  const initialCommit = makeUpstreamRepo(workspace, "cli-repo", {
    alpha: "CLI upstream alpha v1.",
    helper: "CLI upstream helper v1.",
  });
  const vaultPath = initVault(workspace, "github-vault");

  const preview = ok<Payload>(
    runCli(["source", "add", "--repo", "e2e/cli-repo", "--vault", vaultPath, "--json"], { workspace }),
    "GitHub import preview",
  );
  equal(preview.suggestedName, "cli-repo", "GitHub preview name");
  equal(preview.conflicts.length, 0, "GitHub preview conflicts");
  assert(!fs.existsSync(path.join(vaultPath, "sources/cli-repo.yml")), "GitHub preview wrote no metadata");

  const imported = ok<Payload>(
    runCli(["source", "add", "--repo", "e2e/cli-repo", "--vault", vaultPath, "--yes", "--json"], { workspace }),
    "GitHub import apply",
  );
  equal(imported.sourceName, "cli-repo", "GitHub import name");
  assert(readFile(vaultPath, "vault.lock").includes(initialCommit), "GitHub import pins commit");
  assert(fs.existsSync(path.join(vaultPath, "third_party/cli-repo/alpha/SKILL.md")), "GitHub vendor copied");
  assert(fs.existsSync(path.join(vaultPath, "packages/cli-repo/skills/helper/SKILL.md")), "GitHub working copy copied");
  commitAll(vaultPath, "chore: import cli-repo");

  const checked = ok<Payload>(
    runCli(["source", "check", "--vault", vaultPath, "--json"], { workspace }),
    "source check current",
  );
  equal(checked.results[0].status, "current", "source check current");
  const updatedCommit = advanceUpstreamRepo(workspace, "cli-repo", (source) => {
    writeSkill(path.join(source, "skills", "alpha"), "alpha", "CLI upstream alpha v2.", "CLI-UPSTREAM-V2.");
    fs.writeFileSync(path.join(source, "skills", "helper", "EXTRA.md"), "helper extra\n", "utf8");
  });
  const updateCheck = ok<Payload>(
    runCli(["source", "check", "--vault", vaultPath, "--json"], { workspace }),
    "source check update",
  );
  equal(updateCheck.results[0].status, "update-available", "source check detects update");
  equal(updateCheck.results[0].remoteCommit, updatedCommit, "source check remote commit");

  const diff = ok<Payload>(
    runCli(["source", "diff", "cli-repo", "--vault", vaultPath, "--json"], { workspace }),
    "source diff",
  );
  const diffPaths = (diff.files as Payload[]).map((file) => file.path);
  assert(diffPaths.includes("alpha/SKILL.md"), "diff alpha");
  assert(diffPaths.includes("helper/EXTRA.md"), "diff added file");
  assert(
    (diff.files as Payload[]).some((file) => String(file.patch ?? "").includes("CLI-UPSTREAM-V2.")),
    "diff patch content",
  );

  const updatePreview = ok<Payload>(
    runCli(["source", "update", "--vault", vaultPath, "--json"], { workspace }),
    "source update preview",
  );
  equal(updatePreview.changes.length, 1, "update preview count");
  assert(
    fs.readFileSync(path.join(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md"), "utf8").includes("CLI upstream alpha v1."),
    "update preview wrote nothing",
  );

  fs.writeFileSync(path.join(vaultPath, "dirty.tmp"), "block update\n", "utf8");
  failure(
    runCli(["source", "update", "--vault", vaultPath, "--yes", "--json"], { workspace }),
    1,
    "git-not-clean",
    "update dirty guard",
  );
  assert(
    fs.readFileSync(path.join(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md"), "utf8").includes("CLI upstream alpha v1."),
    "dirty update wrote nothing",
  );
  fs.rmSync(path.join(vaultPath, "dirty.tmp"));

  const updated = ok<Payload>(
    runCli(
      [
        "source",
        "update",
        "--vault",
        vaultPath,
        "--commit",
        "--message",
        "chore: cli upstream v2",
        "--yes",
        "--json",
      ],
      { workspace },
    ),
    "source update apply",
  );
  equal(updated.applied, true, "update applied");
  assert(updated.commit, "update commit returned");
  assert(
    fs.readFileSync(path.join(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md"), "utf8").includes("CLI-UPSTREAM-V2."),
    "update content written",
  );
  assert(fs.existsSync(path.join(vaultPath, "packages/cli-repo/skills/helper/EXTRA.md")), "update added file");
  assert(readFile(vaultPath, "vault.lock").includes(updatedCommit), "update pinned new commit");
  equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "update commit left clean worktree");
  equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "chore: cli upstream v2", "update commit message");

  const cleanDiff = ok<Payload>(
    runCli(["source", "diff", "cli-repo", "--vault", vaultPath, "--json"], { workspace }),
    "source diff after update",
  );
  equal(cleanDiff.files.length, 0, "diff after update empty");

  const installDest = path.join(workspace.root, "github-agents");
  ok<Payload>(
    runCli(
      ["target", "install", "alpha", "--vault", vaultPath, "--dest", installDest, "--id", "update-target", "--yes", "--json"],
      { workspace },
    ),
    "target install before update",
  );
  assert(
    fs.readFileSync(path.join(installDest, "alpha", "SKILL.md"), "utf8").includes("CLI-UPSTREAM-V2."),
    "installed copy at v2",
  );
  commitAll(vaultPath, "chore: register update target");

  const thirdCommit = advanceUpstreamRepo(workspace, "cli-repo", (source) => {
    writeSkill(path.join(source, "skills", "alpha"), "alpha", "CLI upstream alpha v3.", "CLI-UPSTREAM-V3.");
  });
  const withInstall = ok<Payload>(
    runCli(
      [
        "source",
        "update",
        "--install",
        "--commit",
        "--message",
        "chore: cli upstream v3",
        "--yes",
        "--vault",
        vaultPath,
        "--json",
      ],
      { workspace },
    ),
    "source update with install",
  );
  equal(withInstall.install.length, 1, "update reinstalled one target");
  assert(
    fs.readFileSync(path.join(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md"), "utf8").includes("CLI-UPSTREAM-V3."),
    "second update wrote working copy",
  );
  assert(
    fs.readFileSync(path.join(installDest, "alpha", "SKILL.md"), "utf8").includes("CLI-UPSTREAM-V3."),
    "update reinstalled target content",
  );
  assert(readFile(vaultPath, "vault.lock").includes(thirdCommit), "second update pinned commit");

  fs.appendFileSync(
    path.join(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md"),
    "\nlocal edit before force\n",
    "utf8",
  );
  commitAll(vaultPath, "chore: local edit before force");
  const fourthCommit = advanceUpstreamRepo(workspace, "cli-repo", (source) => {
    writeSkill(path.join(source, "skills", "alpha"), "alpha", "CLI upstream alpha v4.", "CLI-UPSTREAM-V4.");
  });
  failure(
    runCli(["source", "update", "--vault", vaultPath, "--yes", "--json"], { workspace }),
    1,
    "conflict",
    "update modified-copy guard",
  );
  assert(
    !readFile(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md").includes("CLI-UPSTREAM-V4."),
    "guarded update kept local edit",
  );
  const forced = ok<Payload>(
    runCli(
      [
        "source",
        "update",
        "--force",
        "--commit",
        "--message",
        "chore: force cli upstream v4",
        "--yes",
        "--vault",
        vaultPath,
        "--json",
      ],
      { workspace },
    ),
    "source update force",
  );
  equal(forced.applied, true, "forced update applied");
  assert(
    readFile(vaultPath, "packages/cli-repo/skills/alpha/SKILL.md").includes("CLI-UPSTREAM-V4."),
    "forced update overwrote local edit",
  );
  assert(readFile(vaultPath, "vault.lock").includes(fourthCommit), "forced update pinned commit");

  const forkPreview = ok<Payload>(
    runCli(["source", "fork", "alpha", "--as", "alpha-local", "--vault", vaultPath, "--json"], { workspace }),
    "fork preview",
  );
  equal(forkPreview.newSourceName, "alpha-local", "fork preview name");
  assert(!fs.existsSync(path.join(vaultPath, "skills/alpha-local")), "fork preview wrote nothing");
  const forked = ok<Payload>(
    runCli(
      ["source", "fork", "alpha", "--as", "alpha-local", "--vault", vaultPath, "--yes", "--json"],
      { workspace },
    ),
    "fork apply",
  );
  equal(forked.skill, "alpha", "fork skill");
  const forkedSkill = readFile(vaultPath, "skills/alpha-local/SKILL.md");
  assert(forkedSkill.includes("name: alpha-local"), "fork renamed frontmatter");
  assert(forkedSkill.includes("CLI-UPSTREAM-V4."), "fork carries latest content");
  const forkedSource = readFile(vaultPath, "sources/alpha-local.yml");
  assert(forkedSource.includes("origin: local") && forkedSource.includes("repo: e2e/cli-repo"), "fork metadata");

  const removePreview = ok<Payload>(
    runCli(["source", "remove", "cli-repo", "--vault", vaultPath, "--json"], { workspace }),
    "source remove preview",
  );
  equal(removePreview.source.name, "cli-repo", "remove preview source");
  assert(fs.existsSync(path.join(vaultPath, "sources/cli-repo.yml")), "remove preview kept metadata");
  const removed = ok<Payload>(
    runCli(["source", "remove", "cli-repo", "--delete-files", "--vault", vaultPath, "--yes", "--json"], { workspace }),
    "source remove apply",
  );
  equal(removed.name, "cli-repo", "removed source name");
  assert(!fs.existsSync(path.join(vaultPath, "sources/cli-repo.yml")), "source metadata removed");
  assert(!fs.existsSync(path.join(vaultPath, "packages/cli-repo")), "working copy removed");
  assert(!fs.existsSync(path.join(vaultPath, "third_party/cli-repo")), "vendor copy removed");
  assert(fs.existsSync(path.join(vaultPath, "skills/alpha-local/SKILL.md")), "fork remains after source removal");
  const remaining = ok<Payload[]>(
    runCli(["source", "list", "--vault", vaultPath, "--json"], { workspace }),
    "source list after remove",
  );
  equal(remaining.length, 1, "remaining source count");
  console.log("      GitHub preview/apply, check, diff, dirty guard, update+commit, fork, remove OK");
}

async function pluginLifecycle(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-plugin");
  const repoName = "cli-plugin-kit";
  const upstream = path.join(workspace.root, `upstream-${repoName}`);
  const hookMarker = path.join(workspace.root, "hook-executed.marker");
  const writeManifest = (dir: string, version: string): void => {
    fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({ name: repoName, version, description: `CLI plugin ${version}` }, null, 2)}\n`,
      "utf8",
    );
  };
  writeManifest(upstream, "1.0.0");
  writeSkill(path.join(upstream, "skills", "guide"), "guide", "CLI plugin guide skill.", "PLUGIN-GUIDE-V1.");
  fs.mkdirSync(path.join(upstream, "commands"), { recursive: true });
  fs.writeFileSync(path.join(upstream, "commands", "hello.md"), "# hello\n", "utf8");
  fs.mkdirSync(path.join(upstream, "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(upstream, "hooks", "on-start.sh"),
    `#!/bin/sh\ntouch "${hookMarker}"\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(upstream, "LICENSE"), "MIT\n", "utf8");
  initGitRepo(upstream);
  const bare = path.join(workspace.remotes, `${repoName}.git`);
  git(workspace.root, ["clone", "--bare", upstream, bare]);
  const initialCommit = git(bare, ["rev-parse", "HEAD"]).trim();

  const vaultPath = initVault(workspace, "plugin-vault");
  const preview = ok<Payload>(
    runCli(["source", "add", "--repo", `e2e/${repoName}`, "--vault", vaultPath, "--json"], { workspace }),
    "plugin import preview",
  );
  equal(preview.shape, "plugin", "plugin preview shape");
  equal(preview.suggestedName, repoName, "plugin preview name");
  assert(!fs.existsSync(path.join(vaultPath, "plugins", repoName)), "plugin preview wrote nothing");

  const imported = ok<Payload>(
    runCli(["source", "add", "--repo", `e2e/${repoName}`, "--vault", vaultPath, "--yes", "--json"], { workspace }),
    "plugin import apply",
  );
  equal(imported.shape, "plugin", "plugin import shape");
  equal(imported.sourceName, repoName, "plugin import name");
  assert(fs.existsSync(path.join(vaultPath, "plugins", repoName, "hooks", "on-start.sh")), "plugin working copy stored");
  assert(
    fs.existsSync(path.join(vaultPath, "third_party", repoName, ".claude-plugin", "plugin.json")),
    "plugin vendor copy stored",
  );
  assert(!fs.existsSync(hookMarker), "import never executed plugin hooks");
  commitAll(vaultPath, "chore: import cli plugin");

  const listed = ok<Payload[]>(
    runCli(["plugin", "list", "--vault", vaultPath, "--json"], { workspace }),
    "plugin list",
  );
  equal(listed.length, 1, "plugin list count");
  equal(listed[0].name, repoName, "plugin list name");
  equal(listed[0].hasHooks, true, "plugin list hooks flag");
  equal(listed[0].containedSkills.length, 1, "plugin list contained skills");
  const shown = ok<Payload>(
    runCli(["plugin", "show", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin show",
  );
  equal(shown.version, "1.0.0", "plugin show version");
  equal(shown.locked.commit, initialCommit, "plugin show pinned commit");
  assert(!fs.existsSync(hookMarker), "plugin show never executed hooks");

  failure(
    runCli(
      [
        "target",
        "install",
        "guide",
        "--vault",
        vaultPath,
        "--dest",
        path.join(workspace.root, "agents"),
        "--id",
        "plugin-target",
        "--yes",
        "--json",
      ],
      { workspace },
    ),
    2,
    "plugin-not-installable",
    "contained skill install refused",
  );

  const current = ok<Payload>(
    runCli(["source", "check", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin check current",
  );
  equal(current.results[0].status, "current", "plugin check current");

  const secondCommit = advanceUpstreamRepo(workspace, repoName, (dir) => {
    writeManifest(dir, "2.0.0");
    writeSkill(path.join(dir, "skills", "guide"), "guide", "CLI plugin guide skill.", "PLUGIN-GUIDE-V2.");
    fs.writeFileSync(path.join(dir, "commands", "hello.md"), "# hello v2\n", "utf8");
    writeSkill(path.join(dir, "skills", "extra"), "extra", "CLI plugin extra skill.", "EXTRA-V1.");
    fs.rmSync(path.join(dir, "LICENSE"));
  });
  const updateCheck = ok<Payload>(
    runCli(["source", "check", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin check update",
  );
  equal(updateCheck.results[0].status, "update-available", "plugin check detects update");
  equal(updateCheck.results[0].remoteCommit, secondCommit, "plugin check remote commit");

  const diff = ok<Payload>(
    runCli(["source", "diff", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin diff",
  );
  const diffFiles = diff.files as Payload[];
  const diffPaths = diffFiles.map((file) => file.path);
  assert(diffPaths.includes(".claude-plugin/plugin.json"), "plugin diff manifest");
  assert(diffPaths.includes("skills/guide/SKILL.md"), "plugin diff whole-root skill path");
  assert(diffPaths.includes("skills/extra/SKILL.md"), "plugin diff added skill");
  assert(diffPaths.includes("LICENSE"), "plugin diff deleted license");
  equal(diffFiles.find((file) => file.path === "LICENSE")?.status, "deleted", "plugin diff deleted status");
  assert(
    diffFiles.some((file) => String(file.patch ?? "").includes("PLUGIN-GUIDE-V2.")),
    "plugin diff patch content",
  );

  const updatePreview = ok<Payload>(
    runCli(["source", "update", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin update preview",
  );
  equal(updatePreview.changes.length, 1, "plugin update preview count");
  assert(
    readFile(vaultPath, `plugins/${repoName}/skills/guide/SKILL.md`).includes("PLUGIN-GUIDE-V1."),
    "plugin update preview wrote nothing",
  );

  const updated = ok<Payload>(
    runCli(
      [
        "source",
        "update",
        repoName,
        "--commit",
        "--message",
        "chore: cli plugin v2",
        "--yes",
        "--vault",
        vaultPath,
        "--json",
      ],
      { workspace },
    ),
    "plugin update apply",
  );
  equal(updated.applied, true, "plugin update applied");
  assert(updated.commit, "plugin update commit returned");
  equal(updated.build.skills.length, 0, "plugin-only update skipped build");
  equal(updated.install, undefined, "plugin-only update installed nothing");
  for (const root of ["plugins", "third_party"]) {
    assert(
      readFile(vaultPath, `${root}/${repoName}/skills/guide/SKILL.md`).includes("PLUGIN-GUIDE-V2."),
      `${root} plugin guide updated`,
    );
    assert(
      readFile(vaultPath, `${root}/${repoName}/skills/extra/SKILL.md`).includes("EXTRA-V1."),
      `${root} plugin added skill copied`,
    );
    assert(!fs.existsSync(path.join(vaultPath, root, repoName, "LICENSE")), `${root} plugin deleted file removed`);
  }
  assert(readFile(vaultPath, "vault.lock").includes(secondCommit), "plugin update pinned commit");
  assert(!fs.existsSync(hookMarker), "plugin update never executed hooks");
  equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "plugin update commit left clean worktree");
  equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "chore: cli plugin v2", "plugin update commit message");

  const refreshed = ok<Payload>(
    runCli(["plugin", "show", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin show after update",
  );
  equal(refreshed.version, "2.0.0", "plugin version updated");
  equal(refreshed.locked.commit, secondCommit, "plugin lock commit updated");
  equal(
    (refreshed.containedSkills as Payload[]).map((skill) => skill.name).sort().join(","),
    "extra,guide",
    "plugin contained skills updated",
  );
  const cleanDiff = ok<Payload>(
    runCli(["source", "diff", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin diff after update",
  );
  equal(cleanDiff.files.length, 0, "plugin diff after update empty");

  fs.appendFileSync(path.join(vaultPath, "plugins", repoName, "skills", "guide", "SKILL.md"), "\nlocal edit\n", "utf8");
  commitAll(vaultPath, "chore: local plugin edit");
  advanceUpstreamRepo(workspace, repoName, (dir) => {
    writeManifest(dir, "3.0.0");
    writeSkill(path.join(dir, "skills", "guide"), "guide", "CLI plugin guide skill.", "PLUGIN-GUIDE-V3.");
  });
  failure(
    runCli(["source", "update", repoName, "--yes", "--vault", vaultPath, "--json"], { workspace }),
    1,
    "conflict",
    "plugin update modified-root guard",
  );
  assert(
    readFile(vaultPath, `plugins/${repoName}/skills/guide/SKILL.md`).includes("local edit"),
    "guarded plugin update kept local edit",
  );
  const forced = ok<Payload>(
    runCli(
      [
        "source",
        "update",
        repoName,
        "--force",
        "--commit",
        "--message",
        "chore: force cli plugin v3",
        "--yes",
        "--vault",
        vaultPath,
        "--json",
      ],
      { workspace },
    ),
    "plugin update force",
  );
  equal(forced.applied, true, "forced plugin update applied");
  assert(
    readFile(vaultPath, `plugins/${repoName}/skills/guide/SKILL.md`).includes("PLUGIN-GUIDE-V3."),
    "forced plugin update overwrote local edit",
  );

  const removePreview = ok<Payload>(
    runCli(["source", "remove", repoName, "--vault", vaultPath, "--json"], { workspace }),
    "plugin remove preview",
  );
  equal(removePreview.source.name, repoName, "plugin remove preview name");
  assert(fs.existsSync(path.join(vaultPath, "plugins", repoName)), "plugin remove preview kept files");
  const removed = ok<Payload>(
    runCli(["source", "remove", repoName, "--delete-files", "--yes", "--vault", vaultPath, "--json"], { workspace }),
    "plugin remove apply",
  );
  equal(removed.name, repoName, "plugin removed name");
  assert(!fs.existsSync(path.join(vaultPath, "sources", `${repoName}.yml`)), "plugin source metadata removed");
  assert(!fs.existsSync(path.join(vaultPath, "plugins", repoName)), "plugin working copy removed");
  assert(!fs.existsSync(path.join(vaultPath, "third_party", repoName)), "plugin vendor copy removed");
  assert(!readFile(vaultPath, "vault.lock").includes(repoName), "plugin lock entry removed");
  const remainingPlugins = ok<Payload[]>(
    runCli(["plugin", "list", "--vault", vaultPath, "--json"], { workspace }),
    "plugin list after remove",
  );
  equal(remainingPlugins.length, 0, "plugin list empty after remove");
  equal(
    ok<Payload>(runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }), "plugin vault validate").ok,
    true,
    "vault validates after plugin removal",
  );
  assert(!fs.existsSync(hookMarker), "plugin lifecycle never executed hooks");
  console.log("      plugin preview/apply, list/show, install guard, check, diff, update+force, remove OK");
}

function readFile(vaultPath: string, relative: string): string {
  return fs.readFileSync(path.join(vaultPath, relative), "utf8");
}

async function v1Migration(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-v1");
  const vaultPath = path.join(workspace.root, "v1");
  copyFixture("v1-basic", vaultPath);
  rewriteTargetDest(vaultPath, path.join(workspace.root, "agents"));
  initGitRepo(vaultPath);

  const status = ok<Payload>(runCli(["vault", "status", "--vault", vaultPath, "--json"], { workspace }), "v1 status");
  equal(status.format, "v1", "v1 format");
  equal(status.readOnly, true, "v1 read only");
  const validation = ok<Payload>(
    runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }),
    "v1 validate",
  );
  equal(validation.errors.length, 0, "v1 validation");

  const skills = writeSkillSet(workspace);
  const importBlocked = runCli(["source", "add", skills.alpha, "--vault", vaultPath, "--yes", "--json"], { workspace });
  failure(importBlocked, 1, "not-writable-v1", "v1 import blocked");
  const targetBlocked = runCli(
    ["target", "install", "alpha", "--vault", vaultPath, "--dest", path.join(workspace.root, "dest"), "--yes", "--json"],
    { workspace },
  );
  failure(targetBlocked, 1, "not-writable-v1", "v1 install blocked");
  assert(!fs.existsSync(path.join(vaultPath, "vault.yml")), "v1 guard wrote no vault.yml");

  const plan = ok<Payload>(runCli(["vault", "migrate", "--vault", vaultPath, "--json"], { workspace }), "migration preview");
  equal(plan.branch, "vault-v2", "migration branch");
  equal(plan.cleanWorktree, true, "migration clean preview");
  assert(plan.writes.some((write: Payload) => write.path === "vault.yml"), "migration writes vault.yml");
  assert(plan.writes.some((write: Payload) => write.path === ".gitignore"), "migration writes root gitignore");
  assert(plan.deletes.includes("sources.yml"), "migration deletes v1 sources");
  assert(!fs.existsSync(path.join(vaultPath, "vault.yml")), "migration preview wrote nothing");

  const applied = ok<Payload>(
    runCli(["vault", "migrate", "--vault", vaultPath, "--yes", "--json"], { workspace }),
    "migration apply",
  );
  assert(applied.commit, "migration commit returned");
  equal(applied.validation.ok, true, "migration validation");
  equal(applied.branch, "vault-v2", "migration applied branch");
  equal(git(vaultPath, ["branch", "--show-current"]).trim(), "vault-v2", "migration git branch");
  assert(fs.existsSync(path.join(vaultPath, "vault.yml")), "migration wrote vault.yml");
  assert(!fs.existsSync(path.join(vaultPath, "sources.yml")), "migration deleted v1 sources");
  equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "migration clean worktree");
  failure(
    runCli(["vault", "migrate", "--vault", vaultPath, "--json"], { workspace }),
    2,
    "unsupported",
    "migrate already v2",
  );

  const dirtyPath = path.join(workspace.root, "v1-dirty");
  copyFixture("v1-basic", dirtyPath);
  rewriteTargetDest(dirtyPath, path.join(workspace.root, "agents-dirty"));
  initGitRepo(dirtyPath);
  fs.writeFileSync(path.join(dirtyPath, "dirty.tmp"), "blocked\n", "utf8");
  failure(
    runCli(["vault", "migrate", "--vault", dirtyPath, "--yes", "--json"], { workspace }),
    1,
    "git-not-clean",
    "dirty migration blocked",
  );
  assert(!fs.existsSync(path.join(dirtyPath, "vault.yml")), "dirty migration wrote nothing");
  console.log("      v1 read-only guards, migration preview/apply, clean/dirty gates OK");
}

async function networkAndAuth(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-network");
  const vaultPath = initVault(workspace, "network-vault");
  const rewriteTo = (base: string): Record<string, string> => ({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${base}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/e2e/",
  });
  const networkEnv = { ...cliEnv(workspace), ...rewriteTo("http://127.0.0.1:1/") };
  const network = runCli(
    ["source", "add", "--repo", "e2e/net-repo", "--vault", vaultPath, "--yes", "--json"],
    { workspace, env: networkEnv },
  );
  failure(network, 3, "network", "network failure exit code");
  assert(!fs.existsSync(path.join(vaultPath, "sources/net-repo.yml")), "network failure wrote no metadata");

  makeUpstreamRepo(workspace, "private-repo", {
    alpha: "Private upstream alpha v1.",
    helper: "Private upstream helper v1.",
  });
  const emptyConfig = path.join(workspace.root, "gitconfig-empty");
  fs.writeFileSync(emptyConfig, "", "utf8");
  const isolated = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ASKPASS: "/usr/bin/false",
  };
  const token = "tok-2fa-9f3a";
  const server = await startSmartHttpServer({ root: workspace.remotes, username: "vaultdesk", password: token });
  try {
    const denied = await runCliAsync(
      ["source", "add", "--repo", "e2e/private-repo", "--vault", vaultPath, "--yes", "--json"],
      { ...cliEnv(workspace), ...isolated, ...rewriteTo(server.url) },
    );
    failure(denied, 3, "auth-failed", "missing credentials");
    assert(server.stats.unauthorized > 0, "server rejected unauthenticated request");

    const wrongPassword = server.url.replace("http://", "http://vaultdesk:wrong-token@");
    const rejected = await runCliAsync(
      ["source", "add", "--repo", "e2e/private-repo", "--vault", vaultPath, "--yes", "--json"],
      { ...cliEnv(workspace), ...isolated, ...rewriteTo(wrongPassword) },
    );
    failure(rejected, 3, "auth-failed", "wrong credentials");

    const authenticated = server.url.replace("http://", `http://vaultdesk:${token}@`);
    const authEnv = { ...cliEnv(workspace), ...isolated, ...rewriteTo(authenticated) };
    const preview = await runCliAsync(
      ["source", "add", "--repo", "e2e/private-repo", "--vault", vaultPath, "--json"],
      authEnv,
    );
    equal(ok<Payload>(preview, "private import preview").suggestedName, "private-repo", "private preview name");

    const imported = await runCliAsync(
      ["source", "add", "--repo", "e2e/private-repo", "--vault", vaultPath, "--yes", "--json"],
      authEnv,
    );
    const importedData = ok<Payload>(imported, "private import apply");
    equal(importedData.sourceName, "private-repo", "private import name");
    assert(
      fs.existsSync(path.join(vaultPath, "packages/private-repo/skills/alpha/SKILL.md")),
      "private repo working copy copied",
    );
    assert(
      fs.existsSync(path.join(vaultPath, "third_party/private-repo/alpha/SKILL.md")),
      "private repo vendor copy copied",
    );
    assert(
      server.stats.requests.some((entry) => entry.includes("/private-repo.git/info/refs")),
      "authenticated request reached the smart HTTP backend",
    );
    commitAll(vaultPath, "chore: import private repo");

    const checked = ok<Payload>(
      await runCliAsync(["source", "check", "--vault", vaultPath, "--json"], authEnv),
      "private source check",
    );
    equal(checked.results[0].status, "current", "private source current");

    const dest = path.join(workspace.root, "private-agents");
    ok<Payload>(
      await runCliAsync(
        ["target", "install", "alpha", "--vault", vaultPath, "--dest", dest, "--id", "private-target", "--yes", "--json"],
        authEnv,
      ),
      "private target install",
    );
    commitAll(vaultPath, "chore: private target");

    const nextCommit = advanceUpstreamRepo(workspace, "private-repo", (source) => {
      writeSkill(path.join(source, "skills", "alpha"), "alpha", "Private upstream alpha v2.", "PRIVATE-V2.");
    });
    const updated = ok<Payload>(
      await runCliAsync(
        [
          "source",
          "update",
          "--install",
          "--commit",
          "--message",
          "chore: private upstream v2",
          "--yes",
          "--vault",
          vaultPath,
          "--json",
        ],
        authEnv,
      ),
      "private source update",
    );
    equal(updated.install.length, 1, "private update reinstalled target");
    assert(readFile(vaultPath, "packages/private-repo/skills/alpha/SKILL.md").includes("PRIVATE-V2."), "private update content");
    assert(readFile(path.join(dest, "alpha"), "SKILL.md").includes("PRIVATE-V2."), "private installed content");
    assert(readFile(vaultPath, "vault.lock").includes(nextCommit), "private update pinned commit");

    const sourceFile = readFile(vaultPath, "sources/private-repo.yml");
    assert(sourceFile.includes("repo: e2e/private-repo"), "private source keeps owner/name metadata");
    assert(!sourceFile.includes(token), "private source metadata has no token");
    assert(!readFile(vaultPath, "vault.lock").includes(token), "lockfile has no token");
    for (const config of findFilesNamed(workspace.cache, "config")) {
      assert(!fs.readFileSync(config, "utf8").includes(token), `cache config leaked credentials: ${config}`);
    }
    assert(
      server.stats.requests.some((entry) => entry.includes("git-upload-pack")),
      "authenticated clone used git-upload-pack",
    );
  } finally {
    await server.close();
  }

  makeUpstreamRepo(workspace, "ssh-repo", { zeta: "SSH transport zeta." });
  const fakeSsh = path.join(workspace.root, "fake-ssh.sh");
  const sshLog = path.join(workspace.root, "fake-ssh.log");
  fs.writeFileSync(
    fakeSsh,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> '${sshLog}'\nfor last; do :; done\nexec /bin/sh -c "$last"\n`,
    { mode: 0o755 },
  );
  const sshEnv = {
    ...cliEnv(workspace),
    ...isolated,
    GIT_SSH_COMMAND: fakeSsh,
    ...rewriteTo(`ssh://git@vaultdesk-e2e.invalid${workspace.remotes}/`),
  };
  const sshImport = await runCliAsync(
    ["source", "add", "--repo", "e2e/ssh-repo", "--vault", vaultPath, "--yes", "--json"],
    sshEnv,
  );
  const sshData = ok<Payload>(sshImport, "SSH rewritten import");
  equal(sshData.sourceName, "zeta", "SSH import name");
  assert(fs.existsSync(path.join(vaultPath, "skills/zeta/SKILL.md")), "SSH import copied files");
  assert(fs.readFileSync(sshLog, "utf8").includes("git-upload-pack"), "fake ssh ran git-upload-pack");
  assert(!readFile(vaultPath, "sources/zeta.yml").includes("vaultdesk-e2e.invalid"), "SSH rewrite stays out of metadata");
  console.log("      CLI network/auth errors, Basic token success, update+install, credential hygiene, SSH rewrite OK");
}

function findFilesNamed(root: string, name: string): string[] {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFilesNamed(full, name));
    else if (entry.name === name) found.push(full);
  }
  return found;
}

function lockFileFor(workspace: Workspace, vaultPath: string): string {
  const canonical = path.resolve(fs.realpathSync(vaultPath));
  const name = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return path.join(workspace.locks, `${name}.lock`);
}

async function holdVaultLock(
  workspace: Workspace,
  vaultPath: string,
): Promise<{ release: () => Promise<void> }> {
  const coreUrl = pathToFileURL(path.join(repoRoot, "packages/core/dist/index.js")).href;
  const script = `import { acquireWriteLock } from ${JSON.stringify(coreUrl)};
const lock = acquireWriteLock(${JSON.stringify(vaultPath)});
process.stdout.write("LOCKED\\n");
process.stdin.resume();
process.stdin.on("end", () => { lock.release(); process.exit(0); });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: cliEnv(workspace),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lock holder did not start: ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("LOCKED")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`lock holder exited with ${code}: ${stderr}`));
    });
  });
  return {
    release: async () => {
      child.stdin.end();
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => child.on("exit", () => resolve()));
      }
    },
  };
}

async function locksAndJournal(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-reliability");
  const vaultPath = initVault(workspace, "reliability-vault");
  const skills = writeSkillSet(workspace);
  addLocal(workspace, vaultPath, skills.alpha);
  commitAll(vaultPath, "chore: reliability base");
  const dest = path.join(workspace.root, "lock-dest");
  const installArgs = [
    "target",
    "install",
    "alpha",
    "--vault",
    vaultPath,
    "--dest",
    dest,
    "--id",
    "lock-target",
    "--yes",
    "--json",
  ];

  const lockFile = lockFileFor(workspace, vaultPath);
  const holder = await holdVaultLock(workspace, vaultPath);
  try {
    assert(fs.existsSync(lockFile), "holder created the vault lock");
    failure(runCli(installArgs, { workspace }), 1, "conflict", "live cross-process lock blocks install");
    assert(!fs.existsSync(path.join(dest, "alpha")), "blocked install wrote no files");
  } finally {
    await holder.release();
  }
  assert(!fs.existsSync(lockFile), "released cross-process lock removed");
  ok<Payload>(runCli(installArgs, { workspace }), "install after lock release");

  const staleBodies: [string, string][] = [
    ["dead pid", JSON.stringify({ pid: 2147483646, vault: vaultPath, created_at: new Date().toISOString() })],
    ["corrupt payload", "{ this is not json"],
    [
      "aged live pid",
      JSON.stringify({ pid: process.pid, vault: vaultPath, created_at: new Date(Date.now() - 20 * 60_000).toISOString() }),
    ],
  ];
  for (const [label, body] of staleBodies) {
    fs.writeFileSync(lockFile, body, "utf8");
    ok<Payload>(runCli(installArgs, { workspace }), `install reclaims ${label} lock`);
    assert(!fs.existsSync(lockFile), `${label} lock reclaimed`);
  }

  const journalFile = path.join(vaultPath, ".vault/operation.json");
  const journal = {
    schema: 1,
    kind: "update",
    started_at: new Date().toISOString(),
    vault: fs.realpathSync(vaultPath),
    steps: [{ id: "fetch", label: "Fetch upstream", status: "running", started_at: new Date().toISOString() }],
  };
  fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  const journalStatus = ok<Payload>(runCli(["vault", "status", "--vault", vaultPath, "--json"], { workspace }), "status with journal");
  equal(journalStatus.operation.kind, "update", "status exposes journal kind");
  const humanStatus = runCli(["vault", "status", "--vault", vaultPath], { workspace });
  assert(humanStatus.stdout.includes("unfinished update operation"), "human status shows recovery warning");
  equal(ok<Payload>(runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }), "validate with journal").ok, true, "journal does not block validation");
  ok<Payload[]>(runCli(["source", "list", "--vault", vaultPath, "--json"], { workspace }), "source list with journal");
  assert(fs.existsSync(journalFile), "read-only commands keep the journal");
  fs.rmSync(journalFile);
  const cleanStatus = ok<Payload>(runCli(["vault", "status", "--vault", vaultPath, "--json"], { workspace }), "status without journal");
  equal(cleanStatus.operation, null, "journal cleared from status");
  console.log("      cross-process lock, stale/corrupt/aged reclaim, journal status and non-blocking reads OK");
}

async function crashDuringImport(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-crash");
  const vaultPath = initVault(workspace, "crash-vault");
  const sourceRoot = path.join(workspace.root, "crash-source");
  for (let index = 0; index < 1200; index += 1) {
    const name = `crash-${String(index).padStart(4, "0")}`;
    writeSkill(path.join(sourceRoot, name), name, "SIGKILL import fixture.");
  }
  const journalFile = path.join(vaultPath, ".vault/operation.json");
  const child = spawn(
    process.execPath,
    [cliPath, "source", "add", sourceRoot, "--vault", vaultPath, "--yes", "--json"],
    { env: cliEnv(workspace), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  let sawJournal = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(journalFile)) {
      try {
        const value = JSON.parse(fs.readFileSync(journalFile, "utf8")) as {
          kind?: string;
          steps?: { status?: string }[];
        };
        if (value.kind === "import" && value.steps?.some((step) => step.status === "running")) {
          sawJournal = true;
          break;
        }
      } catch {
        // The journal may be between atomic rename and a complete read.
      }
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert(sawJournal, `import never exposed an active journal (stdout: ${stdout}, stderr: ${stderr})`);
  child.kill("SIGKILL");
  const outcome = await exited;
  equal(outcome.signal, "SIGKILL", "import process was killed abruptly");

  assert(fs.existsSync(journalFile), "journal survives SIGKILL");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as {
    kind?: string;
    steps?: { status?: string }[];
  };
  equal(journal.kind, "import", "surviving journal keeps its operation kind");
  assert(journal.steps?.some((step) => step.status === "running"), "surviving journal keeps the active step");

  const lockFile = lockFileFor(workspace, vaultPath);
  assert(fs.existsSync(lockFile), "write lock survives SIGKILL");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid?: number };
  equal(lock.pid, child.pid, "lock records the killed process id");
  assert(
    !fs.existsSync(path.join(vaultPath, "sources", "crash-source.yml")),
    "SIGKILL landed before source metadata was written",
  );

  const status = ok<Payload>(
    runCli(["vault", "status", "--vault", vaultPath, "--json"], { workspace }),
    "status after SIGKILL",
  );
  equal(status.operation.kind, "import", "status reports the interrupted import");
  const humanStatus = runCli(["vault", "status", "--vault", vaultPath], { workspace });
  assert(humanStatus.stdout.includes("unfinished import operation"), "human status warns about the interrupted import");
  assert(fs.existsSync(journalFile), "read-only status does not clear the crash journal");
  console.log("      SIGKILL mid-import: journal and lock survive, status reports the unfinished operation OK");
}

async function pathsAndScale(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-paths");
  const vaultPath = initVault(workspace, "仓库 space 中文");
  const sourcePath = path.join(workspace.root, "导入 技能 源");
  writeSkill(sourcePath, "space-skill", "Path with spaces and Unicode.");
  const imported = addLocal(workspace, vaultPath, sourcePath);
  equal(imported.sourceName, "space-skill", "Unicode path import");
  const dest = path.join(workspace.root, "安装 目标 space");
  ok<Payload>(
    runCli(
      ["target", "install", "space-skill", "--vault", vaultPath, "--dest", dest, "--id", "unicode-target", "--yes", "--json"],
      { workspace },
    ),
    "install into space/Unicode destination",
  );
  assert(fs.existsSync(path.join(dest, "space-skill", ".vault-managed")), "space destination marker");

  fs.writeFileSync(path.join(vaultPath, "notes with space.md"), "first\n", "utf8");
  commitAll(vaultPath, "chore: spaced note");
  fs.appendFileSync(path.join(vaultPath, "notes with space.md"), "second\n", "utf8");
  const spacedCommit = ok<Payload>(
    runCli(
      ["git", "commit", "--vault", vaultPath, "--path", "notes with space.md", "--message", "test: spaced path", "--yes", "--json"],
      { workspace },
    ),
    "commit path with spaces",
  );
  assert(spacedCommit.commit, "spaced commit hash");
  const committedFiles = git(vaultPath, ["show", "--pretty=format:", "--name-only", "HEAD"]).split("\n").filter(Boolean);
  equal(committedFiles.join(","), "notes with space.md", "spaced commit contains the explicit path");

  const link = path.join(workspace.root, "vault link");
  fs.symlinkSync(fs.realpathSync(vaultPath), link, "dir");
  const linkedStatus = ok<Payload>(runCli(["vault", "status", "--vault", link, "--json"], { workspace }), "status through symlink");
  equal(linkedStatus.path, fs.realpathSync(vaultPath), "symlink status reports canonical path");
  ok<Payload>(runCli(["build", "--vault", link, "--yes", "--json"], { workspace }), "build through symlink");
  const linkedVerify = ok<Payload>(
    runCli(["target", "verify", "unicode-target", "--vault", link, "--json"], { workspace }),
    "verify through symlink",
  );
  equal(linkedVerify.filesInPlace, true, "symlink verify files in place");

  const scaleSource = path.join(workspace.root, "scale-source");
  const names = Array.from({ length: 120 }, (_, index) => `skill-${String(index).padStart(3, "0")}`);
  for (const name of names) writeSkill(path.join(scaleSource, name), name, `Scale skill ${name}.`);
  initGitRepo(scaleSource);
  const scaleStart = Date.now();
  const scaleImport = addLocal(workspace, vaultPath, scaleSource);
  equal(scaleImport.sourceName, "scale-source", "scale import source");
  const scaleDest = path.join(workspace.root, "scale-dest");
  const scaleInstall = ok<Payload>(
    runCli(
      ["target", "install", ...names, "--vault", vaultPath, "--dest", scaleDest, "--id", "scale-target", "--yes", "--json"],
      { workspace },
    ),
    "scale install 120 skills",
  );
  equal(scaleInstall.installed, 120, "scale installed count");
  equal(scaleInstall.verification.checked, 120, "scale verification count");
  const scaleVerify = ok<Payload>(
    runCli(["target", "verify", "scale-target", "--vault", vaultPath, "--json"], { workspace }),
    "scale verify",
  );
  equal(scaleVerify.filesInPlace, true, "scale verify files in place");
  const scaleBuild = ok<Payload>(runCli(["build", "--vault", vaultPath, "--yes", "--json"], { workspace }), "scale build");
  equal(scaleBuild.skills.length, 121, "scale build includes all skills");
  equal(ok<Payload>(runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }), "scale validate").ok, true, "scale validation");
  const elapsed = Date.now() - scaleStart;
  assert(elapsed < 120_000, `scale operations exceeded 120s: ${elapsed}ms`);
  console.log(`      120-skill import, install, verify, build, validate in ${elapsed}ms; Unicode/space/symlink paths OK`);
}

async function externalVolume(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("cli-volume");
  const dmg = path.join(workspace.root, "volume");
  const mount = path.join(workspace.root, "mnt");
  fs.mkdirSync(mount, { recursive: true });
  const create = spawnSync("hdiutil", ["create", "-size", "128m", "-fs", "APFS", "-volname", "VaultDeskE2E", "-o", dmg], {
    encoding: "utf8",
  });
  if (create.status !== 0) throw new Error(`hdiutil create failed: ${create.stderr || create.stdout}`);
  let attached = false;
  try {
    const attach = spawnSync("hdiutil", ["attach", "-nobrowse", "-readwrite", "-mountpoint", mount, `${dmg}.dmg`], {
      encoding: "utf8",
    });
    if (attach.status !== 0) throw new Error(`hdiutil attach failed: ${attach.stderr || attach.stdout}`);
    attached = true;
    const vaultPath = path.join(mount, "外部卷 vault");
    const init = ok<Payload>(
      runCli(["vault", "init", vaultPath, "--git", "--name", "external-volume", "--yes", "--json"], { workspace }),
      "init vault on external volume",
    );
    equal(init.gitInitialized, true, "external vault git initialized");
    configureGit(vaultPath);
    const source = path.join(workspace.root, "external-import");
    writeSkill(source, "volume-skill", "External volume skill.");
    addLocal(workspace, vaultPath, source);
    commitAll(vaultPath, "chore: external volume import");
    const dest = path.join(mount, "外部卷 agents");
    const installed = ok<Payload>(
      runCli(
        ["target", "install", "volume-skill", "--vault", vaultPath, "--dest", dest, "--id", "volume-target", "--yes", "--json"],
        { workspace },
      ),
      "install to external volume",
    );
    equal(installed.installed, 1, "external install count");
    assert(fs.existsSync(path.join(dest, "volume-skill", ".vault-managed")), "external destination marker");
    const dirty = git(vaultPath, ["status", "--porcelain"]).trim();
    assert(dirty.length > 0 && dirty.split("\n").every((line) => line.endsWith("vault.yml")), `external install dirtied only vault.yml: ${dirty}`);
    ok<Payload>(
      runCli(
        ["git", "commit", "--vault", vaultPath, "--path", "vault.yml", "--message", "chore: external target", "--yes", "--json"],
        { workspace },
      ),
      "commit external target registration",
    );
    equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "external vault committed clean");
    console.log("      APFS disk image vault, import, Git commit and managed install OK");
  } finally {
    if (attached) spawnSync("hdiutil", ["detach", mount, "-force"], { encoding: "utf8" });
  }
}


async function realGithub(suite: CliSuite): Promise<void> {
  const workspace = suite.workspace("real-github");
  const vaultPath = initVault(workspace, "real-github-vault");
  const repo = process.env.E2E_REAL_GITHUB_REPO ?? "anthropics/skills";
  const subpath = process.env.E2E_REAL_GITHUB_PATH ?? "skills/skill-creator";
  const add = runCli(
    [
      "source",
      "add",
      "--repo",
      repo,
      "--path",
      subpath,
      "--name",
      "real-skill-creator",
      "--vault",
      vaultPath,
      "--yes",
      "--json",
    ],
    { workspace },
  );
  if (add.status !== 0) {
    throw new Error(`real GitHub import failed (${add.status})\nstdout: ${add.stdout}\nstderr: ${add.stderr}`);
  }
  const imported = ok<Payload>(add, "real GitHub import");
  equal(imported.sourceName, "real-skill-creator", "real source name");
  equal(imported.shape, "standalone", "real source shape");
  assert(
    fs.existsSync(path.join(vaultPath, "third_party/skills/skill-creator/SKILL.md")),
    "real GitHub vendor copy exists",
  );
  assert(
    fs.existsSync(path.join(vaultPath, "skills/skill-creator/SKILL.md")),
    "real GitHub working copy exists",
  );
  const sourceYaml = fs.readFileSync(path.join(vaultPath, "sources/real-skill-creator.yml"), "utf8");
  assert(sourceYaml.includes(`repo: ${repo}`), "real repo recorded");
  assert(sourceYaml.includes(`source_path: ${subpath}`), "real source subpath recorded");
  const lock = fs.readFileSync(path.join(vaultPath, "vault.lock"), "utf8");
  const pinned = /commit: ([0-9a-f]{40})/.exec(lock)?.[1];
  assert(pinned, "real upstream commit pinned");

  const check = ok<Payload>(
    runCli(["source", "check", "real-skill-creator", "--vault", vaultPath, "--json"], { workspace }),
    "real GitHub check",
  );
  equal(check.results[0]?.status, "current", "real upstream is current");
  equal(check.results[0]?.remoteCommit, pinned, "real check matches the pinned commit");

  const diff = ok<Payload>(
    runCli(["source", "diff", "real-skill-creator", "--vault", vaultPath, "--json"], { workspace }),
    "real GitHub diff",
  );
  equal(diff.files.length, 0, "real pinned source has no file diff");
  equal(
    ok<Payload>(runCli(["vault", "validate", "--vault", vaultPath, "--json"], { workspace }), "real vault validate").ok,
    true,
    "real imported vault validates",
  );
  console.log(`      real GitHub import ${repo}@${subpath} (${pinned.slice(0, 12)}), check, diff and validation OK`);
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  const run = async (name: string, body: (suite: CliSuite) => Promise<void>): Promise<void> => {
    const only = process.env.E2E_ONLY?.toLowerCase();
    if (only && !name.toLowerCase().includes(only)) return;
    results.push(await scenario(name, body));
  };
  await run("CLI help, version, JSON envelope and usage errors", cliSurface);
  await run("CLI init, status, validate, imports and build", vaultImportBuild);
  await run("CLI target install, verify, remove, restore", targetLifecycle);
  await run("CLI git status, explicit-path commit and push", gitLifecycle);
  await run("CLI GitHub add, check, diff, update, fork, remove", githubLifecycle);
  await run("CLI plugin add, list, show, check, diff, update, remove", pluginLifecycle);
  await run("CLI v1 read-only guards and migration", v1Migration);
  await run("CLI network and auth exit codes", networkAndAuth);
  await run("CLI locks, stale reclaim and journal recovery state", locksAndJournal);
  await run("CLI SIGKILL mid-import leaves journal and stale lock", crashDuringImport);
  await run("CLI Unicode paths, symlinks and 120-skill scale", pathsAndScale);
  await run("CLI vault on an external APFS volume", externalVolume);
  if (process.env.E2E_REAL_GITHUB === "1") {
    await run("CLI real public GitHub clone, check and diff", realGithub);
  }
  if (results.some((value) => !value)) process.exitCode = 1;
}

await main();
