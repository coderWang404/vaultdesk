import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const desktopDir = path.join(repoRoot, "apps/desktop");
const electronBinary = createRequire(path.join(desktopDir, "package.json"))("electron") as string;

export interface Workspace {
  root: string;
  userData: string;
  cache: string;
  backups: string;
  locks: string;
  settingsFile: string;
  dialogFile: string;
  remotes: string;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  workspace: Workspace;
  close: () => Promise<void>;
}

let counter = 0;

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vaultdesk-e2e-${prefix}-`));
}

export function createWorkspace(label: string): Workspace {
  const root = tempDir(`${label}-${++counter}`);
  const workspace: Workspace = {
    root,
    userData: path.join(root, "user-data"),
    cache: path.join(root, "cache"),
    backups: path.join(root, "backups"),
    locks: path.join(root, "locks"),
    settingsFile: path.join(root, "settings.json"),
    dialogFile: path.join(root, "dialog-choice.txt"),
    remotes: path.join(root, "remotes"),
  };
  for (const dir of [workspace.userData, workspace.cache, workspace.backups, workspace.locks, workspace.remotes]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeSettings(workspace, {});
  return workspace;
}

export function writeSettings(workspace: Workspace, settings: Record<string, unknown>): void {
  const value = {
    autoSyncEnabled: false,
    checkIntervalHours: 1,
    backupRetention: 3,
    backupRetentionDays: 7,
    backupRoot: workspace.backups,
    ...settings,
  };
  fs.writeFileSync(workspace.settingsFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function setDialogChoice(workspace: Workspace, choice: string): void {
  fs.writeFileSync(workspace.dialogFile, `${choice}\n`, "utf8");
}

export function clearDialogChoice(workspace: Workspace): void {
  fs.rmSync(workspace.dialogFile, { force: true });
}

export function copyFixture(name: string, target: string): string {
  fs.cpSync(path.join(repoRoot, "fixtures", name), target, { recursive: true });
  return target;
}

export function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

export function initGitRepo(dir: string): void {
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "e2e@vaultdesk.local"]);
  git(dir, ["config", "user.name", "VaultDesk E2E"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "fixture"]);
}

export function commitAll(dir: string, message: string): string {
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

export function configureGitUrlRewrite(workspace: Workspace): Record<string, string> {
  const base = `file://${workspace.remotes.replace(/ /g, "%20")}/`;
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${base}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/e2e/",
  };
}

export const cliPath = path.join(repoRoot, "packages/cli/dist/index.js");

export function cliEnv(workspace: Workspace): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_CONFIG_")) env[key] = value;
  }
  return {
    ...env,
    ...configureGitUrlRewrite(workspace),
    VAULTDESK_CACHE_DIR: workspace.cache,
    VAULTDESK_BACKUP_DIR: workspace.backups,
    VAULTDESK_LOCK_DIR: workspace.locks,
    VAULTDESK_SETTINGS_FILE: workspace.settingsFile,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(
  args: string[],
  options: { workspace?: Workspace; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CliResult {
  const env = options.env ?? (options.workspace ? cliEnv(options.workspace) : process.env);
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env,
    timeout: 180_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
}

export async function runCliAsync(
  args: string[],
  options: { workspace?: Workspace; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  const env = options.env ?? (options.workspace ? cliEnv(options.workspace) : process.env);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd ?? repoRoot,
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

export function rewriteTargetDest(vaultPath: string, dest: string): void {  const v2 = path.join(vaultPath, "vault.yml");
  const file = fs.existsSync(v2) ? v2 : path.join(vaultPath, "install-targets.yml");
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(/^(\s*dest:\s*).*$/m, `$1${dest}`);
  if (next === text) throw new Error(`Could not rewrite target destination in ${file}`);
  fs.writeFileSync(file, next, "utf8");
}

export function writeSkill(dir: string, name: string, description: string, body = "Follow the test instructions."): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`,
    "utf8",
  );
}

export function makeUpstreamRepo(workspace: Workspace, repoName: string, skills: Record<string, string>): string {
  const source = path.join(workspace.root, `upstream-${repoName}`);
  for (const [name, description] of Object.entries(skills)) {
    writeSkill(path.join(source, "skills", name), name, description);
  }
  initGitRepo(source);
  const bare = path.join(workspace.remotes, `${repoName}.git`);
  fs.rmSync(bare, { recursive: true, force: true });
  git(workspace.root, ["clone", "--bare", source, bare]);
  return git(bare, ["rev-parse", "HEAD"]).trim();
}

export function advanceUpstreamRepo(
  workspace: Workspace,
  repoName: string,
  update: (source: string) => void,
): string {
  const source = path.join(workspace.root, `upstream-${repoName}`);
  update(source);
  commitAll(source, `update ${repoName}`);
  git(source, ["push", path.join(workspace.remotes, `${repoName}.git`), "main"]);
  return git(source, ["rev-parse", "HEAD"]).trim();
}

export async function launchApp(options: {
  workspace: Workspace;
  initialVault?: string | null;
  settings?: Record<string, unknown>;
  extraEnv?: Record<string, string>;
  label?: string;
}): Promise<LaunchedApp> {
  const { workspace } = options;
  if (options.settings) writeSettings(workspace, options.settings);
  clearDialogChoice(workspace);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_CONFIG_")) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  env.VAULTDESK_INITIAL_VAULT = options.initialVault ?? "";
  env.VAULTDESK_SETTINGS_FILE = workspace.settingsFile;
  env.VAULTDESK_USER_DATA = workspace.userData;
  env.VAULTDESK_CACHE_DIR = workspace.cache;
  env.VAULTDESK_BACKUP_DIR = workspace.backups;
  env.VAULTDESK_LOCK_DIR = workspace.locks;
  env.VAULTDESK_TEST_DIRECTORY_FILE = workspace.dialogFile;
  env.GIT_TERMINAL_PROMPT = "0";
  Object.assign(env, configureGitUrlRewrite(workspace), options.extraEnv ?? {});

  const app = await electron.launch({
    executablePath: electronBinary,
    args: [desktopDir],
    cwd: desktopDir,
    env,
    timeout: 45_000,
  });
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(15_000);
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector(".boot-screen"), { timeout: 30_000 });
  return {
    app,
    page,
    workspace,
    close: async () => {
      await app.close().catch(() => undefined);
    },
  };
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function equal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function waitForText(page: Page, text: string, timeout = 15_000): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

export async function waitForHidden(page: Page, selector: string, timeout = 15_000): Promise<void> {
  await page.locator(selector).waitFor({ state: "hidden", timeout });
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeout = 15_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out after ${timeout}ms: ${message}`);
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function workspaceFile(workspace: Workspace, ...parts: string[]): string {
  return path.join(workspace.root, ...parts);
}

export async function openSection(page: Page, label: string): Promise<void> {
  await page.locator(".sidebar .nav-item", { hasText: label }).click();
  await page.waitForTimeout(150);
}

export async function dialog(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  const value = page.getByRole("dialog");
  await value.waitFor({ state: "visible" });
  return value;
}

export function fileExists(file: string): boolean {
  return fs.existsSync(file);
}

export function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}
