import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  advanceUpstreamRepo,
  assert,
  cliEnv,
  commitAll,
  copyFixture,
  createWorkspace,
  dialog,
  equal,
  git,
  initGitRepo,
  launchApp,
  makeUpstreamRepo,
  openSection,
  read,
  readJson,
  repoRoot,
  rewriteTargetDest,
  runCli,
  runCliAsync,
  setDialogChoice,
  waitFor,
  waitForText,
  writeSkill,
  type LaunchedApp,
  type Workspace,
} from "./harness.js";
import { startSmartHttpServer } from "./git-http-server.js";

const require = createRequire(import.meta.url);
const axeSourcePath = require.resolve("axe-core/axe.min.js");

class Suite {
  readonly name: string;
  readonly workspaces: Workspace[] = [];
  readonly apps: LaunchedApp[] = [];

  constructor(name: string) {
    this.name = name;
  }

  workspace(label: string): Workspace {
    const value = createWorkspace(label);
    this.workspaces.push(value);
    return value;
  }

  async launch(options: Parameters<typeof launchApp>[0]): Promise<LaunchedApp> {
    const launched = await launchApp(options);
    this.apps.push(launched);
    return launched;
  }

  async close(app: LaunchedApp): Promise<void> {
    const index = this.apps.indexOf(app);
    if (index >= 0) this.apps.splice(index, 1);
    await app.close();
  }

  async cleanup(success: boolean): Promise<void> {
    for (const app of this.apps.splice(0)) await app.close();
    if (success && process.env.KEEP_E2E !== "1") {
      for (const workspace of this.workspaces) fs.rmSync(workspace.root, { recursive: true, force: true });
    } else {
      for (const workspace of this.workspaces) console.log(`      workspace kept: ${workspace.root}`);
    }
  }

  async captureFailure(error: unknown): Promise<void> {
    const app = this.apps.at(-1);
    if (app) {
      const dir = path.join(process.cwd(), "tests/e2e/artifacts");
      fs.mkdirSync(dir, { recursive: true });
      await app.page.screenshot({ path: path.join(dir, `${this.name}.png`), fullPage: true }).catch(() => undefined);
      const text = await app.page.locator("body").innerText().catch(() => "");
      console.error(`      page text: ${text.replace(/\s+/g, " ").slice(0, 500)}`);
      console.error(`      screenshot: ${path.join(dir, `${this.name}.png`)}`);
    }
    console.error(error);
  }
}

async function scenario(name: string, body: (suite: Suite) => Promise<void>): Promise<boolean> {
  const suite = new Suite(name);
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await body(suite);
    await suite.cleanup(true);
    console.log(`  PASS ${name} (${Date.now() - started}ms)`);
    return true;
  } catch (error) {
    console.error(`  FAIL ${name} (${Date.now() - started}ms)`);
    await suite.captureFailure(error);
    await suite.cleanup(false);
    return false;
  }
}

async function v1ReadOnly(suite: Suite): Promise<void> {
  const workspace = suite.workspace("v1");
  const vaultPath = path.join(workspace.root, "v1-basic");
  copyFixture("v1-basic", vaultPath);
  rewriteTargetDest(vaultPath, path.join(workspace.root, "v1-agents"));
  initGitRepo(vaultPath);
  const launched = await suite.launch({ workspace, initialVault: null });

  await waitForText(launched.page, "把技能仓库放回它该在的位置");
    await waitForText(launched.page, "还没有打开过仓库");
    setDialogChoice(workspace, vaultPath);
    await launched.page.locator(".welcome-actions").getByRole("button", { name: "打开仓库" }).click();
    await waitForText(launched.page, "旧版仓库 · 只读");
    equal(await launched.page.locator(".vault-tab").count(), 1, "v1 tab count");
    await waitForText(launched.page, "v1 · 只读");

    await openSection(launched.page, "来源");
    await waitForText(launched.page, "v1 仓库以只读方式打开");
    equal(await launched.page.locator(".source-row").count(), 4, "v1 source count");
    equal(await launched.page.getByText("4 个来源").count(), 1, "v1 source toolbar");

    await openSection(launched.page, "技能");
    await waitForText(launched.page, "仓库里的全部技能");
    equal(await launched.page.locator(".skill-table-row").count(), 6, "v1 skill count");

    await openSection(launched.page, "安装目标");
    await waitForText(launched.page, "fixture-agents");
    await launched.page.getByRole("button", { name: "安装到目录" }).click();
    await waitForText(launched.page, "v1 仓库以只读方式打开。先完成迁移，再执行写入操作。");
    equal(await launched.page.getByRole("dialog").count(), 0, "v1 install dialog must not open");

    await openSection(launched.page, "Git");
    await waitForText(launched.page, "v1 仓库只读");
    equal(await launched.page.locator(".change-row input:checked").count(), 0, "v1 git selections");

    await openSection(launched.page, "工具");
    await waitForText(launched.page, "旧版仓库不支持工具卡");
    equal(await launched.page.locator(".tool-card").count(), 0, "v1 tool cards");

    await openSection(launched.page, "MCP");
    await waitForText(launched.page, "旧版仓库不支持 MCP 卡");
    equal(await launched.page.locator(".tool-card").count(), 0, "v1 MCP cards");

    await launched.page.locator(".nav-item", { hasText: "总览" }).click();
    await launched.page.getByRole("button", { name: "校验仓库" }).click();
    const validation = await dialog(launched.page);
    await waitForText(launched.page, "仓库校验");
    await waitForText(launched.page, "0 个错误");
    await validation.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();

    await launched.page.getByRole("button", { name: "关闭 v1-basic" }).click();
    await waitForText(launched.page, "把技能仓库放回它该在的位置");
    await waitForText(launched.page, "v1-basic");
    const recents = await readJson<{ vaults: { path: string; name: string }[] }>(
      path.join(workspace.userData, "recent-vaults.json"),
    );
    equal(recents.vaults.length, 1, "recent count");
    equal(recents.vaults[0]?.path, fs.realpathSync(vaultPath), "recent path");
    await launched.page.getByRole("button", { name: "移除最近记录 v1-basic" }).click();
    await waitForText(launched.page, "还没有打开过仓库");
    await waitFor(async () => {
      try {
        const next = await readJson<{ vaults: unknown[] }>(path.join(workspace.userData, "recent-vaults.json"));
        return next.vaults.length === 0;
      } catch {
        return false;
      }
    }, "recent list cleared");
    console.log("      read-only guard, validation, recents OK");
}

async function migration(suite: Suite): Promise<void> {
  const workspace = suite.workspace("migration");
  const vaultPath = path.join(workspace.root, "migration-v1");
  copyFixture("v1-basic", vaultPath);
  rewriteTargetDest(vaultPath, path.join(workspace.root, "v1-agents"));
  initGitRepo(vaultPath);
  fs.writeFileSync(path.join(vaultPath, "uncommitted.tmp"), "do not migrate over this\n", "utf8");
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;

  await page.getByRole("button", { name: "迁移预览" }).click();
    let modal = await dialog(page);
    await waitForText(page, "工作区不干净，迁移已阻止");
    equal(await modal.locator(".confirm-check input").isDisabled(), true, "dirty migration checkbox disabled");
    equal(await modal.getByRole("button", { name: "写入迁移" }).isDisabled(), true, "dirty migration button disabled");
    await modal.locator(".modal-footer").getByRole("button", { name: "取消" }).click();
    await modal.waitFor({ state: "hidden" });
    equal(fs.existsSync(path.join(vaultPath, "vault.yml")), false, "dirty migration must not write vault.yml");

    fs.rmSync(path.join(vaultPath, "uncommitted.tmp"));
    await page.getByRole("button", { name: "迁移预览" }).click();
    modal = await dialog(page);
    await waitForText(page, "工作区干净，可以迁移");
    await waitForText(page, "vault.yml");
    await waitForText(page, "sources.yml");
    await modal.locator(".confirm-check input").check();
    await modal.getByRole("button", { name: "写入迁移" }).click();
    await waitForText(page, "迁移已写入", 30_000);
    await waitForText(page, "迁移后的仓库通过校验");
    await modal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
    await modal.waitFor({ state: "hidden" });
    const versionBadge = page.locator(".vault-tags").getByText("v2", { exact: true });
    await versionBadge.waitFor({ state: "visible", timeout: 15_000 });
    await waitForText(page, "仓库总览");
    equal(await versionBadge.count() > 0, true, "v2 badge after migration");

    const branch = (
      await import("node:child_process").then(({ execFileSync }) =>
        execFileSync("git", ["branch", "--show-current"], { cwd: vaultPath, encoding: "utf8" }),
      )
    ).trim();
    equal(branch, "vault-v2", "migration branch");
    for (const file of ["vault.yml", "vault.lock", "sources/local-notes.yml", "sources/gh-standalone.yml"]) {
      if (!fs.existsSync(path.join(vaultPath, file))) throw new Error(`Missing migrated file ${file}`);
    }
    for (const file of ["sources.yml", "install-targets.yml", "packages/suite-pack/package.yml"]) {
      if (fs.existsSync(path.join(vaultPath, file))) throw new Error(`v1 file still present: ${file}`);
    }
    if (!fs.existsSync(path.join(vaultPath, "third_party/gh-standalone/SKILL.md"))) {
      throw new Error("third_party content was not preserved");
    }
    const status = (
      await import("node:child_process").then(({ execFileSync }) =>
        execFileSync("git", ["status", "--porcelain"], { cwd: vaultPath, encoding: "utf8" }),
      )
    ).trim();
    equal(status, "", "migration worktree clean");

    await openSection(page, "来源");
    equal(await page.locator(".source-row").count(), 4, "migrated source count");
    equal(await page.getByText("v1 仓库以只读方式打开").count(), 0, "migrated vault is writable");
    console.log("      blocked dirty migration, applied clean migration, files verified");
}

async function githubFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("github");
  const vaultPath = path.join(workspace.root, "github-vault");
  const initialCommit = makeUpstreamRepo(workspace, "alpha-repo", {
    alpha: "Upstream alpha v1.",
    helper: "Upstream helper v1.",
  });
  const cli = path.join(repoRoot, "packages/cli/dist/index.js");
  execFileSync(
    process.execPath,
    [cli, "vault", "init", vaultPath, "--git", "--name", "github-vault", "--yes"],
    { cwd: workspace.root, encoding: "utf8" },
  );
  initGitRepo(vaultPath);

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;

  await page.getByRole("button", { name: "导入技能" }).click();
    const importModal = await dialog(page);
    await importModal.getByRole("button", { name: "GitHub 仓库" }).click();
    await importModal.getByPlaceholder("JimLiu/baoyu-skills").fill("e2e/alpha-repo");
    await importModal.getByRole("button", { name: "预览分类" }).click();
    await waitFor(
      async () =>
        (await importModal.locator(".import-preview").count()) > 0 ||
        (await importModal.getByText("导入失败").count()) > 0,
      "GitHub preview result",
      60_000,
    );
    if ((await importModal.getByText("导入失败").count()) > 0) {
      throw new Error(`GitHub preview failed: ${(await importModal.innerText()).replace(/\s+/g, " ")}`);
    }
    await importModal.locator(".import-preview").waitFor({ state: "visible", timeout: 60_000 });
    await waitForText(page, "package/collection");
    await importModal.locator(".import-skill").filter({ hasText: "alpha" }).first().waitFor();
    assert(
      !fs.existsSync(path.join(vaultPath, "sources/alpha-repo.yml")),
      "GitHub preview must not write source metadata",
    );
    await importModal.getByRole("button", { name: "确认导入" }).click();
    await waitForText(page, "导入完成", 60_000);
    await importModal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
    await importModal.waitFor({ state: "hidden" });

    assert(fs.existsSync(path.join(vaultPath, "third_party/alpha-repo/alpha/SKILL.md")), "GitHub vendor copied");
    assert(
      fs.existsSync(path.join(vaultPath, "packages/alpha-repo/skills/alpha/SKILL.md")),
      "GitHub working copy copied",
    );
    const sourceYaml = read(path.join(vaultPath, "sources/alpha-repo.yml"));
    assert(sourceYaml.includes("repo: e2e/alpha-repo"), "GitHub repo recorded");
    assert(read(path.join(vaultPath, "vault.lock")).includes(initialCommit), "initial commit pinned in lock");
    commitAll(vaultPath, "chore: import alpha-repo");

    await openSection(page, "来源");
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "所有已检查来源都是最新", 60_000);
    const sourceRow = page.locator(".source-row").filter({ hasText: "alpha-repo" });
    await sourceRow.getByText("已是最新").waitFor();

    const updatedCommit = advanceUpstreamRepo(workspace, "alpha-repo", (source) => {
      writeSkill(path.join(source, "skills", "alpha"), "alpha", "Upstream alpha v2.", "UPSTREAM-V2 body.");
      fs.writeFileSync(path.join(source, "skills", "helper", "EXTRA.md"), "extra upstream file\n", "utf8");
    });
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "发现 1 个来源有可用更新", 60_000);
    await sourceRow.getByText("有更新").waitFor();

    await sourceRow.getByRole("button", { name: "差异" }).click();
    const diffModal = await dialog(page);
    await waitForText(page, "上游差异 · alpha-repo");
    await waitForText(page, "alpha/SKILL.md", 30_000);
    await waitForText(page, "helper/EXTRA.md", 30_000);
    await waitForText(page, "UPSTREAM-V2 body.", 30_000);
    await diffModal.locator(".modal-header").getByRole("button", { name: "关闭" }).click();
    await diffModal.waitFor({ state: "hidden" });

    fs.writeFileSync(path.join(vaultPath, "dirty.tmp"), "block writes\n", "utf8");
    await openSection(page, "Git");
    await page.getByRole("button", { name: "刷新" }).click();
    await waitForText(page, "dirty.tmp");
    await openSection(page, "来源");
    await sourceRow.getByRole("button", { name: "更新" }).click();
    let updateModal = await dialog(page);
    await waitForText(page, "当前不能写入", 60_000);
    equal(await updateModal.locator(".confirm-check input").isDisabled(), true, "dirty update checkbox disabled");
    equal(await updateModal.getByRole("button", { name: "应用更新" }).isDisabled(), true, "dirty update button disabled");
    await updateModal.locator(".modal-footer").getByRole("button", { name: "取消" }).click();
    await updateModal.waitFor({ state: "hidden" });
    fs.rmSync(path.join(vaultPath, "dirty.tmp"));

    await openSection(page, "Git");
    await page.getByRole("button", { name: "刷新" }).click();
    await waitForText(page, "工作区干净");
    await openSection(page, "来源");
    await sourceRow.getByRole("button", { name: "更新" }).click();
    updateModal = await dialog(page);
    await updateModal.locator(".update-diff-layout").waitFor({ state: "visible", timeout: 60_000 });
    await updateModal.locator(".update-summary-row").getByText("1 个来源").waitFor();
    await updateModal.locator(".confirm-check input").check();
    await updateModal
      .locator(".toggle-row")
      .filter({ hasText: "同时创建 Git 提交" })
      .click();
    await updateModal.getByPlaceholder("chore: update alpha-repo").fill("chore: apply upstream alpha v2");
    await updateModal.getByRole("button", { name: "应用更新" }).click();
    await waitForText(page, "已应用 1 个来源", 60_000);
    await updateModal.waitFor({ state: "hidden" });

    assert(
      read(path.join(vaultPath, "packages/alpha-repo/skills/alpha/SKILL.md")).includes("UPSTREAM-V2 body."),
      "updated working copy",
    );
    assert(fs.existsSync(path.join(vaultPath, "packages/alpha-repo/skills/helper/EXTRA.md")), "added upstream file");
    assert(read(path.join(vaultPath, "vault.lock")).includes(updatedCommit), "updated commit pinned in lock");
    equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "update commit left worktree clean");
    equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "chore: apply upstream alpha v2", "update commit message");

    await sourceRow.getByRole("button", { name: "差异" }).click();
    const cleanDiff = await dialog(page);
    await waitForText(page, "没有文件差异", 60_000);
    await cleanDiff.locator(".modal-header").getByRole("button", { name: "关闭" }).click();
    await cleanDiff.waitFor({ state: "hidden" });

    await openSection(page, "技能");
    equal(await page.getByRole("button", { name: "编辑 alpha" }).count(), 0, "GitHub skill is not directly editable");
    await page.getByRole("button", { name: "Fork alpha" }).click();
    const forkModal = await dialog(page);
    await forkModal.locator(".fork-body input").fill("alpha-local");
    await waitForText(page, "alpha-local");
    await forkModal.getByRole("button", { name: "创建本地副本" }).click();
    await waitForText(page, "已把 alpha fork 成本地来源 alpha-local", 60_000);
    await forkModal.waitFor({ state: "hidden" });

    const forkedSkill = read(path.join(vaultPath, "skills/alpha-local/SKILL.md"));
    assert(forkedSkill.includes("name: alpha-local"), "forked skill renamed in frontmatter");
    assert(forkedSkill.includes("UPSTREAM-V2 body."), "fork carries latest upstream content");
    const forkedSource = read(path.join(vaultPath, "sources/alpha-local.yml"));
    assert(forkedSource.includes("origin: local"), "fork is a local source");
    assert(forkedSource.includes("repo: e2e/alpha-repo"), "fork records its upstream");
    assert(read(path.join(vaultPath, "sources/alpha-repo.yml")).includes("name: alpha"), "original GitHub source untouched");

    await page.getByRole("button", { name: "编辑 alpha-local" }).waitFor();
    equal(await page.getByRole("button", { name: "Fork alpha" }).count(), 1, "original GitHub skill remains read-only");
    await page.getByRole("button", { name: "编辑 alpha-local" }).click();
    const editor = await dialog(page);
    const textarea = editor.getByLabel("alpha-local 的 SKILL.md");
    await waitFor(async () => (await textarea.inputValue()).includes("name: alpha-local"), "forked editor loaded");
    equal(await textarea.isEditable(), true, "forked skill is editable");
    await editor.locator(".modal-footer").getByRole("button", { name: "取消" }).click();
    await editor.waitFor({ state: "hidden" });
    console.log("      GitHub import, check, diff, guarded update with commit, fork OK");
}

async function searchAndSettings(suite: Suite): Promise<void> {
  const workspace = suite.workspace("search-settings");
  const vaultA = path.join(workspace.root, "vault-a");
  const vaultB = path.join(workspace.root, "vault-b");
  for (const [dir, name] of [
    [vaultA, "vault-a"],
    [vaultB, "vault-b"],
  ] as const) {
    const init = runCli(["vault", "init", dir, "--git", "--name", name, "--yes"], { workspace });
    equal(init.status, 0, `vault init failed: ${init.stderr}`);
  }
  writeSkill(path.join(workspace.root, "imports", "alpha"), "alpha", "Search alpha.");
  writeSkill(path.join(workspace.root, "imports", "beta"), "beta", "Cross vault beta.");
  const addA = runCli(["source", "add", path.join(workspace.root, "imports", "alpha"), "--vault", vaultA, "--yes"], {
    workspace,
  });
  equal(addA.status, 0, `local import into vault A failed: ${addA.stderr}`);
  const addB = runCli(["source", "add", path.join(workspace.root, "imports", "beta"), "--vault", vaultB, "--yes"], {
    workspace,
  });
  equal(addB.status, 0, `local import into vault B failed: ${addB.stderr}`);

  const launched = await suite.launch({ workspace, initialVault: vaultA });
  const page = launched.page;
  setDialogChoice(workspace, vaultB);
  await page.getByRole("button", { name: "打开仓库" }).click();
  await page.locator(".vault-tab").filter({ hasText: "vault-b" }).waitFor({ state: "visible", timeout: 30_000 });

  await page.keyboard.press("Meta+k");
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").waitFor();
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("beta");
  const hit = palette.locator(".palette-hit").filter({ hasText: "beta" }).first();
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  const hitMeta = await hit.locator(".palette-hit-meta").innerText();
  assert(hitMeta.includes("vault-b"), `cross-vault hit meta: ${hitMeta}`);
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "hidden" });
  await page.locator(".vault-tab.is-active").filter({ hasText: "vault-b" }).waitFor();
  await page.locator(".skill-table-row.is-selected").filter({ hasText: "beta" }).waitFor({ state: "visible", timeout: 15_000 });

  await page.keyboard.press("Meta+k");
  const emptySearch = await dialog(page);
  await emptySearch.getByLabel("搜索技能、插件、MCP 与工具卡").fill("no-such-skill");
  await waitForText(page, "没有匹配的技能", 30_000);
  await page.keyboard.press("Escape");
  await emptySearch.waitFor({ state: "hidden" });

  await openSection(page, "设置");
  const checkInterval = page.getByLabel("检查间隔（小时）");
  const retention = page.getByLabel("每个目标保留备份数");
  const backupRoot = page.getByLabel("备份根目录");
  const customBackups = path.join(workspace.root, "custom-backups");
  equal(await checkInterval.inputValue(), "0", "interval setting readback");
  equal(await retention.inputValue(), "10", "retention setting readback");
  setDialogChoice(workspace, customBackups);
  const backupPanel = page.locator(".settings-panel").filter({ hasText: "备份根目录" });
  await backupPanel.getByRole("button", { name: "选择" }).click();
  await waitFor(async () => (await backupRoot.inputValue()) === customBackups, "backup root selected via dialog");
  await retention.fill("3");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "设置已保存", 30_000);
  const saved = await readJson<{ checkIntervalHours: number; backupRetention: number; backupRoot?: string }>(
    workspace.settingsFile,
  );
  equal(saved.checkIntervalHours, 0, "saved interval");
  equal(saved.backupRetention, 3, "saved retention");
  equal(saved.backupRoot, customBackups, "saved backup root");

  await checkInterval.fill("721");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "检查间隔必须是 0 到 720 之间的整数小时。", 30_000);
  await checkInterval.fill("0");
  await retention.fill("0");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "备份保留数量必须是 1 到 100 之间的整数。", 30_000);
  await retention.fill("3");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "设置已保存", 30_000);
  equal((await readJson<{ backupRetention: number }>(workspace.settingsFile)).backupRetention, 3, "invalid saves blocked");

  await suite.close(launched);
  const relaunched = await suite.launch({ workspace, initialVault: vaultB });
  await openSection(relaunched.page, "设置");
  equal(await relaunched.page.getByLabel("检查间隔（小时）").inputValue(), "0", "persisted interval after relaunch");
  equal(await relaunched.page.getByLabel("每个目标保留备份数").inputValue(), "3", "persisted retention after relaunch");
  equal(await relaunched.page.getByLabel("备份根目录").inputValue(), customBackups, "persisted backup root after relaunch");
  console.log("      cross-vault keyboard search, selection jump, settings validation and persistence OK");
}

async function pluginsFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("plugins");
  const vaultPath = path.join(workspace.root, "plugins-vault");
  const targetDest = path.join(workspace.root, "agents-target");
  copyFixture("v2-plugins", vaultPath);
  rewriteTargetDest(vaultPath, targetDest);
  initGitRepo(vaultPath);

  const demoDir = path.join(workspace.root, "demo-plugin-src");
  fs.mkdirSync(path.join(demoDir, "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(demoDir, "plugin.json"),
    `${JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "Local demo plugin", license: "MIT" }, null, 2)}\n`,
    "utf8",
  );
  writeSkill(path.join(demoDir, "skills", "demo-skill"), "demo-skill", "Demo plugin skill.");

  const upstream = path.join(workspace.root, "upstream-plugin-kit");
  fs.mkdirSync(path.join(upstream, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(upstream, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "plugin-kit", version: "2.0.0", description: "Upstream kit plugin", license: "MIT" }, null, 2)}\n`,
    "utf8",
  );
  writeSkill(path.join(upstream, "skills", "kit-review"), "kit-review", "Kit review skill.");
  initGitRepo(upstream);
  const bare = path.join(workspace.remotes, "plugin-kit.git");
  git(workspace.root, ["clone", "--bare", upstream, bare]);
  const pluginCommit = git(bare, ["rev-parse", "HEAD"]).trim();

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;

  const pluginStat = page.locator(".stat-card").filter({ hasText: "插件" });
  await pluginStat.getByText("3 个插件内技能").waitFor();
  equal(await pluginStat.locator("strong").innerText(), "5", "overview plugin count");

  await openSection(page, "插件");
  await page.locator(".plugin-row").first().waitFor();
  equal(await page.locator(".plugin-row").count(), 5, "fixture plugin rows");

  await page.getByLabel("筛选插件").fill("security");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 1, "security filter narrows to one plugin");
  assert((await page.locator(".plugin-row").innerText()).includes("qoder-scan"), "security filter matches qoder-scan");

  await page.getByLabel("筛选插件").fill("codex");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 2, "codex filter narrows to two plugins");
  const codexRows = await page.locator(".plugin-row").allInnerTexts();
  assert(codexRows.some((text) => text.includes("codex-only")), "codex-only matched by manifest agent");
  assert(codexRows.some((text) => text.includes("multi-manifest")), "multi-manifest matched by manifest agent");

  await page.getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 5, "search filter cleared");
  const originFilter = page.getByRole("group", { name: "插件来源" });
  await originFilter.getByRole("button", { name: "本地" }).click();
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 4, "local origin filter");
  const localRows = await page.locator(".plugin-row").allInnerTexts();
  assert(localRows.some((text) => text.includes("local-tools")), "local filter matches local-tools");
  await originFilter.getByRole("button", { name: "全部" }).click();
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 5, "origin filter reset");

  await page.locator(".plugin-row").filter({ hasText: "claude-kit" }).click();
  const inspector = page.locator(".inspector");
  await inspector.getByRole("heading", { name: "claude-kit" }).waitFor();
  await waitForText(page, "这个插件包含 hooks");
  await waitForText(page, "插件内技能");
  await inspector.locator(".plugin-issue-list").waitFor();
  assert(
    (await inspector.locator(".plugin-issue-list").innerText()).includes("hooks"),
    "plugin inspector surfaces the hooks warning from source metadata",
  );
  equal(await inspector.getByRole("button", { name: /安装/ }).count(), 0, "plugin inspector has no install action");
  assert(
    !fs.existsSync(path.join(vaultPath, "plugins/claude-kit/hooks/on-start.sh.ran")),
    "plugin hooks are never executed",
  );

  await openSection(page, "技能");
  equal(await page.locator(".skill-table-row").count(), 1, "plugin skills stay out of the installable skills list");

  await page.keyboard.press("Meta+k");
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("security");
  const hit = palette.locator(".palette-hit").filter({ hasText: "security-scan" }).first();
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  const hitText = await hit.innerText();
  assert(hitText.includes("插件内"), `plugin skill shape label: ${hitText}`);
  assert(hitText.includes("插件 qoder-scan"), `plugin skill shows its plugin: ${hitText}`);
  await hit.click();
  await palette.waitFor({ state: "hidden" });
  await page.locator(".nav-item.is-active").filter({ hasText: "插件" }).waitFor();
  await page.locator(".plugin-row.is-selected").filter({ hasText: "qoder-scan" }).waitFor();
  await page.locator(".inspector").getByRole("heading", { name: "qoder-scan" }).waitFor();

  await page.getByRole("button", { name: "导入插件" }).click();
  const localModal = await dialog(page);
  await localModal.getByPlaceholder("/path/to/skill-or-repo").fill(demoDir);
  await localModal.getByRole("button", { name: "预览分类" }).click();
  await localModal.locator(".import-preview").waitFor({ state: "visible", timeout: 30_000 });
  const localPreview = await localModal.locator(".import-preview").innerText();
  assert(localPreview.includes("插件"), "local preview marked as plugin");
  assert(localPreview.includes("plugins/demo-plugin"), "local preview target is plugins/demo-plugin");
  assert(localPreview.includes("1 个 manifest"), "local plugin manifest count");
  assert(localPreview.includes("1 个插件内技能"), "local plugin contained skill count");
  equal(await localModal.locator(".import-form.grid-three select").isDisabled(), true, "plugin import disables classification");
  await localModal.getByRole("button", { name: "确认导入" }).click();
  await waitForText(page, "导入完成", 30_000);
  assert((await localModal.innerText()).includes("插件只写入 vault"), "plugin apply note");
  await localModal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await localModal.waitFor({ state: "hidden" });
  assert(fs.existsSync(path.join(vaultPath, "plugins/demo-plugin/skills/demo-skill/SKILL.md")), "local plugin stored");
  assert(fs.existsSync(path.join(vaultPath, "sources/demo-plugin.yml")), "local plugin metadata written");
  assert(!fs.existsSync(path.join(vaultPath, "third_party/demo-plugin")), "local plugin has no vendor copy");
  assert(!fs.existsSync(targetDest), "plugin import wrote nothing to the agent target");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 6, "local plugin row appears", 30_000);

  await page.getByRole("button", { name: "导入插件" }).click();
  const githubModal = await dialog(page);
  await githubModal.getByRole("button", { name: "GitHub 仓库" }).click();
  await githubModal.getByPlaceholder("JimLiu/baoyu-skills").fill("e2e/plugin-kit");
  await githubModal.getByRole("button", { name: "预览分类" }).click();
  await githubModal.locator(".import-preview").waitFor({ state: "visible", timeout: 60_000 });
  const githubPreview = await githubModal.locator(".import-preview").innerText();
  assert(githubPreview.includes("plugin-kit"), "GitHub preview inferred the manifest name");
  assert(githubPreview.includes("1 个 manifest"), "GitHub plugin manifest count");
  assert(githubPreview.includes("1 个插件内技能"), "GitHub plugin contained skill count");
  await githubModal.getByRole("button", { name: "确认导入" }).click();
  await waitForText(page, "导入完成", 60_000);
  await githubModal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await githubModal.waitFor({ state: "hidden" });
  assert(
    fs.existsSync(path.join(vaultPath, "third_party/plugin-kit/.claude-plugin/plugin.json")),
    "GitHub plugin vendored",
  );
  assert(
    fs.existsSync(path.join(vaultPath, "plugins/plugin-kit/skills/kit-review/SKILL.md")),
    "GitHub plugin working copy",
  );
  const sourceYaml = read(path.join(vaultPath, "sources/plugin-kit.yml"));
  assert(sourceYaml.includes("shape: plugin"), "GitHub plugin metadata shape");
  assert(sourceYaml.includes("repo: e2e/plugin-kit"), "GitHub plugin metadata repo");
  assert(read(path.join(vaultPath, "vault.lock")).includes(pluginCommit), "GitHub plugin commit pinned");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 7, "GitHub plugin row appears", 30_000);
  await page.getByLabel("筛选插件").fill("plugin-kit");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 1, "GitHub plugin filter");
  assert(!fs.existsSync(targetDest), "GitHub plugin import wrote nothing to the agent target");

  await page.getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 7, "plugin filter cleared after GitHub import");

  const composedDir = path.join(workspace.root, "imports", "composed-kit");
  writeSkill(path.join(composedDir, "skills", "composed-skill"), "composed-skill", "Composed plugin skill.", "Composed body.");
  fs.writeFileSync(path.join(composedDir, ".mcp.json"), '{"mcpServers":{"demo":{"command":"node"}}}\n', "utf8");
  fs.writeFileSync(path.join(composedDir, "LICENSE"), "MIT\n", "utf8");

  await page.getByRole("button", { name: "导入插件" }).click();
  const composedModal = await dialog(page);
  await composedModal.getByPlaceholder("/path/to/skill-or-repo").fill(composedDir);
  await composedModal.getByRole("button", { name: "预览分类" }).click();
  await composedModal.locator(".import-preview").waitFor({ state: "visible", timeout: 30_000 });
  const composedPreview = await composedModal.locator(".import-preview").innerText();
  assert(composedPreview.includes("按组合识别"), "composition detection badge");
  assert(composedPreview.includes("无 manifest"), "manifest-less plugin preview");
  assert(composedPreview.includes("1 个插件内技能"), "composition contained skill count");
  await composedModal.getByRole("button", { name: "确认导入" }).click();
  await waitForText(page, "导入完成", 30_000);
  await composedModal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await composedModal.waitFor({ state: "hidden" });
  assert(fs.existsSync(path.join(vaultPath, "plugins/composed-kit/.mcp.json")), "composition plugin stored");
  assert(fs.existsSync(path.join(vaultPath, "sources/composed-kit.yml")), "composition metadata written");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 8, "composition plugin row appears", 30_000);
  await page.locator(".plugin-row").filter({ hasText: "composed-kit" }).click();
  await page
    .locator(".inspector")
    .getByText("没有 manifest；按 skills 与 MCP/commands/hooks 等工具资产组合识别。")
    .waitFor();

  commitAll(vaultPath, "chore: commit plugin imports");
  const pluginV2Commit = advanceUpstreamRepo(workspace, "plugin-kit", (source) => {
    fs.writeFileSync(
      path.join(source, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({ name: "plugin-kit", version: "2.1.0", description: "Upstream kit plugin", license: "MIT" }, null, 2)}\n`,
      "utf8",
    );
    writeSkill(path.join(source, "skills", "kit-review"), "kit-review", "Kit review skill.", "KIT-REVIEW-V2.");
    fs.mkdirSync(path.join(source, "commands"), { recursive: true });
    fs.writeFileSync(path.join(source, "commands", "hello.md"), "# hello\n", "utf8");
  });

  await openSection(page, "来源");
  const pluginSourceRow = page.locator(".source-row").filter({ hasText: "plugin-kit" });
  await pluginSourceRow.getByText("1 个技能").waitFor();
  await page.getByRole("button", { name: "检查", exact: true }).click();
  await pluginSourceRow.getByText("有更新").waitFor({ timeout: 60_000 });

  await pluginSourceRow.getByRole("button", { name: "差异" }).click();
  const diffModal = await dialog(page);
  await diffModal.locator(".diff-layout").waitFor({ state: "visible", timeout: 60_000 });
  const diffText = await diffModal.locator(".diff-files").innerText();
  assert(diffText.includes(".claude-plugin/plugin.json"), "plugin diff shows the whole-root manifest");
  assert(diffText.includes("skills/kit-review/SKILL.md"), "plugin diff shows the contained skill");
  assert(diffText.includes("commands/hello.md"), "plugin diff shows newly added assets");
  await diffModal.getByRole("button", { name: "关闭" }).click();
  await diffModal.waitFor({ state: "hidden" });

  await pluginSourceRow.getByRole("button", { name: "更新" }).click();
  const updateModal = await dialog(page);
  await updateModal.locator(".update-diff-layout").waitFor({ state: "visible", timeout: 60_000 });
  const updateText = await updateModal.locator(".update-diff-layout").innerText();
  assert(updateText.includes(".claude-plugin/plugin.json"), "plugin update preview lists the manifest");
  assert(updateText.includes("skills/kit-review/SKILL.md"), "plugin update preview lists the skill");
  await updateModal.locator(".confirm-check input").check();
  await updateModal.locator(".toggle-row").filter({ hasText: "同时创建 Git 提交" }).click();
  await updateModal.getByPlaceholder("chore: update plugin-kit").fill("chore: e2e plugin update");
  await updateModal.getByRole("button", { name: "应用更新" }).click();
  await waitForText(page, "已应用 1 个来源", 60_000);
  await updateModal.waitFor({ state: "hidden" });

  for (const root of ["plugins", "third_party"]) {
    assert(
      read(path.join(vaultPath, root, "plugin-kit", "skills", "kit-review", "SKILL.md")).includes("KIT-REVIEW-V2."),
      `${root} plugin skill updated`,
    );
    assert(
      fs.existsSync(path.join(vaultPath, root, "plugin-kit", "commands", "hello.md")),
      `${root} plugin asset added`,
    );
  }
  assert(
    read(path.join(vaultPath, "plugins/plugin-kit/.claude-plugin/plugin.json")).includes('"version": "2.1.0"'),
    "plugin working manifest updated",
  );
  assert(read(path.join(vaultPath, "vault.lock")).includes(pluginV2Commit), "plugin update pinned commit");
  equal(git(vaultPath, ["status", "--porcelain"]).trim(), "", "plugin update left a clean worktree");
  equal(git(vaultPath, ["log", "-1", "--pretty=%s"]).trim(), "chore: e2e plugin update", "plugin update commit message");
  assert(!fs.existsSync(targetDest), "plugin update wrote nothing to the agent target");

  await openSection(page, "插件");
  await page.getByLabel("筛选插件").fill("plugin-kit");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 1, "plugin filter after update");
  const updatedRow = await page.locator(".plugin-row").innerText();
  assert(updatedRow.includes("v2.1.0"), `plugin page shows the updated version: ${updatedRow}`);

  await openSection(page, "来源");
  await pluginSourceRow.getByRole("button", { name: "移除来源 plugin-kit" }).click();
  const removeModal = await dialog(page);
  await removeModal.locator(".toggle-row").filter({ hasText: "同时删除仓库内的工作副本与 vendor 目录" }).click();
  await removeModal.getByPlaceholder("plugin-kit").fill("plugin-kit");
  await removeModal.getByRole("button", { name: "移除来源" }).click();
  await waitForText(page, "已移除来源 plugin-kit", 60_000);
  await removeModal.waitFor({ state: "hidden" });
  assert(!fs.existsSync(path.join(vaultPath, "sources/plugin-kit.yml")), "plugin metadata removed via UI");
  assert(!fs.existsSync(path.join(vaultPath, "plugins/plugin-kit")), "plugin working copy removed via UI");
  assert(!fs.existsSync(path.join(vaultPath, "third_party/plugin-kit")), "plugin vendor removed via UI");
  await openSection(page, "插件");
  await waitFor(async () => (await page.locator(".plugin-row").count()) === 7, "plugin row removed", 30_000);

  console.log("      plugin page, filters, search routing, hooks warning, imports, composition, diff, update, remove OK");
}

async function toolsFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("tools");
  const vaultPath = path.join(workspace.root, "tools-vault");
  copyFixture("v2-plugins", vaultPath);
  initGitRepo(vaultPath);
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;

  const toolStat = page.locator(".stat-card").filter({ hasText: "外部工具卡" });
  await toolStat.waitFor();
  equal(await toolStat.locator("strong").innerText(), "2", "overview tool count");
  const mcpStat = page.locator(".stat-card").filter({ hasText: "独立 MCP 服务" });
  equal(await mcpStat.locator("strong").innerText(), "1", "overview MCP count");

  await openSection(page, "工具");
  const card = page.locator(".tool-card").filter({ hasText: "Kit CLI" });
  await card.waitFor();
  equal(await page.locator(".tool-card").count(), 2, "fixture tool card count");
  const text = await card.innerText();
  assert(text.includes("Kit CLI"), "tool card title");
  assert(text.includes("npm install --global kit-cli"), "tool card install command");
  assert(text.includes("Node.js 22+"), "tool card requirement");
  assert(text.includes("plain-skill"), "tool card related skill");
  assert(text.toLowerCase().includes("recorded for display only"), "tool card notes");
  assert(text.includes("tools/kit-cli.yml"), "tool card path");
  equal(await card.locator("button[title='复制安装命令']").count(), 1, "install copy button");

  await page.getByLabel("筛选工具卡").fill("kit-cli");
  equal(await page.locator(".tool-card").count(), 1, "tool filter keeps the card");
  await page.getByLabel("筛选工具卡").fill("no-such-tool");
  await waitForText(page, "没有匹配的工具卡");
  equal(await page.locator(".tool-card").count(), 0, "tool filter empties the grid");
  await page.getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".tool-card").count()) === 2, "tool filter cleared");

  await card.getByRole("button", { name: "复制安装命令" }).click();
  await waitForText(page, "已复制到剪贴板");

  await card.getByRole("button", { name: "plain-skill" }).click();
  await page.locator(".nav-item.is-active").filter({ hasText: "技能" }).waitFor();
  await page.locator(".inspector").getByRole("heading", { name: "plain-skill" }).waitFor();

  await page.locator(".search-trigger").click();
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("kit-cli");
  const hit = palette.locator(".palette-hit").filter({ hasText: "kit-cli" }).first();
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  const hitText = await hit.innerText();
  assert(hitText.includes("工具"), "tool search hit shape label");
  assert(hitText.includes("外部工具"), "tool search hit meta");
  await hit.click();
  await palette.waitFor({ state: "hidden" });
  await page.locator(".nav-item.is-active").filter({ hasText: "工具" }).waitFor();
  await page.locator(".tool-card").filter({ hasText: "Kit CLI" }).waitFor();
  assert(!fs.existsSync(path.join(vaultPath, "tools", "kit-cli.yml.tmp")), "tool page writes nothing");

  await openSection(page, "MCP");
  const mcpCard = page.locator(".tool-card").filter({ hasText: "Filesystem MCP" });
  await mcpCard.waitFor();
  equal(await page.locator(".tool-card").count(), 1, "MCP page filters tool cards by kind");
  const mcpText = await mcpCard.innerText();
  assert(mcpText.includes("MCP 服务"), "MCP card kind label");
  assert(mcpText.includes("npm install --global @modelcontextprotocol/server-filesystem"), "MCP install command");
  assert(mcpText.includes("mcp-server-filesystem /tmp"), "MCP connect command");
  assert(mcpText.includes("连接 / 启动"), "MCP connection section");
  assert(mcpText.includes("Node.js 22+"), "MCP requirement");
  assert(mcpText.includes("plain-skill"), "MCP related skill");
  assert(mcpText.includes("tools/filesystem-mcp.yml"), "MCP card path");
  const mcpBoundary = await page.locator(".tool-boundary").innerText();
  assert(mcpBoundary.includes("不检查新版本"), "MCP boundary copy");
  assert(mcpBoundary.includes("不代表已注册到任何 agent"), "MCP boundary register copy");
  equal(await mcpCard.locator("button[title='复制连接命令']").count(), 1, "MCP connect copy button");

  await page.getByLabel("筛选 MCP 卡").fill("no-such-mcp");
  await waitForText(page, "没有匹配的 MCP 卡");
  equal(await page.locator(".tool-card").count(), 0, "MCP filter empties the grid");
  await page.getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".tool-card").count()) === 1, "MCP filter cleared");

  await mcpCard.getByRole("button", { name: "复制连接命令" }).click();
  await waitForText(page, "已复制到剪贴板");

  await page.locator(".search-trigger").click();
  const mcpPalette = await dialog(page);
  await mcpPalette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("filesystem-mcp");
  const mcpHit = mcpPalette.locator(".palette-hit").filter({ hasText: "filesystem-mcp" }).first();
  await mcpHit.waitFor({ state: "visible", timeout: 30_000 });
  const mcpHitText = await mcpHit.innerText();
  assert(mcpHitText.includes("MCP"), "MCP search hit shape label");
  assert(mcpHitText.includes("MCP 服务"), "MCP search hit meta");
  await mcpHit.click();
  await mcpPalette.waitFor({ state: "hidden" });
  await page.locator(".nav-item.is-active").filter({ hasText: "MCP" }).waitFor();
  await page.locator(".tool-card").filter({ hasText: "Filesystem MCP" }).waitFor();
  assert(!fs.existsSync(path.join(vaultPath, "tools", "filesystem-mcp.yml.tmp")), "MCP page writes nothing");

  await suite.close(launched);
  console.log("      tool and MCP pages, filters, copy, related-skill jump and search routing OK");
}

async function autoCheckThrottle(suite: Suite): Promise<void> {
  const workspace = suite.workspace("auto-check");
  const vaultPath = path.join(workspace.root, "auto-vault");
  const initialCommit = makeUpstreamRepo(workspace, "auto-repo", { alpha: "Auto check alpha v1." });
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "auto-vault", "--yes"], { workspace });
  equal(init.status, 0, `vault init failed: ${init.stderr}`);
  const add = runCli(
    ["source", "add", "--repo", "e2e/auto-repo", "--vault", vaultPath, "--yes"],
    { workspace },
  );
  equal(add.status, 0, `GitHub source add failed: ${add.stderr}`);
  assert(read(path.join(vaultPath, "vault.lock")).includes(initialCommit), "initial upstream commit pinned");
  const stateFile = path.join(vaultPath, ".vault/state.json");

  let launched = await suite.launch({
    workspace,
    initialVault: vaultPath,
    settings: { checkIntervalHours: 24, backupRetention: 10, backupRoot: workspace.backups },
  });
  await waitFor(
    async () =>
      fs.existsSync(stateFile) && Boolean((await readJson<{ last_checked_at?: string }>(stateFile)).last_checked_at),
    "boot auto-check recorded state",
    60_000,
  );
  const firstCheck = (await readJson<{ last_checked_at: string }>(stateFile)).last_checked_at;
  assert(Number.isFinite(Date.parse(firstCheck)), "auto-check timestamp parsed");
  await suite.close(launched);

  advanceUpstreamRepo(workspace, "auto-repo", (source) => {
    writeSkill(path.join(source, "skills", "alpha"), "alpha", "Auto check alpha v2.", "AUTO-V2 body.");
  });
  const recent = new Date().toISOString();
  const state = await readJson<Record<string, unknown> & { last_checked_at?: string }>(stateFile);
  state.last_checked_at = recent;
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  launched = await suite.launch({
    workspace,
    initialVault: vaultPath,
    settings: { checkIntervalHours: 24, backupRetention: 10, backupRoot: workspace.backups },
  });
  await launched.page.locator(".source-health").waitFor({ state: "visible", timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  equal(
    (await readJson<{ last_checked_at: string }>(stateFile)).last_checked_at,
    recent,
    "recent check timestamp skips boot auto-check",
  );
  equal(await launched.page.getByText("发现 1 个来源有可用更新").count(), 0, "no update toast while throttled");
  await openSection(launched.page, "来源");
  await launched.page.locator(".source-row").filter({ hasText: "auto-repo" }).getByText("已是最新").waitFor();
  await suite.close(launched);

  const stale = new Date(Date.now() - 25 * 3_600_000).toISOString();
  const staleState = await readJson<Record<string, unknown> & { last_checked_at?: string }>(stateFile);
  staleState.last_checked_at = stale;
  fs.writeFileSync(stateFile, `${JSON.stringify(staleState, null, 2)}\n`, "utf8");
  launched = await suite.launch({
    workspace,
    initialVault: vaultPath,
    settings: { checkIntervalHours: 24, backupRetention: 10, backupRoot: workspace.backups },
  });
  await waitForText(launched.page, "发现 1 个来源有可用更新", 60_000);
  await openSection(launched.page, "来源");
  await launched.page.locator(".source-row").filter({ hasText: "auto-repo" }).getByText("有更新").waitFor();
  const refreshed = (await readJson<{ last_checked_at: string }>(stateFile)).last_checked_at;
  assert(Date.parse(refreshed) > Date.parse(stale), "stale timestamp triggers boot auto-check");
  console.log("      24h boot check gate: skipped recent timestamp, refreshed after stale timestamp");
}

async function autoCheckSessionOnce(suite: Suite): Promise<void> {
  const workspace = suite.workspace("auto-session");
  const vaultA = path.join(workspace.root, "session-a");
  const vaultB = path.join(workspace.root, "session-b");
  makeUpstreamRepo(workspace, "session-a", { alpha: "Session A alpha." });
  makeUpstreamRepo(workspace, "session-b", { beta: "Session B beta." });
  const emptyConfig = path.join(workspace.root, "gitconfig-empty");
  fs.writeFileSync(emptyConfig, "", "utf8");
  const username = "vaultdesk";
  const token = "tok-session-e2e";
  const server = await startSmartHttpServer({ root: workspace.remotes, username, password: token });
  try {
    const authenticated = server.url.replace("http://", `http://${username}:${token}@`);
    const remoteEnv = { ...cliEnv(workspace), ...gitRewriteEnv(authenticated, emptyConfig) };
    for (const [vaultPath, label, repo] of [
      [vaultA, "session-a", "e2e/session-a"],
      [vaultB, "session-b", "e2e/session-b"],
    ] as const) {
      equal(runCli(["vault", "init", vaultPath, "--git", "--name", label, "--yes"], { workspace }).status, 0, `${label} init`);
      const add = await runCliAsync(
        ["source", "add", "--repo", repo, "--vault", vaultPath, "--yes"],
        { workspace, env: remoteEnv },
      );
      equal(add.status, 0, `${label} source add: ${add.stderr}`);
      commitAll(vaultPath, `chore: import ${label}`);
    }

    const launched = await suite.launch({
      workspace,
      initialVault: vaultA,
      settings: { checkIntervalHours: 24, backupRetention: 10, backupRoot: workspace.backups },
      extraEnv: gitRewriteEnv(authenticated, emptyConfig),
    });
    const page = launched.page;
    const stateA = path.join(vaultA, ".vault/state.json");
    const stateB = path.join(vaultB, ".vault/state.json");
    const checked = async (file: string): Promise<boolean> => {
      if (!fs.existsSync(file)) return false;
      return Boolean((await readJson<{ last_checked_at?: string }>(file)).last_checked_at);
    };
    await waitFor(() => checked(stateA), "session A boot check", 60_000);
    const afterBoot = server.stats.requests.length;
    assert(afterBoot > 0, "boot check reached the upstream server");

    setDialogChoice(workspace, vaultB);
    await page.getByRole("button", { name: "打开仓库" }).click();
    await page.locator(".vault-tab").filter({ hasText: "session-b" }).waitFor({ state: "visible", timeout: 30_000 });
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-b" }).waitFor();
    await waitFor(() => checked(stateB), "session B first-activation check", 60_000);
    const afterB = server.stats.requests.length;
    assert(afterB > afterBoot, "opening session B triggered its check");

    await page.locator(".vault-tab").filter({ hasText: "session-a" }).click();
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-a" }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    equal(server.stats.requests.length, afterB, "switching back does not re-check a vault in the same session");

    await page.locator(".vault-tab").filter({ hasText: "session-b" }).click();
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-b" }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    equal(server.stats.requests.length, afterB, "returning to the other vault does not re-check either");

    await page.locator(".vault-tab").filter({ hasText: "session-a" }).click();
    await openSection(page, "来源");
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "所有已检查来源都是最新", 60_000);
    assert(server.stats.requests.length > afterB, "manual check still reaches the server");
    const afterManual = server.stats.requests.length;

    const tabA = page.locator(".vault-tab").filter({ hasText: "session-a" });
    const tabB = page.locator(".vault-tab").filter({ hasText: "session-b" });
    equal(await page.locator('[role="tab"]').count(), 2, "tablist exposes exactly the open vaults");
    equal(await tabA.getAttribute("tabindex"), "0", "active tab holds the roving tab stop");
    equal(await tabB.getAttribute("tabindex"), "-1", "inactive tab leaves the tab order");
    await tabA.focus();
    await page.keyboard.press("ArrowRight");
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-b" }).waitFor();
    equal(await tabB.evaluate((node) => node === document.activeElement), true, "ArrowRight moves focus and selection");
    await page.keyboard.press("Home");
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-a" }).waitFor();
    equal(await tabA.evaluate((node) => node === document.activeElement), true, "Home returns to the first tab");
    await page.keyboard.press("End");
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-b" }).waitFor();
    await page.keyboard.press("ArrowLeft");
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-a" }).waitFor();
    await page.getByRole("button", { name: "关闭 session-a" }).waitFor();
    equal(server.stats.requests.length, afterManual, "keyboard tab switching does not trigger checks");
    await page.getByRole("button", { name: "关闭 session-a" }).click();
    await page.locator(".vault-tab").filter({ hasText: "session-a" }).waitFor({ state: "detached" });
    equal(await page.locator('[role="tab"]').count(), 1, "titlebar close removes the active tab");
    console.log("      one automatic check per vault per session; roving tab keyboard navigation OK");
  } finally {
    await server.close();
  }
}

async function installFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("install");
  const vaultPath = path.join(workspace.root, "install-vault");
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "install-vault", "--yes"], { workspace });
  equal(init.status, 0, `vault init failed: ${init.stderr}`);
  writeSkill(path.join(workspace.root, "imports", "bundle", "alpha"), "alpha", "Install alpha.");
  writeSkill(path.join(workspace.root, "imports", "bundle", "beta"), "beta", "Install beta.");
  const dest = path.join(workspace.root, "agent-skills");
  const external = path.join(workspace.root, "external-beta");
  fs.mkdirSync(path.join(dest, "alpha"), { recursive: true });
  fs.writeFileSync(path.join(dest, "alpha", "SKILL.md"), "old unmanaged alpha\n", "utf8");
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, "SENTINEL.txt"), "do not touch\n", "utf8");
  fs.symlinkSync(external, path.join(dest, "beta"), "dir");

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;
  await importLocalSkill(page, path.join(workspace.root, "imports", "bundle"));

  await openSection(page, "安装目标");
  await page.getByRole("button", { name: "安装到目录" }).click();
  const install = await dialog(page);
  await install.getByLabel("安装目标目录").fill(dest);
  await install.getByLabel("目标 ID").fill("agent-skills");
  await install.getByRole("button", { name: "全选" }).click();
  await install.getByRole("button", { name: "预览计划" }).click();
  await waitForText(page, "安装计划", 30_000);
  await waitForText(page, "未受管");
  await waitForText(page, "符号链接");
  await install.getByRole("button", { name: "确认安装" }).click();
  await waitForText(page, "files in place", 60_000);
  await waitForText(page, "已备份 1 个未受管目录");
  await install.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await install.waitFor({ state: "hidden" });

  const card = page.locator(".target-card").filter({ hasText: "agent-skills" });
  await card.waitFor({ state: "visible", timeout: 30_000 });
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "alpha installed with marker");
  assert(fs.existsSync(path.join(dest, "beta", ".vault-managed")), "symlink replaced by managed directory");
  assert(!fs.lstatSync(path.join(dest, "beta")).isSymbolicLink(), "beta is no longer a symlink");
  assert(fs.existsSync(path.join(external, "SENTINEL.txt")), "symlink target untouched");
  const backupsForTarget = path.join(workspace.backups, "agent-skills");
  const stamps = fs.readdirSync(backupsForTarget).sort();
  assert(stamps.length > 0, "unmanaged backup created");
  const savedAlpha = read(path.join(backupsForTarget, stamps[0] as string, "alpha", "SKILL.md"));
  assert(savedAlpha.includes("old unmanaged alpha"), "unmanaged alpha moved into backup");
  assert(read(path.join(vaultPath, "vault.yml")).includes("agent-skills"), "install target registered in vault.yml");

  await card.getByRole("button", { name: "验证" }).click();
  await waitForText(page, "文件层面校验通过", 30_000);
  fs.appendFileSync(path.join(dest, "alpha", "SKILL.md"), "\nLOCAL-DRIFT\n", "utf8");
  await card.getByRole("button", { name: "验证" }).click();
  await waitForText(page, "发现 0 个缺失文件、1 个被修改文件", 30_000);

  await card.getByRole("button", { name: "安装", exact: true }).click();
  const reinstall = await dialog(page);
  await reinstall.getByRole("button", { name: "预览计划" }).click();
  await waitForText(page, "受管");
  await reinstall.getByRole("button", { name: "确认安装" }).click();
  await waitForText(page, "files in place", 60_000);
  await reinstall.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await reinstall.waitFor({ state: "hidden" });
  await waitFor(() => !read(path.join(dest, "alpha", "SKILL.md")).includes("LOCAL-DRIFT"), "managed reinstall replaced drift");

  await card.getByRole("button", { name: "备份" }).click();
  const backups = await dialog(page);
  await waitForText(page, "安装备份");
  await backups.locator(".backup-entry").first().waitFor({ state: "visible", timeout: 30_000 });
  await backups.locator(".backup-skill").filter({ hasText: "alpha" }).getByRole("button", { name: "恢复" }).click();
  const restoreConfirm = page.getByRole("dialog").last();
  await waitForText(page, "恢复 alpha？");
  await restoreConfirm.getByRole("button", { name: "恢复" }).click();
  await waitForText(page, "恢复完成", 30_000);
  assert(read(path.join(dest, "alpha", "SKILL.md")).includes("old unmanaged alpha"), "backup restored into slot");
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "restored slot carries marker");
  await backups.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await backups.waitFor({ state: "hidden" });

  await card.getByRole("button", { name: "移除目标 agent-skills" }).click();
  const removeConfirm = page.getByRole("dialog").last();
  await waitForText(page, "注销安装目标 agent-skills？");
  await removeConfirm.getByRole("button", { name: "注销目标" }).click();
  await waitForText(page, "已注销目标 agent-skills", 30_000);
  await waitFor(async () => (await page.locator(".target-card").count()) === 0, "target card removed");
  assert(!fs.existsSync(path.join(dest, "alpha")), "managed alpha moved out of destination");
  assert(!fs.existsSync(path.join(dest, "beta")), "managed beta moved out of destination");

  await page.getByRole("button", { name: "备份", exact: true }).click();
  const orphanBackups = await dialog(page);
  await waitForText(page, "目标已注销", 30_000);
  const orphanRestore = orphanBackups
    .locator(".backup-skill")
    .filter({ hasText: "alpha" })
    .getByRole("button", { name: "恢复" })
    .first();
  equal(await orphanRestore.isDisabled(), true, "restore disabled for unregistered target");
  await orphanBackups.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await orphanBackups.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "安装到目录" }).click();
  const reregister = await dialog(page);
  await reregister.getByLabel("安装目标目录").fill(dest);
  await reregister.getByLabel("目标 ID").fill("agent-skills");
  await reregister.getByRole("button", { name: "全选" }).click();
  await reregister.getByRole("button", { name: "预览计划" }).click();
  await waitForText(page, "安装计划", 30_000);
  await reregister.getByRole("button", { name: "确认安装" }).click();
  await waitForText(page, "files in place", 60_000);
  await reregister.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await reregister.waitFor({ state: "hidden" });
  await card.waitFor({ state: "visible", timeout: 30_000 });

  await card.getByRole("button", { name: "备份" }).click();
  const restoredBackups = await dialog(page);
  await restoredBackups.locator(".backup-entry").first().waitFor({ state: "visible", timeout: 30_000 });
  const enabledRestore = restoredBackups
    .locator(".backup-skill")
    .filter({ hasText: "alpha" })
    .getByRole("button", { name: "恢复" })
    .first();
  equal(await enabledRestore.isDisabled(), false, "restore enabled after re-registering target");
  await enabledRestore.click();
  await waitForText(page, "恢复 alpha？");
  await page.getByRole("dialog").last().getByRole("button", { name: "恢复" }).click();
  await waitForText(page, "恢复完成", 30_000);
  await restoredBackups.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await restoredBackups.waitFor({ state: "hidden" });
  console.log("      install plan, unmanaged backup, symlink replace, verify drift, reinstall, restore, remove, re-register OK");
}

async function openImportModal(page: LaunchedApp["page"]) {
  const empty = page.getByRole("button", { name: "导入技能" });
  if ((await empty.count()) > 0) {
    await empty.first().click();
  } else {
    await page.getByRole("button", { name: "导入", exact: true }).first().click();
  }
  return dialog(page);
}

async function importLocalSkill(page: LaunchedApp["page"], sourceDir: string): Promise<void> {
  const modal = await openImportModal(page);
  await modal.getByPlaceholder("/path/to/skill-or-repo").fill(sourceDir);
  await modal.getByRole("button", { name: "预览分类" }).click();
  await modal.locator(".import-preview").waitFor({ state: "visible", timeout: 30_000 });
  await modal.getByRole("button", { name: "确认导入" }).click();
  await waitForText(page, "导入完成", 30_000);
  await modal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await modal.waitFor({ state: "hidden" });
}

async function writableFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("writable");
  const vaultPath = path.join(workspace.root, "e2e-vault");
  const remote = path.join(workspace.remotes, "e2e-vault.git");
  git(workspace.root, ["init", "--bare", remote]);

  writeSkill(path.join(workspace.root, "imports", "alpha"), "alpha", "E2E standalone skill.", "Alpha body.");
  writeSkill(path.join(workspace.root, "duplicates", "alpha"), "alpha", "Conflicting alpha.", "Duplicate body.");
  writeSkill(path.join(workspace.root, "imports", "collection-bundle", "beta"), "beta", "Collection beta.");
  writeSkill(path.join(workspace.root, "imports", "collection-bundle", "gamma"), "gamma", "Collection gamma.");
  writeSkill(path.join(workspace.root, "imports", "suite-bundle", "delta"), "delta", "Suite helper.");
  writeSkill(path.join(workspace.root, "imports", "suite-bundle", "epsilon"), "epsilon", "Suite entrypoint.");

  const launched = await suite.launch({ workspace, initialVault: null });
  const page = launched.page;

  setDialogChoice(workspace, vaultPath);
    await page.locator(".welcome-actions").getByRole("button", { name: "新建仓库" }).click();
    const createModal = await dialog(page);
    await createModal.getByRole("button", { name: "选择" }).click();
    const pathInput = createModal.getByPlaceholder("/Users/you/Vaults/my-skills");
    await waitFor(async () => (await pathInput.inputValue()) === vaultPath, "new vault path selected");
    await createModal.getByRole("button", { name: "创建仓库" }).click();
    await createModal.waitFor({ state: "hidden", timeout: 30_000 });
    await waitForText(page, "这个仓库还没有技能");
    equal(await page.locator(".sidebar h2").innerText(), "e2e-vault", "new vault name");
    await page.locator(".vault-tags").getByText("v2", { exact: true }).waitFor();
    for (const file of ["vault.yml", "vault.lock", ".gitignore", ".vault/.gitignore", "README.md", "sources/.gitkeep"]) {
      assert(fs.existsSync(path.join(vaultPath, file)), `new vault missing ${file}`);
    }
    equal(git(vaultPath, ["branch", "--show-current"]).trim(), "main", "new vault branch");

    git(vaultPath, ["remote", "add", "origin", remote]);
    commitAll(vaultPath, "chore: initial vault");
    git(vaultPath, ["push", "-u", "origin", "main"]);

    await importLocalSkill(page, path.join(workspace.root, "imports", "alpha"));
    assert(fs.existsSync(path.join(vaultPath, "skills/alpha/SKILL.md")), "standalone skill copied");
    assert(fs.existsSync(path.join(vaultPath, "sources/alpha.yml")), "standalone source metadata written");
    await waitFor(() => fs.existsSync(path.join(vaultPath, "build")), "build artifacts generated");

    const duplicateModal = await openImportModal(page);
    await duplicateModal.getByPlaceholder("/path/to/skill-or-repo").fill(path.join(workspace.root, "duplicates", "alpha"));
    await duplicateModal.getByRole("button", { name: "预览分类" }).click();
    await waitForText(page, "存在命名冲突", 30_000);
    equal(
      await duplicateModal.getByRole("button", { name: "确认导入" }).isDisabled(),
      true,
      "conflicting import disabled",
    );
    await duplicateModal.locator(".modal-footer").getByRole("button", { name: "取消" }).click();
    await duplicateModal.waitFor({ state: "hidden" });
    assert(!fs.existsSync(path.join(vaultPath, "sources", "alpha-2.yml")), "conflicting import wrote no metadata");

    await importLocalSkill(page, path.join(workspace.root, "imports", "collection-bundle"));
    assert(fs.existsSync(path.join(vaultPath, "packages/collection-bundle/skills/beta/SKILL.md")), "collection beta copied");
    assert(fs.existsSync(path.join(vaultPath, "packages/collection-bundle/skills/gamma/SKILL.md")), "collection gamma copied");
    assert(fs.existsSync(path.join(vaultPath, "sources/collection-bundle.yml")), "collection source metadata written");

    const suiteModal = await openImportModal(page);
    await suiteModal.getByPlaceholder("/path/to/skill-or-repo").fill(path.join(workspace.root, "imports", "suite-bundle"));
    await suiteModal.locator(".import-form.grid-three select").selectOption("suite");
    await suiteModal.getByRole("button", { name: "预览分类" }).click();
    await waitForText(page, "A suite import requires --entrypoint.", 30_000);
    await suiteModal.getByPlaceholder("入口技能名").fill("epsilon");
    await suiteModal.getByRole("button", { name: "预览分类" }).click();
    await suiteModal.locator(".import-preview").waitFor({ state: "visible", timeout: 30_000 });
    await waitForText(page, "入口 epsilon");
    await suiteModal.getByRole("button", { name: "确认导入" }).click();
    await waitForText(page, "导入完成", 30_000);
    await suiteModal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
    await suiteModal.waitFor({ state: "hidden" });
    const suiteYaml = read(path.join(vaultPath, "sources/suite-bundle.yml"));
    assert(suiteYaml.includes("kind: suite"), "suite kind persisted");
    assert(suiteYaml.includes("entrypoint: epsilon"), "suite entrypoint persisted");
    assert(fs.existsSync(path.join(vaultPath, "packages/suite-bundle/skills/epsilon/SKILL.md")), "suite entrypoint copied");

    await openSection(page, "来源");
    equal(await page.locator(".source-row").count(), 3, "imported source count");
    await openSection(page, "总览");
    await page.getByRole("button", { name: "校验仓库" }).click();
    const validation = await dialog(page);
    await waitForText(page, "0 个错误");
    await validation.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();

    await openSection(page, "技能");
    equal(await page.locator(".skill-table-row").count(), 5, "imported skill count");
    await page.getByRole("button", { name: "编辑 alpha" }).click();
    const editor = await dialog(page);
    const textarea = editor.getByLabel("alpha 的 SKILL.md");
    await waitFor(async () => (await textarea.inputValue()).includes("name: alpha"), "skill editor loaded");
    const alphaFile = path.join(vaultPath, "skills/alpha/SKILL.md");
    const original = fs.readFileSync(alphaFile, "utf8");
    await textarea.fill(original.replace("name: alpha", "name: wrong-name"));
    await editor.getByRole("button", { name: "保存" }).click();
    await waitForText(page, "Frontmatter name must match the skill directory name.");
    equal(fs.readFileSync(alphaFile, "utf8"), original, "invalid edit must not write");
    await textarea.fill(`${original}\nE2E-EDIT-MARKER\n`);
    await editor.getByRole("button", { name: "保存" }).click();
    await editor.waitFor({ state: "hidden" });
    await waitForText(page, "已保存 alpha");
    await waitFor(() => fs.readFileSync(alphaFile, "utf8").includes("E2E-EDIT-MARKER"), "edited skill on disk");

    fs.mkdirSync(path.join(vaultPath, "notes"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "notes/private.md"), "keep this out of the UI commit\n", "utf8");
    git(vaultPath, ["add", "notes/private.md"]);

    await openSection(page, "Git");
    await page.getByRole("button", { name: "刷新" }).click();
    await waitFor(
      async () => (await page.locator(".change-row").count()) === 9,
      "all imported paths and the unrelated staged file listed",
      30_000,
    );
    const totalChanges = await page.locator(".change-row").count();
    await page.locator(".select-all input").check();
    equal(await page.locator(".change-row input:checked").count(), totalChanges, "select all changes");
    const noteRow = page.locator(".change-row").filter({ hasText: "notes/private.md" });
    await noteRow.waitFor();
    await noteRow.locator("input").uncheck();
    await waitFor(async () => !(await noteRow.locator("input").isChecked()), "unrelated path unchecked");
    await waitFor(
      async () => (await page.locator(".change-row input:checked").count()) === totalChanges - 1,
      "only unrelated path deselected",
    );
    await page.getByPlaceholder("例如：更新 baoyu-skills 到上游 4f2a1c").fill("test: import skills and edit alpha");
    await page.getByRole("button", { name: "创建提交" }).click();
    await waitForText(page, "已创建提交", 30_000);

    const committed = git(vaultPath, ["show", "--pretty=format:", "--name-only", "HEAD"])
      .split("\n")
      .filter(Boolean);
    assert(committed.includes("skills/alpha/SKILL.md"), "edited skill committed");
    assert(committed.includes("sources/suite-bundle.yml"), "suite metadata committed");
    assert(!committed.includes("notes/private.md"), "unrelated staged file must not be committed");
    assert(
      git(vaultPath, ["diff", "--cached", "--name-only"]).split("\n").includes("notes/private.md"),
      "unrelated staged file must survive the commit",
    );
    equal(git(vaultPath, ["status", "--porcelain"]).trim(), "A  notes/private.md", "only unrelated file remains dirty");

    await page.locator(".git-hero").getByRole("button", { name: "推送" }).click();
    const confirmPush = await dialog(page);
    await waitForText(page, "推送到远端？");
    await confirmPush.locator(".modal-footer").getByRole("button", { name: "推送" }).click();
    await waitForText(page, "已推送到上游分支", 30_000);
    await confirmPush.waitFor({ state: "hidden" });
    const localHead = git(vaultPath, ["rev-parse", "HEAD"]).trim();
    const remoteHead = git(workspace.root, ["--git-dir", remote, "rev-parse", "main"]).trim();
    equal(remoteHead, localHead, "pushed remote head");
    console.log("      create, import, edit, explicit-path commit, push OK");
}

function gitRewriteEnv(base: string, emptyConfig: string): Record<string, string> {
  return {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ASKPASS: "/usr/bin/false",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${base}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/e2e/",
  };
}

async function slowOfflineAndRecovery(suite: Suite): Promise<void> {
  const workspace = suite.workspace("offline-recovery");
  const vaultPath = path.join(workspace.root, "offline-vault");
  makeUpstreamRepo(workspace, "slow-repo", { alpha: "Slow upstream alpha.", helper: "Slow upstream helper." });
  const emptyConfig = path.join(workspace.root, "gitconfig-empty");
  fs.writeFileSync(emptyConfig, "", "utf8");
  const username = "vaultdesk";
  const token = "tok-offline-e2e";
  const server = await startSmartHttpServer({
    root: workspace.remotes,
    username,
    password: token,
    delayMs: 1500,
  });
  let serverOpen = true;
  try {
    const authenticated = server.url.replace("http://", `http://${username}:${token}@`);
    const remoteEnv = { ...cliEnv(workspace), ...gitRewriteEnv(authenticated, emptyConfig) };
    const init = runCli(["vault", "init", vaultPath, "--git", "--name", "offline-vault", "--yes"], { workspace });
    equal(init.status, 0, `vault init failed: ${init.stderr}`);
    const add = await runCliAsync(["source", "add", "--repo", "e2e/slow-repo", "--vault", vaultPath, "--yes"], {
      workspace,
      env: remoteEnv,
    });
    equal(add.status, 0, `slow source add failed: ${add.stderr}`);
    commitAll(vaultPath, "chore: import slow repo");
    const skillFile = path.join(vaultPath, "packages/slow-repo/skills/alpha/SKILL.md");
    const originalSkill = fs.readFileSync(skillFile, "utf8");

    const journalFile = path.join(vaultPath, ".vault/operation.json");
    fs.writeFileSync(
      journalFile,
      `${JSON.stringify(
        {
          schema: 1,
          kind: "update",
          started_at: new Date().toISOString(),
          vault: fs.realpathSync(vaultPath),
          steps: [
            { id: "fetch", label: "拉取上游", status: "running", started_at: new Date().toISOString() },
            { id: "apply", label: "写入工作副本", status: "pending" },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const extraEnv = gitRewriteEnv(authenticated, emptyConfig);
    const launched = await suite.launch({
      workspace,
      initialVault: vaultPath,
      settings: { checkIntervalHours: 0, backupRetention: 10, backupRoot: workspace.backups },
      extraEnv,
    });
    const page = launched.page;
    await page.locator(".recovery-banner").waitFor({ state: "visible", timeout: 30_000 });
    await waitForText(page, "上次操作未正常结束");
    await waitForText(page, "不会自动回滚");

    const started = Date.now();
    const checkButton = page.locator(".view.overview button.btn").filter({ hasText: "检查更新" });
    await checkButton.click();
    await waitFor(
      async () => checkButton.isDisabled(),
      "check button enters loading state",
      5_000,
    );
    await waitForText(page, "所有已检查来源都是最新", 60_000);
    const slowElapsed = Date.now() - started;
    assert(slowElapsed >= 1_400, `slow check returned too quickly: ${slowElapsed}ms`);

    await openSection(page, "来源");
    const sourceRow = page.locator(".source-row").filter({ hasText: "slow-repo" });
    await sourceRow.getByText("已是最新").waitFor();

    await server.close();
    serverOpen = false;
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "1 个来源检查失败，详情见来源状态", 60_000);
    await sourceRow.getByText("检查失败").waitFor();
    await openSection(page, "总览");
    await page.locator(".update-row").filter({ hasText: "slow-repo" }).getByText("检查失败").waitFor();

    await page.getByRole("button", { name: "刷新状态" }).click();
    await page.waitForTimeout(500);
    assert(await page.locator(".recovery-banner").isVisible(), "journal banner persists without a manual cleanup");
    fs.rmSync(journalFile);
    await page.getByRole("button", { name: "刷新状态" }).click();
    await page.locator(".recovery-banner").waitFor({ state: "hidden", timeout: 15_000 });
    equal(fs.readFileSync(skillFile, "utf8"), originalSkill, "journal recovery never rolled back working files");
    console.log(`      slow authenticated check (${slowElapsed}ms), offline warning, recovery banner lifecycle OK`);
  } finally {
    if (serverOpen) await server.close();
  }
}

async function desktopScale(suite: Suite): Promise<void> {
  const workspace = suite.workspace("desktop-scale");
  const vaultPath = path.join(workspace.root, "scale-vault");
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "scale-vault", "--yes"], { workspace });
  equal(init.status, 0, `scale vault init failed: ${init.stderr}`);
  const sourceRoot = path.join(workspace.root, "scale-source");
  for (let index = 0; index < 120; index += 1) {
    const name = `scale-skill-${String(index).padStart(3, "0")}`;
    writeSkill(path.join(sourceRoot, name), name, `Scale skill ${index}.`, `Body for ${name}.`);
  }
  const add = runCli(["source", "add", sourceRoot, "--vault", vaultPath, "--yes"], { workspace });
  equal(add.status, 0, `scale import failed: ${add.stderr}`);

  const started = Date.now();
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;
  await openSection(page, "技能");
  await waitFor(
    async () => (await page.locator(".skill-table-row").count()) === 120,
    "120 skills rendered",
    30_000,
  );
  const renderMs = Date.now() - started;
  assert(renderMs < 20_000, `120-skill render took ${renderMs}ms`);
  await page.getByLabel("搜索技能", { exact: true }).fill("scale-skill-119");
  await waitFor(async () => (await page.locator(".skill-table-row").count()) === 1, "scale search filters to one");
  await page.locator(".skill-table-row").filter({ hasText: "scale-skill-119" }).waitFor();
  await page.getByLabel("清除筛选").click();
  await waitFor(async () => (await page.locator(".skill-table-row").count()) === 120, "cleared search restores rows");

  await page.keyboard.press("Meta+k");
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("scale-skill-077");
  await palette.locator(".palette-hit").filter({ hasText: "scale-skill-077" }).first().waitFor({ timeout: 30_000 });
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "hidden" });
  await page.locator(".skill-table-row.is-selected").filter({ hasText: "scale-skill-077" }).waitFor();
  console.log(`      120 skills rendered in ${renderMs}ms, local filter and palette search OK`);
}

async function presetInstall(suite: Suite): Promise<void> {
  const workspace = suite.workspace("presets");
  const vaultPath = path.join(workspace.root, "preset-vault");
  const home = path.join(workspace.root, "home");
  fs.mkdirSync(home, { recursive: true });
  const presetsFile = path.join(workspace.root, "presets.yml");
  fs.writeFileSync(
    presetsFile,
    [
      "schema: 1",
      "tools:",
      "  - id: e2e-tool",
      "    label: E2E Tool",
      "    dest: ~/e2e-skills",
      '    verified_at: "2026-10-01"',
      '    verified_version: "1.2.3"',
      "    docs_url: null",
      "    verification_required: false",
      "    notes: Sandboxed preset used by the desktop E2E suite.",
      "    verify_command: 'printf \"desktop-ok\"; touch \"$HOME/preset-verify.marker\"'",
      "",
    ].join("\n"),
    "utf8",
  );
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "preset-vault", "--yes"], { workspace });
  equal(init.status, 0, `vault init failed: ${init.stderr}`);
  writeSkill(path.join(workspace.root, "imports", "alpha"), "alpha", "Preset alpha.");
  const add = runCli(["source", "add", path.join(workspace.root, "imports", "alpha"), "--vault", vaultPath, "--yes"], {
    workspace,
  });
  equal(add.status, 0, `preset import failed: ${add.stderr}`);

  const launched = await suite.launch({
    workspace,
    initialVault: vaultPath,
    extraEnv: { HOME: home, VAULTDESK_PRESETS_FILE: presetsFile },
  });
  const page = launched.page;
  await openSection(page, "设置");
  await waitForText(page, "E2E Tool");
  await waitForText(page, "已验证 2026-10-01");
  await waitForText(page, "~/e2e-skills");

  const agentPanel = page.locator(".agent-skill-panel");
  await agentPanel.locator(".agent-skill-path .mono").waitFor();
  const bundledPath = (await agentPanel.locator(".agent-skill-path .mono").innerText()).trim();
  assert(fs.existsSync(bundledPath), `bundled agent skill missing: ${bundledPath}`);
  assert(read(bundledPath).includes("vaultdesk"), "bundled agent skill content");
  await agentPanel.locator("summary").filter({ hasText: "查看 SKILL.md" }).click();
  await agentPanel.locator(".agent-skill-content").waitFor();

  await page.getByRole("button", { name: "验证命令" }).click();
  const verifyModal = await dialog(page);
  await waitForText(page, 'printf "desktop-ok"');
  assert(!fs.existsSync(path.join(home, "preset-verify.marker")), "preview must not run the verify command");
  equal(await verifyModal.locator(".verify-output").count(), 0, "no verify output before running");
  await verifyModal.getByRole("button", { name: "运行验证命令" }).click();
  await waitForText(page, "退出码 0");
  await verifyModal.locator(".verify-output").filter({ hasText: "desktop-ok" }).waitFor();
  assert(fs.existsSync(path.join(home, "preset-verify.marker")), "confirmed verify command ran under sandbox HOME");
  await verifyModal.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await verifyModal.waitFor({ state: "hidden" });

  await openSection(page, "安装目标");
  await page.getByRole("button", { name: "安装到目录" }).click();
  const install = await dialog(page);
  await install.locator(".preset-chip").filter({ hasText: "E2E Tool" }).click();
  equal(await install.getByLabel("安装目标目录").inputValue(), "~/e2e-skills", "preset fills destination");
  await install.getByLabel("目标 ID").fill("e2e-tool");
  await install.getByRole("button", { name: "全选" }).click();
  await install.getByRole("button", { name: "预览计划" }).click();
  await waitForText(page, "安装计划", 30_000);
  await install.getByRole("button", { name: "确认安装" }).click();
  await waitForText(page, "files in place", 60_000);
  await install.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await install.waitFor({ state: "hidden" });

  assert(fs.existsSync(path.join(home, "e2e-skills", "alpha", ".vault-managed")), "preset installed under sandbox HOME");
  assert(read(path.join(vaultPath, "vault.yml")).includes("e2e-tool"), "preset target registered");
  const realHomeTarget = path.join(process.env.HOME ?? "", "e2e-skills", "alpha", ".vault-managed");
  assert(!fs.existsSync(realHomeTarget), "preset install did not escape the sandbox HOME");
  console.log("      custom preset file, agent skill panel, verify preview/run, preset chip destination and sandboxed ~/ install OK");
}

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

async function auditPage(page: LaunchedApp["page"], label: string): Promise<number> {
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: unknown,
          ) => Promise<{
            violations: {
              id: string;
              impact: string | null;
              help: string;
              nodes: { target: string[]; html: string; failureSummary?: string }[];
            }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations;
  });
  const serious = violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  if (serious.length > 0) {
    throw new Error(
      `${label}: serious accessibility violations\n${JSON.stringify(
        serious.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            html: node.html.slice(0, 400),
            summary: node.failureSummary?.slice(0, 600),
          })),
        })),
        null,
        2,
      )}`,
    );
  }
  return violations.length;
}

async function focusInside(page: LaunchedApp["page"], selector: string): Promise<boolean> {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    return Boolean(root && document.activeElement && root.contains(document.activeElement));
  }, selector);
}

async function accessibilityAndKeyboard(suite: Suite): Promise<void> {
  const workspace = suite.workspace("a11y");
  const vaultPath = path.join(workspace.root, "a11y-vault");
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "a11y-vault", "--yes"], { workspace });
  equal(init.status, 0, `vault init failed: ${init.stderr}`);
  writeSkill(path.join(workspace.root, "imports", "alpha"), "alpha", "Accessible alpha.");
  writeSkill(path.join(workspace.root, "imports", "beta"), "beta", "Accessible beta.");
  const add = runCli(
    ["source", "add", path.join(workspace.root, "imports"), "--vault", vaultPath, "--yes"],
    { workspace },
  );
  equal(add.status, 0, `a11y import failed: ${add.stderr}`);

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(fs.readFileSync(axeSourcePath, "utf8"));
  const scans = [await auditPage(page, "overview")];
  for (const section of ["来源", "技能", "插件", "MCP", "工具", "安装目标", "Git", "设置"]) {
    await openSection(page, section);
    scans.push(await auditPage(page, section));
  }
  await openSection(page, "总览");

  const installButton = page.getByRole("button", { name: "安装技能" });
  await installButton.focus();
  await page.keyboard.press("Meta+k");
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").waitFor();
  equal(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "搜索技能、插件、MCP 与工具卡",
    "palette focuses its search input",
  );
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    assert(await focusInside(page, ".palette"), `palette tab ${index + 1} stays inside the dialog`);
  }
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "安装技能",
    "palette restores focus to its trigger",
  );

  await installButton.click();
  const install = await dialog(page);
  await waitForText(page, "安装技能");
  assert(await focusInside(page, ".modal"), "install dialog receives initial focus");
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    assert(await focusInside(page, ".modal"), `install dialog tab ${index + 1} stays inside`);
  }
  await page.keyboard.press("Shift+Tab");
  assert(await focusInside(page, ".modal"), "shift-tab stays inside the dialog");
  await page.keyboard.press("Escape");
  await install.waitFor({ state: "hidden" });
  equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "安装技能",
    "dialog restores focus to its trigger",
  );
  console.log(`      axe scans ${scans.join("/")} violations (none serious), palette and dialog focus trap OK`);
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  const run = async (name: string, body: (suite: Suite) => Promise<void>): Promise<void> => {
    const only = process.env.E2E_ONLY?.toLowerCase();
    if (only && !name.toLowerCase().includes(only)) return;
    results.push(await scenario(name, body));
  };
  await run("v1 read-only open, validation, guard, recents", v1ReadOnly);
  await run("migration blocked when dirty, then applied to vault-v2", migration);
  await run("create vault, local imports, edit, explicit commit and push", writableFlow);
  await run("GitHub import, check, diff, guarded update, fork", githubFlow);
  await run("install, backup, verify, restore, remove and re-register target", installFlow);
  await run("cross-vault search, settings validation and persistence", searchAndSettings);
  await run("plugin page, filters, search and imports", pluginsFlow);
  await run("tool page, filters, copy and search routing", toolsFlow);
  await run("boot auto-check honors the 24h interval", autoCheckThrottle);
  await run("auto-check runs once per vault per session", autoCheckSessionOnce);
  await run("slow check, offline warning and journal recovery banner", slowOfflineAndRecovery);
  await run("custom tool preset installs under a sandboxed HOME", presetInstall);
  await run("120-skill vault renders and searches in the desktop UI", desktopScale);
  await run("axe accessibility audit, focus trap and focus restore", accessibilityAndKeyboard);
  if (results.some((value) => !value)) process.exitCode = 1;
}

await main();
