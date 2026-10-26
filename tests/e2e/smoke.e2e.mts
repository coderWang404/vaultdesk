import fs from "node:fs";
import path from "node:path";
import {
  assert,
  copyFixture,
  createWorkspace,
  initGitRepo,
  launchApp,
  openSection,
  rewriteTargetDest,
  waitForText,
} from "./harness.js";

const workspace = createWorkspace("smoke");
const vaultPath = path.join(workspace.root, "vault");
copyFixture("v2-basic", vaultPath);
rewriteTargetDest(vaultPath, path.join(workspace.root, "agents"));
initGitRepo(vaultPath);

const launched = await launchApp({ workspace, initialVault: vaultPath, settings: { checkIntervalHours: 0 } });
try {
  const text = await launched.page.locator("body").innerText();
  console.log(text.slice(0, 800));
  assert(text.includes("v2-basic"), "vault name missing");
  await openSection(launched.page, "来源");
  await waitForText(launched.page, "所有上游与本地目录");
  assert((await launched.page.locator(".source-row").count()) === 3, "expected 3 source rows");
  console.log("SMOKE_OK", workspace.root);
} finally {
  await launched.close();
  if (process.env.KEEP_E2E !== "1") fs.rmSync(workspace.root, { recursive: true, force: true });
}
