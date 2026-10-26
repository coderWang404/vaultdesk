import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshot = process.env.VAULTDESK_SMOKE_OUT ?? path.join(appDir, "smoke.png");
const source = process.env.VAULTDESK_SMOKE_VAULT ?? path.resolve(appDir, "../../fixtures/v2-basic");

fs.rmSync(screenshot, { force: true });

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vaultdesk-smoke-"));
const fixture = path.join(workRoot, path.basename(source));
fs.cpSync(source, fixture, {
  recursive: true,
  filter: (entry) => !entry.split(path.sep).includes(".git"),
});

function git(args) {
  const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`SMOKE_FAILED git ${args.join(" ")}: ${result.stderr || result.stdout}`);
    process.exit(1);
  }
}

git(["init", "-q", "-b", "main"]);
git([
  "add",
  "--",
  ...fs.readdirSync(fixture).filter((entry) => entry !== ".git"),
]);
git([
  "-c",
  "user.name=VaultDesk Smoke",
  "-c",
  "user.email=smoke@vaultdesk.invalid",
  "commit",
  "-q",
  "-m",
  "fixture snapshot",
]);

if (process.env.VAULTDESK_SMOKE_KEEP !== "1") {
  process.on("exit", () => fs.rmSync(workRoot, { recursive: true, force: true }));
}

const env = {
  ...process.env,
  VAULTDESK_SMOKE: "1",
  VAULTDESK_SMOKE_DELAY: process.env.VAULTDESK_SMOKE_DELAY ?? "2600",
  VAULTDESK_SMOKE_OUT: screenshot,
  VAULTDESK_SMOKE_EXPECT: process.env.VAULTDESK_SMOKE_EXPECT ?? "v2-basic",
  VAULTDESK_INITIAL_VAULT: fixture,
  ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appDir], {
  cwd: appDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  console.error("SMOKE_FAILED timed out after 60s");
  process.exitCode = 1;
}, 60_000);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  const exists = fs.existsSync(screenshot);
  const bytes = exists ? fs.statSync(screenshot).size : 0;
  if (code !== 0 || !exists || bytes < 10_000) {
    console.error(`SMOKE_FAILED exit=${code ?? signal} screenshot=${exists ? `${bytes} bytes` : "missing"}`);
    if (!output.includes("SMOKE_TEXT")) console.error(output);
    process.exitCode = 1;
    return;
  }
  console.log(`SMOKE_OK screenshot=${screenshot} bytes=${bytes}`);
});
