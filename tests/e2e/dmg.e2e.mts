import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import {
  assert,
  copyFixture,
  createWorkspace,
  dialog,
  equal,
  git,
  initGitRepo,
  openSection,
  read,
  repoRoot,
  waitFor,
  waitForText,
} from "./harness.js";

const version = (JSON.parse(read(path.join(repoRoot, "package.json"))) as { version: string }).version;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const dmgPath = path.join(repoRoot, "release", `VaultDesk-${version}-${arch}.dmg`);
const started = Date.now();

let mountPoint: string | null = null;
let mounted = false;
let installRoot: string | null = null;
let workspace: ReturnType<typeof createWorkspace> | null = null;
let app: ElectronApplication | null = null;

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function verifyPackage(): Promise<void> {
  assert(fs.existsSync(dmgPath), `DMG not found: ${dmgPath}. Run pnpm package:mac first.`);
  const verified = run("hdiutil", ["verify", dmgPath]);
  equal(verified.status, 0, `hdiutil verify: ${verified.stderr || verified.stdout}`);
  console.log(`      hdiutil verify OK (${(fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1)} MB)`);

  mountPoint = fs.mkdtempSync(path.join("/tmp", "vaultdesk-dmg-mount-"));
  const attach = run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);
  equal(attach.status, 0, `hdiutil attach: ${attach.stderr || attach.stdout}`);
  mounted = true;
  assert(fs.existsSync(path.join(mountPoint, "VaultDesk.app")), "DMG contains VaultDesk.app");
  assert(fs.existsSync(path.join(mountPoint, "Applications")), "DMG contains Applications link");

  installRoot = fs.mkdtempSync(path.join("/tmp", "vaultdesk-dmg-install-"));
  const copied = run("ditto", [path.join(mountPoint, "VaultDesk.app"), path.join(installRoot, "VaultDesk.app")]);
  equal(copied.status, 0, `ditto app: ${copied.stderr}`);
  const detach = run("hdiutil", ["detach", mountPoint]);
  equal(detach.status, 0, `hdiutil detach: ${detach.stderr || detach.stdout}`);
  mounted = false;
  fs.rmSync(mountPoint, { recursive: true, force: true });
  mountPoint = null;
}

function verifyBundle(): string {
  assert(installRoot, "install root missing");
  const appPath = path.join(installRoot, "VaultDesk.app");
  const plist = path.join(appPath, "Contents/Info.plist");
  const bundleId = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist]).stdout.trim();
  const shortVersion = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]).stdout.trim();
  equal(bundleId, "com.coderwang404.vaultdesk", "bundle identifier");
  equal(shortVersion, version, "bundle version");
  const binary = path.join(appPath, "Contents/MacOS/VaultDesk");
  assert(fs.existsSync(binary), "app executable exists");
  const archs = run("lipo", ["-archs", binary]).stdout.trim();
  equal(archs, arch, "app architecture");
  const asar = path.join(appPath, "Contents/Resources/app.asar");
  assert(fs.existsSync(asar) && fs.statSync(asar).size > 100_000, "app.asar is present");
  const agentSkill = path.join(appPath, "Contents/Resources/agent-skill/vaultdesk/SKILL.md");
  assert(fs.existsSync(agentSkill), "packaged agent skill resource is present");
  assert(read(agentSkill).includes("name: vaultdesk"), "packaged agent skill frontmatter");

  const signature = run("codesign", ["-dv", "--verbose=4", appPath]);
  const details = `${signature.stderr}${signature.stdout}`;
  const developerId = /Authority=Developer ID Application/.test(details);
  const adhoc = /Signature=adhoc/.test(details);
  assert(developerId || adhoc, `unknown signing state:\n${details}`);
  const signatureCheck = run("codesign", ["--verify", "--deep", "--strict", appPath]);
  equal(signatureCheck.status, 0, `codesign verify: ${signatureCheck.stderr || signatureCheck.stdout}`);
  if (developerId) {
    assert(!adhoc, `Developer ID app still reports ad-hoc: ${details}`);
  } else {
    assert(
      /Identifier=com\.coderwang404\.vaultdesk/.test(details),
      `ad-hoc signature identifier: ${details}`,
    );
    console.log("      WARN: app is ad-hoc signed; Developer ID signing and notarization are not configured");
  }
  const staple = run("xcrun", ["stapler", "validate", appPath]);
  if (developerId) {
    equal(staple.status, 0, `notarization ticket: ${staple.stderr || staple.stdout}`);
  } else {
    console.log(`      WARN: no notarization ticket (${(staple.stderr || staple.stdout).trim().split("\n").at(-1)})`);
  }
  const assessment = run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  console.log(
    `      Gatekeeper assessment exit=${assessment.status}: ${(assessment.stderr || assessment.stdout).trim().replace(/\s+/g, " ").slice(0, 160)}`,
  );
  const quarantine = run("xattr", ["-p", "com.apple.quarantine", appPath]);
  assert(quarantine.status !== 0, "locally built app must not carry a quarantine flag");
  return appPath;
}

async function exerciseApp(appPath: string): Promise<void> {
  workspace = createWorkspace("dmg");
  const vaultPath = path.join(workspace.root, "v2-basic");
  copyFixture("v2-basic", vaultPath);
  initGitRepo(vaultPath);
  fs.writeFileSync(
    workspace.settingsFile,
    `${JSON.stringify({ checkIntervalHours: 0, backupRetention: 10, backupRoot: workspace.backups }, null, 2)}\n`,
    "utf8",
  );

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_CONFIG_")) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    VAULTDESK_INITIAL_VAULT: vaultPath,
    VAULTDESK_USER_DATA: workspace.userData,
    VAULTDESK_SETTINGS_FILE: workspace.settingsFile,
    VAULTDESK_CACHE_DIR: workspace.cache,
    VAULTDESK_BACKUP_DIR: workspace.backups,
    VAULTDESK_LOCK_DIR: workspace.locks,
    GIT_TERMINAL_PROMPT: "0",
  });

  app = await electron.launch({
    executablePath: path.join(appPath, "Contents/MacOS/VaultDesk"),
    args: [],
    cwd: appPath,
    env,
    timeout: 45_000,
  });
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(15_000);
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector(".boot-screen"), { timeout: 30_000 });
  const tab = page.locator(".vault-tab").filter({ hasText: "v2-basic" });
  await tab.waitFor({ state: "visible", timeout: 30_000 });
  await waitForText(page, "仓库总览");

  await openSection(page, "来源");
  equal(await page.locator(".source-row").count(), 3, "packaged source count");
  await openSection(page, "技能");
  equal(await page.locator(".skill-table-row").count(), 4, "packaged skill count");
  await openSection(page, "安装目标");
  await waitForText(page, "fixture-agents");
  await openSection(page, "设置");
  const agentPanel = page.locator(".agent-skill-panel");
  await agentPanel.locator(".agent-skill-path .mono").waitFor();
  const bundledPath = (await agentPanel.locator(".agent-skill-path .mono").innerText()).trim();
  assert(
    bundledPath.includes("/Contents/Resources/agent-skill/vaultdesk/SKILL.md"),
    `packaged agent skill path: ${bundledPath}`,
  );
  assert(fs.existsSync(bundledPath), "packaged app reads the bundled agent skill");
  await openSection(page, "总览");
  await page.getByRole("button", { name: "校验仓库" }).click();
  const validation = await dialog(page);
  await waitForText(page, "0 个错误");
  await validation.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await validation.waitFor({ state: "hidden" });

  await openSection(page, "技能");
  await page.getByRole("button", { name: "编辑 local-notes" }).click();
  const editor = await dialog(page);
  const textarea = editor.getByLabel("local-notes 的 SKILL.md");
  const original = await textarea.inputValue();
  await textarea.fill(`${original}\nDMG-E2E-MARKER\n`);
  await editor.getByRole("button", { name: "保存" }).click();
  await editor.waitFor({ state: "hidden" });
  await waitForText(page, "已保存 local-notes");
  const editedFile = path.join(vaultPath, "skills/local-notes/SKILL.md");
  await waitFor(() => read(editedFile).includes("DMG-E2E-MARKER"), "packaged app wrote the edited skill");
  const status = git(vaultPath, ["status", "--porcelain"]);
  assert(status.includes("skills/local-notes/SKILL.md"), `edited file is dirty in Git: ${status}`);

  await app.close();
  app = null;
  assert(read(editedFile).includes("DMG-E2E-MARKER"), "edit persisted after app exit");
  console.log("      packaged app opened fixture, validated, edited and persisted a skill");
}

try {
  await verifyPackage();
  const appPath = verifyBundle();
  await exerciseApp(appPath);
  console.log(`  PASS packaged DMG mount, bundle, launch and write flow (${Date.now() - started}ms)`);
} catch (error) {
  console.error(`  FAIL packaged DMG (${Date.now() - started}ms)`);
  if (app) {
    const page = app.windows()[0];
    if (page) {
      const dir = path.join(repoRoot, "tests/e2e/artifacts");
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, "dmg.png"), fullPage: true }).catch(() => undefined);
    }
    await app.close().catch(() => undefined);
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  if (mounted && mountPoint) run("hdiutil", ["detach", mountPoint]);
  if (process.env.KEEP_E2E !== "1") {
    if (installRoot) fs.rmSync(installRoot, { recursive: true, force: true });
    if (mountPoint) fs.rmSync(mountPoint, { recursive: true, force: true });
    if (workspace) fs.rmSync(workspace.root, { recursive: true, force: true });
  } else {
    if (installRoot) console.log(`      install kept: ${installRoot}`);
    if (mountPoint) console.log(`      mount kept: ${mountPoint}`);
    if (workspace) console.log(`      workspace kept: ${workspace.root}`);
  }
}
