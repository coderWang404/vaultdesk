import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
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

  await waitForText(launched.page, "还没有最近仓库");
    setDialogChoice(workspace, vaultPath);
    await launched.page.locator(".welcome-actions").getByRole("button", { name: "打开仓库" }).click();
    await waitForText(launched.page, "v1 · 只读");
    equal(await launched.page.locator(".vault-tab").count(), 1, "v1 tab count");
    equal(
      (await launched.page.locator(".vault-tab").getAttribute("title"))?.includes("v1 只读"),
      true,
      "v1 tab title",
    );

    await openSection(launched.page, "来源");
    await waitForText(launched.page, "迁移到 v2 后才能添加、更新或移除来源。");
    equal(await launched.page.locator(".source-row").count(), 4, "v1 source count");
    equal(await launched.page.getByText("4 个来源").count(), 1, "v1 source toolbar");

    await openSection(launched.page, "技能");
    await launched.page.getByLabel("搜索技能").waitFor();
    equal(await launched.page.locator(".skill-table-row").count(), 6, "v1 skill count");
    const typeFilter = launched.page.getByRole("group", { name: "技能类型筛选" });
    equal(await typeFilter.getByRole("button", { name: "全部" }).getAttribute("aria-pressed"), "true", "initial skill filter state");
    await typeFilter.getByRole("button", { name: "单技能" }).click();
    equal(await typeFilter.getByRole("button", { name: "单技能" }).getAttribute("aria-pressed"), "true", "selected skill filter state");
    await typeFilter.getByRole("button", { name: "全部" }).click();

    await openSection(launched.page, "安装目标");
    await waitForText(launched.page, "fixture-agents");
    await launched.page.getByRole("button", { name: "安装到目录" }).click();
    await waitForText(launched.page, "v1 仓库以只读方式打开。先完成迁移，再执行写入操作。");
    equal(await launched.page.getByRole("dialog").count(), 0, "v1 install dialog must not open");

    await openSection(launched.page, "Git");
    await waitForText(launched.page, "v1 仓库只读");
    equal(await launched.page.locator(".change-row input:checked").count(), 0, "v1 git selections");

    await openSection(launched.page, "工具");
    await waitForText(launched.page, "需要 v2 仓库");
    equal(await launched.page.locator(".tool-card").count(), 0, "v1 tool cards");

    await openSection(launched.page, "MCP");
    await waitForText(launched.page, "需要 v2 仓库");
    equal(await launched.page.locator(".tool-card").count(), 0, "v1 MCP cards");

    await launched.page.locator(".nav-item", { hasText: "总览" }).click();
    await launched.page.getByRole("button", { name: "校验仓库" }).click();
    const validation = await dialog(launched.page);
    await waitForText(launched.page, "仓库校验");
    await waitForText(launched.page, "0 个错误");
    await validation.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();

    await launched.page.getByRole("button", { name: "关闭 v1-basic" }).click();
    await waitForText(launched.page, "最近打开");
    await waitForText(launched.page, "v1-basic");
    const recents = await readJson<{ vaults: { path: string; name: string }[] }>(
      path.join(workspace.userData, "recent-vaults.json"),
    );
    equal(recents.vaults.length, 1, "recent count");
    equal(recents.vaults[0]?.path, fs.realpathSync(vaultPath), "recent path");
    await launched.page.getByRole("group", { name: "外观" }).getByRole("button", { name: "深色" }).click();
    await launched.page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await launched.page.reload();
    await waitForText(launched.page, "最近打开");
    equal(await launched.page.locator("html").getAttribute("data-theme"), "dark", "welcome theme persists after reload");
    await launched.page.getByRole("group", { name: "外观" }).getByRole("button", { name: "跟随系统" }).click();
    equal(await launched.page.evaluate(() => window.localStorage.getItem("vaultdesk.theme")), "system", "welcome can restore system theme");
    await launched.page.getByRole("button", { name: "移除最近记录 v1-basic" }).click();
    await waitForText(launched.page, "还没有最近仓库");
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
    await waitForText(page, "迁移后校验通过。");
    await modal.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
    await modal.waitFor({ state: "hidden" });
    const versionBadge = page.locator(".vault-tags").getByText("v2", { exact: true });
    await versionBadge.waitFor({ state: "visible", timeout: 15_000 });
    await waitForText(page, "仓库内容");
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

  await page.locator(".empty").getByRole("button", { name: "导入技能" }).click();
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
    await sourceRow.getByLabel("已是最新").waitFor();

    const updatedCommit = advanceUpstreamRepo(workspace, "alpha-repo", (source) => {
      writeSkill(path.join(source, "skills", "alpha"), "alpha", "Upstream alpha v2.", "UPSTREAM-V2 body.");
      fs.writeFileSync(path.join(source, "skills", "helper", "EXTRA.md"), "extra upstream file\n", "utf8");
    });
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "发现 1 个来源有可用更新", 60_000);
    await sourceRow.getByText("有更新").waitFor();

    await sourceRow.locator(".row-menu summary").click();
    await sourceRow.getByRole("button", { name: "查看上游差异" }).click();
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
    await sourceRow.locator(".row-menu summary").click();
    await sourceRow.getByRole("button", { name: "应用更新" }).click();
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
    await sourceRow.locator(".row-menu summary").click();
    await sourceRow.getByRole("button", { name: "应用更新" }).click();
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

    await sourceRow.locator(".row-menu summary").click();
    await sourceRow.getByRole("button", { name: "查看上游差异" }).click();
    const cleanDiff = await dialog(page);
    await waitForText(page, "没有文件差异", 60_000);
    await cleanDiff.locator(".modal-header").getByRole("button", { name: "关闭" }).click();
    await cleanDiff.waitFor({ state: "hidden" });

    await openSection(page, "技能");
    equal(await page.getByRole("button", { name: "编辑 alpha" }).count(), 0, "GitHub skill is not directly editable");
    const alphaRow = page.locator(".skill-table-row").filter({ hasText: "alpha" }).first();
    await alphaRow.locator(".row-menu summary").click();
    await alphaRow.getByRole("button", { name: "Fork 到本地" }).click();
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

    const originalGroup = page.locator(".skill-group").filter({ has: page.locator(".skill-group-name", { hasText: "alpha-repo" }) });
    equal(await originalGroup.locator(".row-menu button").filter({ hasText: "Fork 到本地" }).count(), 2, "original GitHub skills remain read-only");
    const forkedRow = page.locator(".skill-table-row").filter({ hasText: "alpha-local" });
    await forkedRow.locator(".row-menu summary").click();
    await forkedRow.getByRole("button", { name: "编辑技能" }).click();
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
  const paletteInput = palette.getByLabel("搜索技能、插件、MCP 与工具卡");
  await paletteInput.fill("no-such-skill");
  await page.keyboard.press("Enter");
  equal(await palette.isVisible(), true, "Enter cannot open a hit from the previous query");
  equal(await palette.locator(".palette-hit").count(), 0, "previous search hits disappear immediately");
  await paletteInput.fill("beta");
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "hidden" });
  await page.locator(".vault-tab.is-active").filter({ hasText: "vault-b" }).waitFor();
  await page.locator(".skill-table-row.is-selected").filter({ hasText: "beta" }).waitFor({ state: "visible", timeout: 15_000 });

  await page.keyboard.press("Meta+k");
  const emptySearch = await dialog(page);
  await emptySearch.getByLabel("搜索技能、插件、MCP 与工具卡").fill("no-such-skill");
  await waitForText(page, "没有匹配结果", 30_000);
  await page.keyboard.press("Escape");
  await emptySearch.waitFor({ state: "hidden" });

  await openSection(page, "设置");
  await waitForText(page, "本地来源不会自动拉取，也不会自动分发本地编辑");
  const checkInterval = page.getByLabel("检查间隔（小时）");
  const retention = page.getByLabel("每个目标最多保留备份数");
  const retentionDays = page.getByLabel("备份保留天数");
  const autoSyncToggle = page.getByRole("checkbox", { name: /关闭应用后继续自动更新/ });
  const backupRoot = page.getByLabel("备份根目录");
  const intervalLabel = page.locator("label.field-label").filter({ hasText: "检查间隔（小时）" });
  await intervalLabel.click();
  equal(await checkInterval.evaluate((input) => document.activeElement === input), true, "Field label focuses its input");
  const customBackups = path.join(workspace.root, "custom-backups");
  equal(await checkInterval.inputValue(), "1", "interval setting readback");
  equal(await retention.inputValue(), "3", "retention setting readback");
  equal(await retentionDays.inputValue(), "7", "retention days readback");
  equal(await autoSyncToggle.isChecked(), false, "background service initially disabled in test workspace");
  setDialogChoice(workspace, customBackups);
  const backupPanel = page.locator(".settings-panel").filter({ hasText: "备份根目录" });
  await backupPanel.getByRole("button", { name: "选择" }).click();
  await waitFor(async () => (await backupRoot.inputValue()) === customBackups, "backup root selected via dialog");
  await page.locator(".auto-sync-toggle").click();
  equal(await autoSyncToggle.isChecked(), true, "background toggle is keyboard and pointer operable");
  await retention.fill("4");
  await retentionDays.fill("6");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "设置已保存", 30_000);
  const saved = await readJson<{ autoSyncEnabled: boolean; checkIntervalHours: number; backupRetention: number; backupRetentionDays: number; backupRoot?: string }>(
    workspace.settingsFile,
  );
  equal(saved.autoSyncEnabled, true, "saved auto-sync toggle");
  equal(saved.checkIntervalHours, 1, "saved interval");
  equal(saved.backupRetention, 4, "saved retention");
  equal(saved.backupRetentionDays, 6, "saved retention days");
  equal(saved.backupRoot, customBackups, "saved backup root");
  await page.getByRole("button", { name: "立即检查并同步全部仓库" }).click();
  await waitForText(page, "已检查 2 个仓库", 30_000);
  await waitForText(page, "vault-a · alpha", 30_000);
  await waitForText(page, "vault-b · beta", 30_000);

  await checkInterval.fill("721");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "后台检查间隔必须是 1 到 720 之间的整数小时", 30_000);
  await checkInterval.fill("1");
  await retention.fill("0");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "备份保留数量必须是 1 到 100 之间的整数。", 30_000);
  await retention.fill("4");
  await retentionDays.fill("0");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "备份保留天数必须是 1 到 365 之间的整数。", 30_000);
  await retentionDays.fill("6");
  await page.getByRole("button", { name: "保存设置" }).click();
  await waitForText(page, "设置已保存", 30_000);
  equal((await readJson<{ backupRetention: number }>(workspace.settingsFile)).backupRetention, 4, "invalid saves blocked");

  await suite.close(launched);
  const relaunched = await suite.launch({ workspace, initialVault: vaultB });
  await openSection(relaunched.page, "设置");
  equal(await relaunched.page.getByLabel("检查间隔（小时）").inputValue(), "1", "persisted interval after relaunch");
  equal(await relaunched.page.getByLabel("每个目标最多保留备份数").inputValue(), "4", "persisted retention after relaunch");
  equal(await relaunched.page.getByLabel("备份保留天数").inputValue(), "6", "persisted retention days after relaunch");
  equal(await relaunched.page.getByRole("checkbox", { name: /关闭应用后继续自动更新/ }).isChecked(), true, "persisted background toggle");
  equal(await relaunched.page.getByLabel("备份根目录").inputValue(), customBackups, "persisted backup root after relaunch");
  console.log("      cross-vault keyboard search, selection jump, settings validation and persistence OK");
}

async function pluginsFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("plugins");
  const vaultPath = path.join(workspace.root, "plugins-vault");
  const targetDest = path.join(workspace.root, "agents-target");
  const pluginTargetDest = path.join(workspace.root, "plugin-target");
  copyFixture("v2-plugins", vaultPath);
  rewriteTargetDest(vaultPath, targetDest);
  fs.writeFileSync(
    path.join(vaultPath, "vault.yml"),
    read(path.join(vaultPath, "vault.yml")).replace("install_after_update: true", "install_after_update: false"),
  );
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

  const pluginStat = page.locator(".stat-cell").filter({ hasText: "插件" });
  await pluginStat.waitFor();
  assert(
    (await pluginStat.getAttribute("title"))?.includes("3 个插件内技能"),
    "overview plugin hint",
  );
  equal(await pluginStat.locator("strong").innerText(), "5", "overview plugin count");

  await openSection(page, "插件");
  await page.locator(".plugin-row").first().waitFor();
  equal(await page.locator(".plugin-row").count(), 5, "fixture plugin rows");
  await openSection(page, "安装目标");
  await waitForText(page, "已暂停·保留当前副本");
  await waitForText(page, "恢复同步前，当前副本会保持不变。");
  await openSection(page, "插件");

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
  equal(await originFilter.getByRole("button", { name: "本地" }).getAttribute("aria-pressed"), "true", "plugin filter exposes selection");
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

  await page.locator(".plugin-row").filter({ hasText: "local-tools" }).click();
  await inspector.getByRole("heading", { name: "local-tools" }).waitFor();
  await inspector.getByRole("button", { name: "登记目标" }).click();
  const targetForm = inspector.locator(".plugin-target-form");
  await targetForm.locator("input").nth(0).fill("local-agent-plugin");
  await targetForm.locator("input").nth(1).fill(pluginTargetDest);
  await targetForm.getByRole("button", { name: "登记目标" }).click();
  await waitForText(page, "已登记目标 local-agent-plugin");
  assert(
    (await inspector.innerText()).includes("不代表对应 agent 已安装或启用插件"),
    "plugin target explains agent activation boundary",
  );
  await inspector.getByRole("button", { name: "立即同步" }).click();
  await waitForText(page, "已同步");
  assert(fs.existsSync(path.join(pluginTargetDest, "local-tools")), "plugin target copy created");
  page.once("dialog", (dialog) => void dialog.accept());
  await inspector.getByRole("button", { name: "移除登记" }).click();
  await waitForText(page, "已移除目标 local-agent-plugin");
  assert(fs.existsSync(path.join(pluginTargetDest, "local-tools")), "removing registration keeps plugin copy");

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
  assert(
    (await localModal.innerText()).includes("插件已写入仓库，未安装到 agent。"),
    "plugin apply note",
  );
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
    .getByText("无 manifest，按目录结构识别。")
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
  const pluginSkillCount = (await pluginSourceRow.getByTitle("技能数量").innerText()).trim();
  assert(pluginSkillCount.includes("1"), `source plugin skill count: ${pluginSkillCount}`);
  await page.getByRole("button", { name: "检查", exact: true }).click();
  await pluginSourceRow.getByText("有更新").waitFor({ timeout: 60_000 });

  await pluginSourceRow.locator(".row-menu summary").click();
  await pluginSourceRow.getByRole("button", { name: "查看上游差异" }).click();
  const diffModal = await dialog(page);
  await diffModal.locator(".diff-layout").waitFor({ state: "visible", timeout: 60_000 });
  const diffText = await diffModal.locator(".diff-files").innerText();
  assert(diffText.includes(".claude-plugin/plugin.json"), "plugin diff shows the whole-root manifest");
  assert(diffText.includes("skills/kit-review/SKILL.md"), "plugin diff shows the contained skill");
  assert(diffText.includes("commands/hello.md"), "plugin diff shows newly added assets");
  await diffModal.getByRole("button", { name: "关闭" }).click();
  await diffModal.waitFor({ state: "hidden" });

  await pluginSourceRow.locator(".row-menu summary").click();
  await pluginSourceRow.getByRole("button", { name: "应用更新" }).click();
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
  await pluginSourceRow.locator(".row-menu summary").click();
  await pluginSourceRow.getByRole("button", { name: "移除来源" }).click();
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
  fs.appendFileSync(path.join(vaultPath, "tools/kit-cli.yml"), [
    "checks:",
    "  - id: skill-file",
    "    kind: path",
    "    label: 技能文件",
    `    path: ${JSON.stringify(path.join(vaultPath, "skills/plain-skill/SKILL.md"))}`,
    "  - id: missing-runtime",
    "    kind: path",
    "    label: 缺少的运行文件",
    `    path: ${JSON.stringify(path.join(vaultPath, "missing-runtime"))}`,
    "    profiles:",
    "      - full",
    "  - id: python-runtime",
    "    kind: python",
    "    label: Python 解释器",
    "    executable: python3",
    "    profiles:",
    "      - python",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(vaultPath, "tools/hybrid-plugin.yml"), [
    "schema: 1",
    "name: hybrid-plugin",
    "kind: plugin",
    "title: Hybrid Plugin",
    "summary: A plugin that also offers MCP integration.",
    "homepage: https://example.org/hybrid",
    "install:",
    "  - label: Install plugin",
    "    command: npx hybrid setup",
    "run: hybrid --mcp",
    "related_skills:",
    "  - plain-skill",
    "tags:",
    "  - mcp",
    "checks:",
    "  - id: node-runtime",
    "    kind: node",
    "    label: Node runtime",
    "    ranges:",
    "      - min_version: 0.0.0",
  ].join("\n") + "\n");
  initGitRepo(vaultPath);
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;

  const toolStat = page.locator(".stat-cell").filter({ hasText: "工具" });
  await toolStat.waitFor();
  equal(await toolStat.locator("strong").innerText(), "3", "overview tool count");
  const mcpStat = page.locator(".stat-cell").filter({ hasText: "MCP" });
  equal(await mcpStat.locator("strong").innerText(), "2", "overview MCP capability count");

  await openSection(page, "工具");
  const card = page.locator(".tool-card").filter({ hasText: "Kit CLI" });
  await card.waitFor();
  equal(await page.locator(".tool-card").count(), 3, "fixture tool card count");
  const text = await card.innerText();
  assert(text.includes("Kit CLI"), "tool card title");
  assert(text.includes("npm install --global kit-cli"), "tool card install command");
  assert(text.includes("Node.js 22+"), "tool card requirement");
  assert(text.includes("plain-skill"), "tool card related skill");
  assert(text.toLowerCase().includes("recorded for display only"), "tool card notes");
  assert(text.includes("官方地址"), "tool card official link");
  equal(await card.locator("button[title='复制安装命令']").count(), 1, "install copy button");
  const runtime = card.locator(".tool-readiness");
  await runtime.getByText("待检查", { exact: true }).waitFor();
  equal(await runtime.getByRole("button", { name: "检查运行环境" }).count(), 1, "readiness is explicit action");
  await runtime.getByRole("button", { name: "检查运行环境" }).click();
  await runtime.getByText("通用检查通过", { exact: true }).waitFor();
  assert((await runtime.innerText()).includes("上次检查："), "readiness report shows its check time");
  await runtime.getByLabel("Kit CLI检查场景").selectOption("full");
  await runtime.getByText("待检查", { exact: true }).waitFor();
  await runtime.getByRole("button", { name: "检查运行环境" }).click();
  await runtime.getByText("运行环境未就绪", { exact: true }).waitFor();
  await runtime.getByText("缺少的运行文件", { exact: true }).waitFor();
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  await page.evaluate(fs.readFileSync(axeSourcePath, "utf8"));
  await auditPage(page, "tool checks light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await auditPage(page, "tool checks dark");
  await page.emulateMedia({ colorScheme: "light" });

  const secondVault = path.join(workspace.root, "tools-vault-second");
  copyFixture("v2-plugins", secondVault);
  fs.writeFileSync(
    path.join(secondVault, "tools/kit-cli.yml"),
    fs.readFileSync(path.join(vaultPath, "tools/kit-cli.yml"), "utf8").replaceAll(vaultPath, secondVault),
  );
  fs.copyFileSync(path.join(vaultPath, "tools/hybrid-plugin.yml"), path.join(secondVault, "tools/hybrid-plugin.yml"));
  initGitRepo(secondVault);
  setDialogChoice(workspace, secondVault);
  await page.locator(".tab-add").first().click();
  await waitFor(async () => (await page.locator(".vault-tab").count()) === 2, "second tools vault opens");
  await page.locator(".vault-tab").first().click();
  await openSection(page, "工具");
  const firstProfile = page.locator(".tool-card").filter({ hasText: "Kit CLI" }).getByLabel("Kit CLI检查场景");
  const firstPython = page.locator(".tool-card").filter({ hasText: "Kit CLI" }).getByLabel("Kit CLI Python 解释器绝对路径");
  const firstNode = page.locator(".tool-card").filter({ hasText: "Hybrid Plugin" }).getByLabel("Hybrid Plugin Node 绝对路径");
  await firstProfile.selectOption("full");
  await firstPython.fill("/opt/test-env/bin/python3");
  await firstNode.fill("/opt/test-node/bin/node");
  await page.locator(".vault-tab").nth(1).click();
  await openSection(page, "工具");
  equal(await page.locator(".tool-card").filter({ hasText: "Kit CLI" }).getByLabel("Kit CLI检查场景").inputValue(), "", "same-name tool profile is scoped to its vault");
  equal(await page.locator(".tool-card").filter({ hasText: "Kit CLI" }).getByLabel("Kit CLI Python 解释器绝对路径").inputValue(), "", "same-name interpreter selection is scoped to its vault");
  equal(await page.locator(".tool-card").filter({ hasText: "Hybrid Plugin" }).getByLabel("Hybrid Plugin Node 绝对路径").inputValue(), "", "same-name Node selection is scoped to its vault");
  await page.locator(".vault-tab").first().click();
  await openSection(page, "工具");
  equal(await firstProfile.inputValue(), "full", "original vault restores its check scenario");
  equal(await firstPython.inputValue(), "/opt/test-env/bin/python3", "original vault restores its interpreter selection");
  equal(await firstNode.inputValue(), "/opt/test-node/bin/node", "original vault restores its Node selection");
  await firstProfile.selectOption("");
  await firstPython.fill("");
  await firstNode.fill("");
  await card.locator(".tool-readiness").getByRole("button", { name: "检查运行环境" }).click();
  await card.locator(".tool-readiness").getByText("通用检查通过", { exact: true }).waitFor();

  await page.getByLabel("筛选工具卡").fill("kit-cli");
  equal(await page.locator(".tool-card").count(), 1, "tool filter keeps the card");
  await page.getByLabel("筛选工具卡").fill("no-such-tool");
  await waitForText(page, "没有匹配的工具卡");
  equal(await page.locator(".tool-card").count(), 0, "tool filter empties the grid");
  await page.locator(".empty").getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".tool-card").count()) === 3, "tool filter cleared");

  await card.getByRole("button", { name: "复制安装命令" }).click();
  await waitForText(page, "已复制到剪贴板");

  await card.getByRole("button", { name: "plain-skill" }).click();
  await page.locator(".nav-item.is-active").filter({ hasText: "技能" }).waitFor();
  const skillInspector = page.locator(".inspector");
  await skillInspector.getByRole("heading", { name: "plain-skill" }).waitFor();
  assert((await skillInspector.innerText()).includes("文件分发"), "skill file distribution is distinct from runtime");
  assert((await skillInspector.innerText()).includes("通用检查通过"), "related tool reports default readiness separately");

  await page.locator(".search-trigger").click();
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("kit-cli");
  const hit = palette.locator(".palette-hit").filter({ hasText: "kit-cli" }).first();
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  const hitText = await hit.innerText();
  assert(hitText.includes("工具"), "tool search hit shape label");
  assert(hitText.includes("plugins"), "tool search hit meta");
  await hit.click();
  await palette.waitFor({ state: "hidden" });
  await page.locator(".nav-item.is-active").filter({ hasText: "工具" }).waitFor();
  await page.locator(".tool-card").filter({ hasText: "Kit CLI" }).waitFor();
  assert(!fs.existsSync(path.join(vaultPath, "tools", "kit-cli.yml.tmp")), "tool page writes nothing");

  await openSection(page, "MCP");
  const mcpCard = page.locator(".tool-card").filter({ hasText: "Filesystem MCP" });
  await mcpCard.waitFor();
  equal(await page.locator(".tool-card").count(), 2, "MCP page includes tagged plugin capability");
  const hybrid = page.locator(".tool-card").filter({ hasText: "Hybrid Plugin" });
  const hybridText = await hybrid.innerText();
  assert(hybridText.includes("插件分发形态安装"), "MCP page explains plugin distribution form");
  assert(hybridText.includes("需在对应 agent 验证"), "MCP integration is not reported as enabled");
  assert(hybridText.includes("Vault 受管") && hybridText.includes("未分发"), "related skill shows target distribution gap");
  equal(await hybrid.getByLabel("Hybrid Plugin Node 绝对路径").count(), 1, "node check offers interpreter path");
  equal(await hybrid.getByRole("button", { name: "复制连接命令" }).count(), 1, "MCP capability shows connection command");
  await hybrid.getByRole("button", { name: "检查运行环境" }).click();
  await hybrid.getByText("通用检查通过", { exact: true }).waitFor();
  assert((await hybrid.innerText()).includes("Node："), "Node report shows the checked executable");
  const mcpText = await mcpCard.innerText();
  assert(mcpText.includes("MCP 服务"), "MCP card kind label");
  assert(mcpText.includes("npm install --global @modelcontextprotocol/server-filesystem"), "MCP install command");
  assert(mcpText.includes("mcp-server-filesystem /tmp"), "MCP connect command");
  assert(mcpText.includes("连接 / 启动"), "MCP connection section");
  assert(mcpText.includes("Node.js 22+"), "MCP requirement");
  assert(mcpText.includes("plain-skill"), "MCP related skill");
  assert(mcpText.includes("未配置运行时检查"), "tool without checks is not reported ready");
  const mcpBoundary = await page.locator(".tool-boundary").innerText();
  assert(mcpBoundary.includes("仅记录，不安装"), "MCP boundary copy");
  equal(await mcpCard.locator("button[title='复制连接命令']").count(), 1, "MCP connect copy button");

  await page.getByLabel("筛选 MCP 卡").fill("no-such-mcp");
  await waitForText(page, "没有匹配的 MCP 卡");
  equal(await page.locator(".tool-card").count(), 0, "MCP filter empties the grid");
  await page.locator(".empty").getByRole("button", { name: "清除筛选" }).click();
  await waitFor(async () => (await page.locator(".tool-card").count()) === 2, "MCP filter cleared");

  await mcpCard.getByRole("button", { name: "复制连接命令" }).click();
  await waitForText(page, "已复制到剪贴板");

  await page.locator(".search-trigger").click();
  const mcpPalette = await dialog(page);
  await mcpPalette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("filesystem-mcp");
  const mcpHit = mcpPalette.locator(".palette-hit").filter({ hasText: "filesystem-mcp" }).first();
  await mcpHit.waitFor({ state: "visible", timeout: 30_000 });
  const mcpHitText = await mcpHit.innerText();
  assert(mcpHitText.includes("MCP"), "MCP search hit shape label");
  assert(mcpHitText.includes("plugins"), "MCP search hit meta");
  await mcpHit.click();
  await mcpPalette.waitFor({ state: "hidden" });
  await page.locator(".nav-item.is-active").filter({ hasText: "MCP" }).waitFor();
  await page.locator(".tool-card").filter({ hasText: "Filesystem MCP" }).waitFor();
  assert(!fs.existsSync(path.join(vaultPath, "tools", "filesystem-mcp.yml.tmp")), "MCP page writes nothing");

  await suite.close(launched);
  console.log("      tool and MCP pages, filters, copy, related-skill jump and search routing OK");
}

async function externalFlow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("external");
  const vaultPath = path.join(workspace.root, "external-vault");
  copyFixture("v2-plugins", vaultPath);
  initGitRepo(vaultPath);
  const externalPath = path.join(workspace.root, "tool-managed", "rea-demo");
  writeSkill(externalPath, "rea-demo", "A tool-owned skill recorded by VaultDesk.");
  const skillFile = path.join(externalPath, "SKILL.md");
  const before = read(skillFile);

  const add = runCli(
    [
      "external",
      "add",
      "rea-demo",
      "--vault",
      vaultPath,
      "--owner",
      "rea-agents",
      "--path",
      externalPath,
      "--pin",
      "--yes",
    ],
    { workspace },
  );
  equal(add.status, 0, `external add failed: ${add.stderr}`);
  assert(fs.existsSync(path.join(vaultPath, "external-skills", "rea-demo.yml")), "external card written");
  const artifact = JSON.parse(read(path.join(vaultPath, "build", "external-skills.json"))) as {
    skills: { name: string; owner: string; status: string }[];
  };
  equal(artifact.skills.length, 1, "external artifact count");
  equal(artifact.skills[0]?.status, "ok", "external artifact status");
  assert(!fs.existsSync(path.join(externalPath, ".vault-managed")), "external path has no marker");
  fs.writeFileSync(path.join(vaultPath, "tools/rea-demo.yml"), [
    "schema: 1",
    "name: rea-demo",
    "kind: plugin",
    "title: REA Demo",
    "summary: External skill plugin with MCP integration.",
    "homepage: https://example.org/rea-demo",
    "install:",
    "  - label: Setup",
    "    command: npx rea-agents setup",
    "run: rea --mcp",
    "related_skills:",
    "  - rea-demo",
    "tags:",
    "  - mcp",
  ].join("\n") + "\n");
  commitAll(vaultPath, "record external skill");

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.evaluate(fs.readFileSync(axeSourcePath, "utf8"));
  await page.locator(".overview-priority").getByText("检查上游状态").waitFor();
  equal((await page.locator(".update-panel strong").innerText()).trim(), "尚未检查上游", "unverified upstream is not reported as current");
  const scans = [await auditPage(page, "external overview")];

  const stat = page.locator(".stat-cell").filter({ hasText: "外部技能" });
  await stat.waitFor();
  equal(await stat.locator("strong").innerText(), "1", "overview external count");
  assert((await stat.getAttribute("title")) === "由对应工具自己管理", "overview external hint");

  await openSection(page, "技能");
  await waitForText(page, "外部托管");
  const group = page.locator(".skill-group").filter({ hasText: "rea-agents" });
  await group.waitFor();
  const row = group.locator(".skill-table-row").filter({ hasText: "rea-demo" });
  await row.waitFor();
  const rowText = await row.innerText();
  assert(rowText.includes("外部"), "external row role");
  await row.getByLabel("已同步").waitFor();

  const typeFilter = page.getByRole("group", { name: "技能类型筛选" });
  await typeFilter.getByRole("button", { name: "外部托管" }).click();
  await waitFor(async () => (await page.locator(".skill-table-row").count()) === 1, "external filter isolates rows");
  await typeFilter.getByRole("button", { name: "全部" }).click();
  await waitFor(async () => (await page.locator(".skill-table-row").count()) > 1, "external filter cleared");

  await row.click();
  const inspector = page.locator(".inspector");
  await inspector.getByRole("heading", { name: "rea-demo" }).waitFor();
  const inspectorText = await inspector.innerText();
  assert(inspectorText.includes("外部路径"), "external inspector path section");
  assert(inspectorText.includes("rea-agents"), "external inspector owner");
  assert(inspectorText.includes("rea-agents 管理 · VaultDesk 只读"), "external inspector boundary copy");
  assert(inspectorText.includes("external-skills/rea-demo.yml"), "external inspector card path");
  scans.push(await auditPage(page, "external inspector"));

  await page.locator(".search-trigger").click();
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").fill("rea-demo");
  const hit = palette.locator(".palette-hit").filter({ hasText: "rea-agents" }).first();
  await hit.waitFor({ state: "visible", timeout: 30_000 });
  const hitText = await hit.innerText();
  assert(hitText.includes("外部"), "external search shape label");
  assert(hitText.includes("rea-agents"), "external search meta");
  await hit.click();
  await palette.waitFor({ state: "hidden" });
  await page.locator(".inspector").getByRole("heading", { name: "rea-demo" }).waitFor();

  await openSection(page, "MCP");
  const externalTool = page.locator(".tool-card").filter({ hasText: "REA Demo" });
  await externalTool.waitFor();
  assert((await externalTool.innerText()).includes("rea-agents 外部工具托管"), "tool shows external ownership");
  await externalTool.getByRole("button", { name: "rea-demo" }).click();
  await page.locator(".nav-item.is-active").filter({ hasText: "技能" }).waitFor();
  const routedExternal = page.locator(".inspector");
  await routedExternal.getByRole("heading", { name: "rea-demo" }).waitFor();
  assert((await routedExternal.innerText()).includes("rea-agents 管理 · VaultDesk 只读"), "related external skill opens its actual inspector");

  assert(read(skillFile) === before, "external SKILL.md untouched by the app");
  assert(!fs.existsSync(path.join(externalPath, ".vault-managed")), "no marker after UI inspection");

  await suite.close(launched);
  console.log(
    `      external record, synced state, ownership filter, inspector and search routing OK (${scans.join("/")} axe scans)`,
  );
}

async function manualSourceCheck(suite: Suite): Promise<void> {
  const workspace = suite.workspace("auto-check");
  const vaultPath = path.join(workspace.root, "auto-vault");
  const initialCommit = makeUpstreamRepo(workspace, "auto-repo", { alpha: "Auto check alpha v1." });
  const init = runCli(["vault", "init", vaultPath, "--git", "--name", "auto-vault", "--yes"], { workspace });
  equal(init.status, 0, "vault init failed: " + init.stderr);
  const add = runCli(["source", "add", "--repo", "e2e/auto-repo", "--vault", vaultPath, "--yes"], { workspace });
  equal(add.status, 0, "GitHub source add failed: " + add.stderr);
  assert(read(path.join(vaultPath, "vault.lock")).includes(initialCommit), "initial upstream commit pinned");
  commitAll(vaultPath, "chore: import auto source");
  const vaultRemote = path.join(workspace.remotes, "auto-vault.git");
  git(workspace.root, ["clone", "--bare", vaultPath, vaultRemote]);
  git(vaultPath, ["remote", "add", "origin", vaultRemote]);
  git(vaultPath, ["push", "-u", "origin", "main"]);
  advanceUpstreamRepo(workspace, "auto-repo", (source) => {
    writeSkill(path.join(source, "skills", "alpha"), "alpha", "Auto check alpha v2.", "AUTO-V2 body.");
  });

  const stateFile = path.join(vaultPath, ".vault/state.json");
  const lastChecked = async (): Promise<string | null> =>
    fs.existsSync(stateFile) ? (await readJson<{ last_checked_at?: string }>(stateFile)).last_checked_at ?? null : null;
  const before = await lastChecked();
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  await openSection(launched.page, "来源");
  await launched.page.locator(".source-row").filter({ hasText: "auto-repo" }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  equal(await lastChecked(), before, "development GUI does not schedule a background check");
  const mode = launched.page.locator(".source-row").filter({ hasText: "auto-repo" }).locator("select");
  equal(await mode.inputValue(), "auto", "Git source defaults to automatic mode");
  await mode.selectOption("review-before-apply");
  await waitFor(async () => (await mode.inputValue()) === "review-before-apply", "source review mode saved");
  await mode.selectOption("frozen");
  await waitFor(async () => (await mode.inputValue()) === "frozen", "source freeze saved");
  await mode.selectOption("auto");
  await waitFor(async () => (await mode.inputValue()) === "auto", "source automatic mode restored");
  equal(git(vaultRemote, ["log", "-1", "--pretty=%s"]).trim(), "chore: set alpha update mode to auto", "source mode pushed");
  await launched.page.getByRole("button", { name: "检查", exact: true }).click();
  await waitForText(launched.page, "发现 1 个来源有可用更新", 60_000);
  await launched.page.locator(".source-row").filter({ hasText: "auto-repo" }).getByText("有更新").waitFor();
  const checked = await lastChecked();
  assert(checked && Number.isFinite(Date.parse(checked)), "manual source check recorded a timestamp");
  console.log("      GUI defers scheduling to background worker; source mode and manual check remain available");
}

async function registeredVaultSync(suite: Suite): Promise<void> {
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

    const afterImports = server.stats.requests.length;
    const launched = await suite.launch({
      workspace,
      initialVault: vaultA,
      extraEnv: gitRewriteEnv(authenticated, emptyConfig),
    });
    const page = launched.page;
    setDialogChoice(workspace, vaultB);
    await page.getByRole("button", { name: "打开仓库" }).click();
    await page.locator(".vault-tab").filter({ hasText: "session-b" }).waitFor({ state: "visible", timeout: 30_000 });
    equal(server.stats.requests.length, afterImports, "opening a second vault does not run a GUI background check");

    await openSection(page, "设置");
    await page.getByRole("button", { name: "立即检查并同步全部仓库" }).click();
    await waitForText(page, "已检查 2 个仓库", 60_000);
    await waitForText(page, "session-a · alpha", 30_000);
    await waitForText(page, "session-b · beta", 30_000);
    const stateA = path.join(vaultA, ".vault/state.json");
    const stateB = path.join(vaultB, ".vault/state.json");
    const checked = async (file: string): Promise<boolean> =>
      fs.existsSync(file) && Boolean((await readJson<{ last_checked_at?: string }>(file)).last_checked_at);
    await waitFor(() => checked(stateA), "session A check", 60_000);
    await waitFor(() => checked(stateB), "session B check", 60_000);
    const afterB = server.stats.requests.length;
    assert(afterB > afterImports, "manual all-vault sync reached upstream Git repos");

    await page.locator(".vault-tab").filter({ hasText: "session-a" }).click();
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-a" }).waitFor();
    await page.locator(".vault-tab").filter({ hasText: "session-b" }).click();
    await page.locator(".vault-tab.is-active").filter({ hasText: "session-b" }).waitFor();
    equal(server.stats.requests.length, afterB, "tab switching never schedules another check");

    await page.locator(".vault-tab").filter({ hasText: "session-a" }).click();
    await openSection(page, "来源");
    await page.getByRole("button", { name: "检查", exact: true }).click();
    await waitForText(page, "所有已检查来源都是最新", 60_000);
    assert(server.stats.requests.length > afterB, "manual source check still reaches upstream");
    const afterManual = server.stats.requests.length;

    const tabA = page.locator(".vault-tab").filter({ hasText: "session-a" });
    const tabB = page.locator(".vault-tab").filter({ hasText: "session-b" });
    equal(await page.locator('.vault-tabs[role="group"] .vault-tab').count(), 2, "vault group exposes exactly the open vaults");
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
    equal(await page.locator('.vault-tabs .vault-tab').count(), 1, "titlebar close removes the active tab");
    console.log("      all registered vaults synchronized; tab navigation does not duplicate checks");
  } finally {
    await server.close();
  }
}

async function headlessBackgroundWorker(suite: Suite): Promise<void> {
  const workspace = suite.workspace("headless-worker");
  const vaultPath = path.join(workspace.root, "worker-vault");
  makeUpstreamRepo(workspace, "worker-repo", { alpha: "Headless worker alpha." });
  equal(runCli(["vault", "init", vaultPath, "--git", "--name", "worker-vault", "--yes"], { workspace }).status, 0, "worker vault init");
  const imported = runCli(["source", "add", "--repo", "e2e/worker-repo", "--vault", vaultPath, "--yes"], { workspace });
  equal(imported.status, 0, "worker source import: " + imported.stderr);
  commitAll(vaultPath, "chore: add worker source");
  fs.writeFileSync(path.join(workspace.userData, "recent-vaults.json"), JSON.stringify({
    vaults: [{ path: vaultPath, name: "worker-vault", openedAt: new Date().toISOString() }],
  }));
  fs.writeFileSync(workspace.settingsFile, JSON.stringify({
    autoSyncEnabled: true, checkIntervalHours: 1, backupRetention: 3, backupRetentionDays: 7,
    backupRoot: workspace.backups,
  }));
  const electronBinary = createRequire(path.join(repoRoot, "apps/desktop/package.json"))("electron") as string;
  const env = { ...cliEnv(workspace), VAULTDESK_USER_DATA: workspace.userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const worker = spawn(electronBinary, [path.join(repoRoot, "apps/desktop"), "--vaultdesk-background-worker"], {
    cwd: path.join(repoRoot, "apps/desktop"), env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  worker.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    const log = path.join(workspace.userData, "auto-sync-activity.jsonl");
    await waitFor(() => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes('"source":"alpha"'), "headless worker activity", 60_000);
    const event = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").at(-1) ?? "{}") as { status?: string; trigger?: string };
    equal(event.status, "current", "headless worker checked upstream source");
    equal(event.trigger, "startup", "headless worker started at login");
    fs.writeFileSync(workspace.settingsFile, JSON.stringify({
      autoSyncEnabled: false, checkIntervalHours: 1, backupRetention: 3, backupRetentionDays: 7,
    }));
    await waitFor(() => worker.exitCode !== null || worker.signalCode !== null, "disabled worker exits", 25_000);
    assert(!stderr.includes("Background sync failed"), "headless worker error: " + stderr.slice(-800));
    console.log("      headless worker checks registered vault and exits after disabling auto-sync");
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGTERM");
  }
}

async function reopenClosedGuiWindow(suite: Suite): Promise<void> {
  const workspace = suite.workspace("reopen-gui");
  const launched = await suite.launch({ workspace, initialVault: null });
  await launched.page.close();
  await waitFor(() => launched.app.windows().length === 0, "GUI window closed while app remains running");

  const electronBinary = createRequire(path.join(repoRoot, "apps/desktop/package.json"))("electron") as string;
  const env = { ...cliEnv(workspace), VAULTDESK_USER_DATA: workspace.userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnGui = () => spawn(electronBinary, [path.join(repoRoot, "apps/desktop")], {
    cwd: path.join(repoRoot, "apps/desktop"), env, stdio: "ignore",
  });

  const reopenedPromise = launched.app.waitForEvent("window", { timeout: 20_000 });
  const second = spawnGui();
  const reopened = await reopenedPromise;
  await reopened.waitForSelector(".app-shell", { timeout: 20_000 });
  await waitFor(() => second.exitCode !== null, "second GUI instance exits after handing off focus");
  equal(launched.app.windows().length, 1, "one GUI window after reopening");

  const third = spawnGui();
  await waitFor(() => third.exitCode !== null, "extra GUI instance exits after handing off focus");
  equal(launched.app.windows().length, 1, "repeated open does not duplicate the GUI window");
  await suite.close(launched);
  console.log("      closed GUI window reopens via second-instance; repeated opens keep one window");
}

async function adoptPendingSkillFromActivity(suite: Suite): Promise<void> {
  const workspace = suite.workspace("adopt-pending-ui");
  const vaultPath = path.join(workspace.root, "adopt-vault");
  makeUpstreamRepo(workspace, "adopt-repo", { alpha: "Alpha in suite.", beta: "Beta in suite." });
  equal(runCli(["vault", "init", vaultPath, "--git", "--name", "adopt-vault", "--yes"], { workspace }).status, 0, "adopt vault init");
  const imported = runCli(["source", "add", "--repo", "e2e/adopt-repo", "--vault", vaultPath, "--yes"], { workspace });
  equal(imported.status, 0, "adopt source import: " + imported.stderr);
  commitAll(vaultPath, "chore: import suite");
  const remote = path.join(workspace.remotes, "adopt-vault.git");
  git(workspace.root, ["clone", "--bare", vaultPath, remote]);
  git(vaultPath, ["remote", "add", "origin", remote]);
  git(vaultPath, ["push", "-u", "origin", "main"]);
  advanceUpstreamRepo(workspace, "adopt-repo", (source) => {
    writeSkill(path.join(source, "skills", "gamma"), "gamma", "New upstream gamma.");
  });

  const agentsSkills = path.join(workspace.root, "agents-skills");
  const launched = await suite.launch({
    workspace, initialVault: vaultPath,
    extraEnv: { VAULTDESK_AGENTS_SKILLS_DIR: agentsSkills },
  });
  const page = launched.page;
  await openSection(page, "设置");
  await page.getByRole("button", { name: "立即检查并同步全部仓库" }).click();
  await waitForText(page, "待接纳新技能：skills/gamma", 60_000);
  const activity = page.locator(".auto-sync-activity-row").filter({ hasText: "skills/gamma" }).first();
  await activity.getByRole("button", { name: "选择接纳" }).click();
  const pendingDialog = await dialog(page);
  await pendingDialog.getByText("skills/gamma").waitFor({ timeout: 30_000 });
  await pendingDialog.locator(".pending-skill-row").filter({ hasText: "gamma" }).click();
  await pendingDialog.getByRole("button", { name: "接纳所选 1 项" }).click();
  await waitForText(page, "新技能已接纳并同步受管目标", 60_000);
  assert(fs.existsSync(path.join(vaultPath, "packages/adopt-repo/skills/gamma/SKILL.md")), "new skill adopted in vault");
  assert(fs.existsSync(path.join(agentsSkills, "gamma", "SKILL.md")), "new skill distributed to sandboxed master");
  assert(git(remote, ["log", "-1", "--pretty=%s"]).includes("adopt skills"), "adoption pushed to Vault remote");
  await openSection(page, "技能");
  await page.locator(".skill-table-row").filter({ hasText: "gamma" }).waitFor();
  console.log("      activity exposes exact pending path and adoption updates Vault, master and Git remote");
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
  await waitForText(page, "校验通过 ·", 60_000);
  await waitForText(page, "已备份 1 个目录。");
  await install.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await install.waitFor({ state: "hidden" });

  const card = page.locator(".target-card").filter({ hasText: "agent-skills" });
  await card.waitFor({ state: "visible", timeout: 30_000 });
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "alpha installed with marker");
  assert(fs.existsSync(path.join(dest, "beta", ".vault-managed")), "symlink replaced by managed directory");
  assert(!fs.lstatSync(path.join(dest, "beta")).isSymbolicLink(), "beta is no longer a symlink");
  assert(fs.existsSync(path.join(external, "SENTINEL.txt")), "symlink target untouched");
  const backupRoots = fs.readdirSync(workspace.backups).filter((name) => name.startsWith("agent-skills-"));
  equal(backupRoots.length, 1, "target backup root includes the unique hash suffix");
  const backupsForTarget = path.join(workspace.backups, backupRoots[0] as string);
  const stamps = fs.readdirSync(backupsForTarget).sort();
  assert(stamps.length > 0, "unmanaged backup created");
  const savedAlpha = read(path.join(backupsForTarget, stamps[0] as string, "alpha", "SKILL.md"));
  assert(savedAlpha.includes("old unmanaged alpha"), "unmanaged alpha moved into backup");
  assert(read(path.join(vaultPath, "vault.yml")).includes("agent-skills"), "install target registered in vault.yml");

  await card.locator(".row-menu summary").click();
  await card.getByRole("button", { name: "验证文件" }).click();
  await card.getByLabel("校验通过").waitFor({ timeout: 30_000 });
  fs.appendFileSync(path.join(dest, "alpha", "SKILL.md"), "\nLOCAL-DRIFT\n", "utf8");
  await card.locator(".row-menu summary").click();
  await card.getByRole("button", { name: "验证文件" }).click();
  await waitForText(page, "0 缺失 · 1 修改", 30_000);

  await card.getByRole("button", { name: "重新安装", exact: true }).click();
  const reinstall = await dialog(page);
  await reinstall.getByRole("button", { name: "预览计划" }).click();
  await waitForText(page, "受管");
  await reinstall.getByRole("button", { name: "确认重新安装" }).click();
  await waitForText(page, "校验通过 ·", 60_000);
  await reinstall.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await reinstall.waitFor({ state: "hidden" });
  await waitFor(() => !read(path.join(dest, "alpha", "SKILL.md")).includes("LOCAL-DRIFT"), "managed reinstall replaced drift");
  await waitFor(async () => (await card.locator(".target-check").count()) === 0, "reinstall refresh clears the previous snapshot's file verification");

  await card.locator(".row-menu summary").click();
  await card.getByRole("button", { name: "查看备份" }).click();
  const backups = await dialog(page);
  await waitForText(page, "安装备份");
  await backups.locator(".backup-entry").first().waitFor({ state: "visible", timeout: 30_000 });
  await backups.getByRole("group", { name: "按安装目标筛选" }).getByRole("button", { name: "全部目标" }).click();
  const registeredBackups = backups.locator(".backup-group").filter({ hasText: "agent-skills" });
  await registeredBackups.waitFor({ state: "visible", timeout: 30_000 });
  equal((await registeredBackups.locator("h3").innerText()).trim(), "agent-skills", "all-target backup group owner");
  equal(await registeredBackups.getByText("目标已注销").count(), 0, "registered target is not marked orphaned");
  equal(
    await registeredBackups.locator(".backup-skill").filter({ hasText: "alpha" }).getByRole("button", { name: "恢复" }).first().isDisabled(),
    false,
    "registered target backup stays restorable in all-target view",
  );
  await backups.locator(".backup-skill").filter({ hasText: "alpha" }).getByRole("button", { name: "恢复" }).click();
  const restoreConfirm = page.getByRole("dialog", { name: "恢复 alpha？" });
  await waitForText(page, "恢复 alpha？");
  await page.keyboard.press("Escape");
  await restoreConfirm.waitFor({ state: "hidden" });
  equal(await page.getByRole("dialog").count(), 1, "Escape closes only the top confirmation dialog");
  await backups.locator(".backup-skill").filter({ hasText: "alpha" }).getByRole("button", { name: "恢复" }).click();
  await waitForText(page, "恢复 alpha？");
  await restoreConfirm.getByRole("button", { name: "恢复" }).click();
  await waitForText(page, "恢复完成", 30_000);
  assert(read(path.join(dest, "alpha", "SKILL.md")).includes("old unmanaged alpha"), "backup restored into slot");
  assert(fs.existsSync(path.join(dest, "alpha", ".vault-managed")), "restored slot carries marker");
  await backups.locator(".modal-footer").getByRole("button", { name: "关闭" }).click();
  await backups.waitFor({ state: "hidden" });

  await card.locator(".row-menu summary").click();
  await card.getByRole("button", { name: "移除目标" }).click();
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
  await waitForText(page, "校验通过 ·", 60_000);
  await reregister.locator(".modal-footer").getByRole("button", { name: "完成" }).click();
  await reregister.waitFor({ state: "hidden" });
  await card.waitFor({ state: "visible", timeout: 30_000 });

  await card.locator(".row-menu summary").click();
  await card.getByRole("button", { name: "查看备份" }).click();
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

async function contextualInstall(suite: Suite): Promise<void> {
  const workspace = suite.workspace("contextual-install");
  const vaultPath = path.join(workspace.root, "vault");
  const cli = (...args: string[]) => {
    const result = runCli([...args, "--vault", vaultPath, "--yes"], { workspace });
    equal(result.status, 0, result.stderr || result.stdout);
  };
  equal(runCli(["vault", "init", vaultPath, "--git", "--yes"], { workspace }).status, 0, "context vault init");
  const bundle = path.join(workspace.root, "imports", "alpha");
  writeSkill(path.join(bundle, "alpha"), "alpha", "Alpha in a same-named source.");
  writeSkill(path.join(bundle, "beta"), "beta", "Beta in alpha source.");
  const gamma = path.join(workspace.root, "imports", "gamma");
  writeSkill(gamma, "gamma", "Separate gamma.");
  cli("source", "add", bundle, "--name", "alpha");
  cli("source", "add", gamma);
  const singleDest = path.join(workspace.root, "single");
  const multiDest = path.join(workspace.root, "multi");
  cli("target", "install", "beta", "--dest", singleDest, "--id", "single");
  cli("target", "install", "alpha", "--dest", multiDest, "--id", "multi");
  cli("target", "install", "alpha", "--skills-only", "--dest", path.join(workspace.root, "cli-exact"), "--id", "cli-exact");
  const config = path.join(vaultPath, "vault.yml");
  fs.writeFileSync(config, read(config).replace(/(id: single[\s\S]*?install_after_update:) true/, "$1 false"));
  const targets = () => JSON.parse(runCli(["target", "list", "--vault", vaultPath, "--json"], { workspace }).stdout).data as Array<{ id: string; skills: string[]; installAfterUpdate: boolean }>;
  equal(targets().find((t) => t.id === "single")?.installAfterUpdate, false, "paused fixture");
  equal(targets().find((t) => t.id === "cli-exact")?.skills.join(","), "alpha", "CLI exact selection does not expand its source");
  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const page = launched.page;
  await openSection(page, "安装目标");
  const single = page.locator(".target-card").filter({ has: page.getByRole("heading", { name: "single", exact: true }) });
  const multi = page.locator(".target-card").filter({ has: page.getByRole("heading", { name: "multi", exact: true }) });
  await single.getByRole("button", { name: "重新安装", exact: true }).click();
  const reinstall = await dialog(page);
  equal(await reinstall.locator(".install-skill-picker").count(), 0, "reinstall has no full catalog");
  equal(await reinstall.getByLabel("安装目标目录").count(), 0, "reinstall cannot redirect destination");
  equal(await reinstall.getByLabel("目标 ID").count(), 0, "reinstall cannot change target identity");
  equal(await reinstall.locator(".preset-chip").count(), 0, "reinstall has no destination presets");
  equal((await reinstall.locator(".install-scope li").allTextContents()).join(","), "beta", "only registered skill is shown");
  await reinstall.getByText("完成后仍保持暂停。", { exact: false }).waitFor();
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.evaluate(fs.readFileSync(axeSourcePath, "utf8"));
  const artifacts = path.join(repoRoot, "tests/e2e/artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
    equal(await auditPage(page, `contextual reinstall ${colorScheme}`), 0, "reinstall accessibility");
    await reinstall.screenshot({ path: path.join(artifacts, `target-reinstall-${colorScheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await reinstall.getByRole("button", { name: "预览计划" }).click();
  await reinstall.locator(".plan-row").waitFor();
  equal(await reinstall.locator(".plan-row").count(), 1, "preview stays within selected target");
  await reinstall.getByRole("button", { name: "确认重新安装" }).click();
  await reinstall.getByText("校验通过 ·", { exact: false }).waitFor();
  await reinstall.getByRole("button", { name: "完成", exact: true }).click();
  await reinstall.waitFor({ state: "hidden" });
  equal(targets().find((t) => t.id === "single")?.installAfterUpdate, false, "reinstall preserves pause");

  await multi.getByRole("button", { name: "重新安装", exact: true }).click();
  const multiple = await dialog(page);
  equal((await multiple.locator(".install-scope li").allTextContents()).join(","), "alpha,beta", "legacy source selector resolves to its registered skills");
  equal(await multiple.locator(".install-skill-picker").count(), 0, "multi-skill reinstall remains scoped");
  await multiple.getByRole("button", { name: "取消", exact: true }).click();

  await single.locator(".row-menu summary").click();
  await single.getByRole("button", { name: "添加技能", exact: true }).click();
  const adding = await dialog(page);
  equal(await adding.getByRole("checkbox", { name: "beta", exact: true }).count(), 0, "already registered skills are excluded from add picker");
  await adding.getByLabel("搜索可安装技能").fill("gamma");
  equal(await adding.locator(".picker-chip").count(), 1, "new skill picker can be searched");
  await adding.locator(".picker-chip").filter({ hasText: "gamma" }).click();
  await adding.screenshot({ path: path.join(artifacts, "target-add-skills.png") });
  await adding.getByRole("button", { name: "预览计划" }).click();
  await adding.locator(".plan-row").waitFor();
  equal((await adding.locator(".plan-row .mono").allTextContents()).join(","), "gamma", "add preview includes only the new skill");
  await adding.getByRole("button", { name: "确认添加", exact: true }).click();
  await adding.getByText("校验通过 ·", { exact: false }).waitFor();
  await adding.getByRole("button", { name: "完成", exact: true }).click();
  await adding.waitFor({ state: "hidden" });
  equal(targets().find((t) => t.id === "single")?.skills.join(","), "beta,gamma", "add preserves prior mapping");
  equal(targets().find((t) => t.id === "single")?.installAfterUpdate, false, "add also preserves pause");

  await openSection(page, "技能");
  await page.locator(".skill-table-row").filter({ hasText: "Alpha in a same-named source." }).click();
  await page.locator(".inspector").getByRole("button", { name: "安装", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "安装 alpha", exact: true });
  await detail.waitFor({ state: "visible" });
  equal((await detail.locator(".install-scope li").allTextContents()).join(","), "alpha", "skill detail installs only current skill");
  equal(await detail.locator(".install-skill-picker").count(), 0, "skill detail does not show all skills");
  const detailDest = path.join(workspace.root, "detail");
  await detail.getByLabel("安装目标目录").fill(detailDest);
  await detail.getByLabel("目标 ID").fill("detail");
  await detail.getByRole("button", { name: "预览计划" }).click();
  await detail.locator(".plan-row").waitFor();
  equal((await detail.locator(".plan-row .mono").allTextContents()).join(","), "alpha", "same-named source does not expand selection");
  await detail.getByRole("button", { name: "确认安装", exact: true }).click();
  await detail.getByText("校验通过 ·", { exact: false }).waitFor();
  await detail.getByRole("button", { name: "完成", exact: true }).click();
  await detail.waitFor({ state: "hidden" });
  equal(targets().find((t) => t.id === "detail")?.skills.join(","), "alpha", "exact mapping survives reload");
  assert(!fs.existsSync(path.join(detailDest, "beta")), "unselected sibling never installed");
  console.log("      contextual reinstall, separate add, pause preservation and exact skill installation OK");
}

async function groupedTargets(suite: Suite): Promise<void> {
  const workspace = suite.workspace("grouped-targets");
  const vaultPath = path.join(workspace.root, "vault");
  const cli = (...args: string[]) => {
    const result = runCli([...args, "--vault", vaultPath, "--yes"], { workspace });
    equal(result.status, 0, result.stderr || result.stdout);
  };
  equal(runCli(["vault", "init", vaultPath, "--git", "--yes"], { workspace }).status, 0, "grouped targets vault init");
  const bundle = path.join(workspace.root, "imports", "suite-tools");
  writeSkill(path.join(bundle, "alpha"), "alpha", "Shared destination alpha.");
  writeSkill(path.join(bundle, "beta"), "beta", "Paused beta in a shared destination.");
  cli("source", "add", bundle, "--name", "suite-tools");
  for (const name of ["gamma", "delta"]) {
    const source = path.join(workspace.root, "imports", name);
    writeSkill(source, name, `Separate ${name} destination.`);
    cli("source", "add", source);
  }
  const qoderDest = path.join(workspace.root, "home", ".qoder", "skills");
  const customDest = path.join(workspace.root, "desktop-agent-skills");
  const missingDest = path.join(workspace.root, "offline-agent-skills");
  const rules = [
    { id: "qoder:alpha", dest: qoderDest, names: ["alpha"], skills_only: true, install_after_update: true },
    { id: "qoder:beta", dest: qoderDest, names: ["beta"], skills_only: true, install_after_update: false },
    { id: "qoder:alpha-copy", dest: qoderDest, names: ["alpha"], skills_only: true, install_after_update: true },
    { id: "desktop:gamma", dest: customDest, names: ["gamma"], skills_only: true, install_after_update: true },
    { id: "offline:delta", dest: missingDest, names: ["delta"], skills_only: true, install_after_update: true },
  ];
  for (const rule of rules.filter((rule) => rule.id !== "qoder:alpha-copy")) {
    cli("target", "install", ...rule.names, "--skills-only", "--dest", rule.dest, "--id", rule.id);
  }
  fs.writeFileSync(path.join(vaultPath, "vault.yml"), JSON.stringify({
    schema: 1,
    name: "grouped-targets",
    defaults: { ref: "main", update_mode: "auto" },
    targets: rules,
  }, null, 2) + "\n");
  fs.appendFileSync(path.join(qoderDest, "alpha", "SKILL.md"), "\nLOCAL-DRIFT\n", "utf8");
  fs.rmSync(missingDest, { recursive: true });
  const presetsFile = path.join(workspace.root, "presets.yml");
  fs.writeFileSync(presetsFile, JSON.stringify({ schema: 1, tools: [{
    id: "qoder", label: "Qoder", dest: fs.realpathSync(qoderDest),
    verified_at: null, verified_version: null, docs_url: null,
  }] }, null, 2) + "\n");

  const launched = await suite.launch({ workspace, initialVault: vaultPath, extraEnv: { VAULTDESK_PRESETS_FILE: presetsFile } });
  const page = launched.page;
  await openSection(page, "安装目标");
  const view = page.locator(".targets-view");
  const groups = view.locator(".target-group");
  const cards = view.locator(".target-card");
  const search = page.getByLabel("搜索安装目标", { exact: true });
  const qoder = groups.filter({ has: page.locator(".target-group-path").filter({ hasText: "/.qoder/skills" }) });
  equal(await groups.count(), 3, "targets sharing a canonical destination form one group");
  equal(await cards.count(), 5, "grouping preserves every target rule");
  const overview = (await view.locator(".targets-overview p").first().innerText()).replace(/\s+/g, " ");
  equal(overview, "3 个目录 · 5 条安装规则 · 4 个技能", "overview counts unique skills across destinations and overlapping rules");
  equal(await qoder.count(), 1, "one Qoder destination group");
  equal(await qoder.locator(".target-group-path").count(), 1, "shared destination path appears once in its group");
  equal(await qoder.locator(".target-card").count(), 3, "three independent rules remain in the shared group");
  const qoderText = await qoder.innerText();
  assert(/3\s*(?:条|个)\s*(?:安装)?(?:规则|目标)/.test(qoderText), "group shows three installation rules");
  assert(/2\s*个技能/.test(qoderText), "overlapping rule skills count once in the destination total");
  for (let index = 0; index < await groups.count(); index += 1) {
    assert(await groups.nth(index).locator(".target-other").count() <= 1, "other managed entries are not repeated per rule");
  }

  const qoderToggle = qoder.getByRole("button", { name: "收起分组 Qoder", exact: true });
  await qoderToggle.focus();
  await page.keyboard.press("Enter");
  equal(await qoder.getByRole("button", { name: "展开分组 Qoder", exact: true }).getAttribute("aria-expanded"), "false", "keyboard collapse announces state");
  equal(await qoder.locator(".target-card:visible").count(), 0, "collapsed group hides its rules");
  await search.fill("alpha");
  equal(await cards.count(), 2, "skill search finds both overlapping rules");
  equal(await cards.filter({ visible: true }).count(), 2, "search expands a collapsed matching group");
  await search.fill("suite-tools");
  equal(await cards.count(), 3, "source search finds all rules for that source");
  await search.fill("qoder:beta");
  equal(await cards.count(), 1, "target ID search stays exact to its matching rule");
  equal((await cards.locator("h3").innerText()).trim(), "qoder:beta", "target search displays the intended rule");
  await search.fill(customDest);
  equal(await groups.count(), 1, "destination search filters groups");
  equal((await cards.locator("h3").innerText()).trim(), "desktop:gamma", "destination search retains its rule");
  await search.fill("");

  const statusFilter = view.getByRole("group", { name: "安装目标状态筛选", exact: true });
  const paused = statusFilter.getByRole("button", { name: /^已暂停/ });
  await paused.click();
  equal(await paused.getAttribute("aria-pressed"), "true", "pause filter announces selection");
  equal(await cards.count(), 1, "pause filter excludes active targets");
  equal((await cards.locator("h3").innerText()).trim(), "qoder:beta", "pause filter preserves rule identity");
  const attention = statusFilter.getByRole("button", { name: /^需要处理/ });
  await attention.click();
  equal(await attention.getAttribute("aria-pressed"), "true", "attention filter announces selection");
  const attentionNames = (await cards.locator("h3").allTextContents()).map((value) => value.trim()).sort();
  equal(attentionNames.join(","), "offline:delta,qoder:alpha,qoder:alpha-copy", "attention includes missing, modified and unowned slots while excluding healthy paused targets");
  equal(await cards.filter({ visible: true }).count(), 3, "filter exposes matching rows despite previous collapse");
  await statusFilter.getByRole("button", { name: /^全部/ }).click();
  await page.getByRole("button", { name: "收起全部分组", exact: true }).click();
  equal(await view.locator(".target-card:visible").count(), 0, "collapse all hides all rules");
  await page.getByRole("button", { name: "展开全部分组", exact: true }).click();
  equal(await view.locator(".target-card:visible").count(), 5, "expand all restores all rules");
  await search.fill("no-matching-target-7791");
  equal(await cards.count(), 0, "empty search hides unrelated rules");
  await view.getByRole("button", { name: "清除筛选", exact: true }).click();
  equal(await search.inputValue(), "", "empty-state reset clears search");
  equal(await cards.count(), 5, "empty-state reset restores all targets");

  await page.setViewportSize({ width: 1000, height: 760 });
  await page.evaluate(fs.readFileSync(axeSourcePath, "utf8"));
  const artifacts = path.join(repoRoot, "tests/e2e/artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
    equal(await auditPage(page, `grouped targets ${colorScheme}`), 0, "grouped targets accessibility");
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "narrow target groups do not overflow horizontally");
    await search.fill("suite-tools");
    await page.screenshot({ path: path.join(artifacts, `target-groups-${colorScheme}.png`) });
    await search.fill("");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.screenshot({ path: path.join(artifacts, "target-groups-wide.png") });
  console.log("      destination grouping, deduplicated counts, source/skill/ID/path search, status filters, keyboard collapse and narrow dual-theme accessibility OK");
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
    await waitForText(page, "还没有技能");
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
    const editableAlpha = page.locator(".skill-table-row").filter({ hasText: "alpha" }).first();
    await editableAlpha.locator(".row-menu summary").click();
    await editableAlpha.getByRole("button", { name: "编辑技能" }).click();
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
    await sourceRow.getByLabel("已是最新").waitFor();

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
  await waitForText(page, "校验通过 ·", 60_000);
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
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  for (const section of ["总览", "来源", "技能", "插件", "MCP", "工具", "安装目标", "Git", "设置"]) {
    await openSection(page, section);
    scans.push(await auditPage(page, section + " 深色"));
  }
  await page.emulateMedia({ colorScheme: "light" });
  await openSection(page, "总览");

  const installButton = page.getByRole("button", { name: "安装技能" });
  await installButton.focus();
  await page.keyboard.press("Meta+k");
  const palette = await dialog(page);
  await palette.getByLabel("搜索技能、插件、MCP 与工具卡").waitFor();
  scans.push(await auditPage(page, "搜索弹窗"));
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
  scans.push(await auditPage(page, "安装弹窗"));
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

async function rendererUxRegression(suite: Suite): Promise<void> {
  const workspace = suite.workspace("renderer-ux");
  const vaultPath = path.join(workspace.root, "v2-basic");
  copyFixture("v2-basic", vaultPath);
  initGitRepo(vaultPath);
  const checkedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(vaultPath, ".vault/state.json"),
    JSON.stringify({
      schema: 1,
      last_checked_at: checkedAt,
      sources: {
        "gh-pack": { checked_at: checkedAt, status: "error", error: "SSL_ERROR_SYSCALL: connection closed" },
        "gh-standalone": {
          checked_at: checkedAt,
          status: "update-available",
          remote_commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
      targets: {},
    }),
  );

  const launched = await suite.launch({ workspace, initialVault: vaultPath });
  const { app, page } = launched;
  await waitForText(page, "1 个来源检查失败");
  await waitForText(page, "SSL_ERROR_SYSCALL: connection closed");
  await page.getByRole("alert").filter({ hasText: "1 个来源检查失败" }).waitFor();
  equal(
    (await page.locator(".source-health p").innerText()).trim(),
    "1 个检查失败 · 1 个待更新",
    "sidebar must show failed checks alongside updates",
  );

  const invalid = await page.evaluate(async () => {
    return (window as unknown as { vaultdesk: { invoke: (name: string, input: unknown) => Promise<unknown> } })
      .vaultdesk.invoke("vault.open", { path: 42 });
  }) as { ok: boolean; error?: { code: string } };
  equal(invalid.ok, false, "invalid IPC payload is rejected");
  equal(invalid.error?.code, "invalid-input", "invalid IPC payload error code");
  const missingReveal = await page.evaluate(async (target) => {
    return (window as unknown as { vaultdesk: { invoke: (name: string, input: unknown) => Promise<unknown> } })
      .vaultdesk.invoke("app.reveal", { path: target });
  }, path.join(workspace.root, "missing-parent", "item")) as { ok: boolean; error?: { code: string } };
  equal(missingReveal.ok, false, "Finder reveal does not claim success for a missing parent");
  equal(missingReveal.error?.code, "operation-failed", "missing reveal reports an actionable error");

  await openSection(page, "来源");
  const sourceMenus = page.locator(".source-row .row-menu");
  assert((await sourceMenus.count()) >= 2, "source rows expose multiple action menus");
  await sourceMenus.nth(0).locator("summary").click();
  equal(await sourceMenus.nth(0).evaluate((menu) => (menu as HTMLDetailsElement).open), true, "first action menu opens");
  await sourceMenus.nth(1).locator("summary").click();
  equal(await sourceMenus.nth(0).evaluate((menu) => (menu as HTMLDetailsElement).open), false, "opening another menu closes the first");
  await page.keyboard.press("Escape");
  equal(await sourceMenus.nth(1).evaluate((menu) => (menu as HTMLDetailsElement).open), false, "Escape closes action menu");
  await sourceMenus.nth(0).locator("summary").click();
  await page.locator(".section-header h1").click();
  equal(await sourceMenus.nth(0).evaluate((menu) => (menu as HTMLDetailsElement).open), false, "outside click closes action menu");
  const sourceDetail = page.getByRole("button", { name: "查看详情：gh-pack" });
  await sourceDetail.focus();
  await page.keyboard.press("Enter");
  equal((await page.locator(".inspector h2").innerText()).trim(), "gh-pack", "source keyboard details");

  await openSection(page, "技能");
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setSize(1100, 700);
    win?.webContents.setZoomFactor(1.25);
  });
  const skillDetail = page.getByRole("button", { name: "查看详情：gh-pack-alpha" });
  await skillDetail.focus();
  await page.keyboard.press("Enter");
  await page.locator(".inspector-close").waitFor({ state: "visible" });
  equal((await page.locator(".inspector h2").innerText()).trim(), "gh-pack-alpha", "zoomed skill details");
  const layout = await page.evaluate(() => {
    const inspector = document.querySelector(".inspector");
    const actions = document.querySelector(".titlebar-actions");
    return {
      inspectorVisible: Boolean(inspector && getComputedStyle(inspector).display !== "none"),
      titlebarFits: Boolean(actions && actions.getBoundingClientRect().right <= window.innerWidth),
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  assert(layout.inspectorVisible && layout.titlebarFits && layout.pageFits, `zoomed layout: ${JSON.stringify(layout)}`);
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "关闭详情");
  equal(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "关闭详情",
    "zoomed details receive keyboard focus",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "查看详情：gh-pack-alpha",
  );
  equal(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "查看详情：gh-pack-alpha",
    "closing details restores the row focus",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionSeconds = await page.locator(".skill-table-row").first().evaluate(
    (row) => Number.parseFloat(getComputedStyle(row).transitionDuration),
  );
  assert(transitionSeconds <= 0.001, `reduced motion disables row transitions: ${transitionSeconds}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1));
  const pluginPath = path.join(workspace.root, "v2-plugins");
  copyFixture("v2-plugins", pluginPath);
  initGitRepo(pluginPath);
  setDialogChoice(workspace, pluginPath);
  await page.locator(".tab-add").first().click();
  await page.locator(".vault-tab").filter({ hasText: "plugins" }).waitFor();
  await openSection(page, "插件");
  const pluginName = (await page.locator(".plugin-row h3").first().innerText()).trim();
  const pluginDetail = page.getByRole("button", { name: `查看详情：${pluginName}` });
  await pluginDetail.focus();
  await page.keyboard.press("Enter");
  equal((await page.locator(".inspector h2").innerText()).trim(), pluginName, "plugin keyboard details");
  await page.keyboard.press("Escape");
  await page.locator(".inspector-close").waitFor({ state: "hidden" });

  const closeInactive = page.getByRole("button", { name: "关闭 v2-basic" });
  await closeInactive.focus();
  await page.keyboard.press("Enter");
  equal(await page.locator('.vault-tabs .vault-tab').count(), 1, "keyboard closes an inactive vault tab");
  await page.waitForFunction(() => document.activeElement?.classList.contains("vault-tab"));
  equal(
    await page.evaluate(() => document.activeElement?.classList.contains("vault-tab")),
    true,
    "tab close restores focus to the active tab",
  );
  assert(transitionSeconds <= 0.001, "reduced-motion transition remains active: " + transitionSeconds + "s");
  console.log("      source health, keyboard details/tab close, 125% zoom, reduced motion and invalid IPC errors OK");
}

async function firstLaunchSettings(suite: Suite): Promise<void> {
  const workspace = suite.workspace("first-launch-settings");
  const sandboxHome = path.join(workspace.root, "home");
  fs.mkdirSync(sandboxHome, { recursive: true });
  const launched = await suite.launch({ workspace, initialVault: null, extraEnv: { HOME: sandboxHome } });
  const page = launched.page;
  await waitForText(page, "还没有最近仓库");
  const settings = page.getByRole("button", { name: "设置", exact: true });
  equal(await settings.isEnabled(), true, "settings is available before opening a Vault");
  await settings.click();
  await page.getByRole("heading", { name: "命令行与 MCP", exact: true }).waitFor();
  await page.getByRole("button", { name: "安装命令行工具", exact: true }).waitFor();
  await waitForText(page, "命令行工具可以先安装");
  equal(await page.getByRole("button", { name: "复制 MCP 配置", exact: true }).isDisabled(), true, "MCP config cannot be copied without a Vault");
  equal(await page.getByRole("button", { name: "当前仓库目录", exact: true }).isDisabled(), true, "no current Vault directory is revealed");
  await page.getByRole("button", { name: "返回仓库首页", exact: true }).click();
  await waitForText(page, "还没有最近仓库");

  const vaultPath = path.join(workspace.root, "v2-basic");
  copyFixture("v2-basic", vaultPath);
  setDialogChoice(workspace, vaultPath);
  await page.locator(".welcome-actions").getByRole("button", { name: "打开仓库", exact: true }).click();
  await page.locator(".vault-tab").filter({ hasText: "v2-basic" }).waitFor();
  await page.locator(".titlebar-actions").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "命令行与 MCP", exact: true }).waitFor();
  equal(await page.getByRole("button", { name: "当前仓库目录", exact: true }).isEnabled(), true, "Vault-specific actions become available after opening a Vault");
  await page.getByRole("button", { name: "关闭 v2-basic", exact: true }).click();
  await page.getByRole("heading", { name: "命令行与 MCP", exact: true }).waitFor();
  await waitForText(page, "命令行工具可以先安装");
  equal(await page.getByRole("button", { name: "复制 MCP 配置", exact: true }).isDisabled(), true, "closing the last Vault does not retain a stale MCP selection");
  console.log("      first-launch settings and CLI entry are reachable; Vault-dependent actions stay guarded");
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  const run = async (name: string, body: (suite: Suite) => Promise<void>): Promise<void> => {
    const only = process.env.E2E_ONLY?.toLowerCase();
    if (only && !name.toLowerCase().includes(only)) return;
    results.push(await scenario(name, body));
  };
  await run("first-launch settings and CLI access without a Vault", firstLaunchSettings);
  await run("v1 read-only open, validation, guard, recents", v1ReadOnly);
  await run("migration blocked when dirty, then applied to vault-v2", migration);
  await run("create vault, local imports, edit, explicit commit and push", writableFlow);
  await run("GitHub import, check, diff, guarded update, fork", githubFlow);
  await run("install, backup, verify, restore, remove and re-register target", installFlow);
  await run("contextual target reinstall, add and skill detail install", contextualInstall);
  await run("grouped installation targets, search, filters and keyboard", groupedTargets);
  await run("cross-vault search, settings validation and persistence", searchAndSettings);
  await run("plugin page, filters, search and imports", pluginsFlow);
  await run("tool page, filters, copy and search routing", toolsFlow);
  await run("external skill record, ownership filter and search routing", externalFlow);
  await run("manual source check and automatic update mode", manualSourceCheck);
  await run("all registered vaults sync and keyboard tabs", registeredVaultSync);
  await run("headless background worker startup and disable", headlessBackgroundWorker);
  await run("closed GUI window reopens through the single-instance handoff", reopenClosedGuiWindow);
  await run("pending skill adoption from activity", adoptPendingSkillFromActivity);
  await run("slow check, offline warning and journal recovery banner", slowOfflineAndRecovery);
  await run("custom tool preset installs under a sandboxed HOME", presetInstall);
  await run("120-skill vault renders and searches in the desktop UI", desktopScale);
  await run("axe accessibility audit, focus trap and focus restore", accessibilityAndKeyboard);
  await run("renderer UX regression: source health, keyboard and zoom", rendererUxRegression);
  if (results.some((value) => !value)) process.exitCode = 1;
}

await main();
