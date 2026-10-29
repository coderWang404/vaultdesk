import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "electron";

export const AUTO_SYNC_LABEL = "com.coderwang404.vaultdesk.autosync";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function renderLaunchAgent(executable: string, version: string, logDir: string): string {
  const stdout = path.join(logDir, "auto-sync.log");
  const stderr = path.join(logDir, "auto-sync-error.log");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${AUTO_SYNC_LABEL}</string>`,
    "<key>ProgramArguments</key><array>",
    `<string>${escapeXml(executable)}</string>`,
    "<string>--vaultdesk-background-worker</string></array>",
    "<key>EnvironmentVariables</key><dict>",
    `<key>VAULTDESK_WORKER_VERSION</key><string>${escapeXml(version)}</string></dict>`,
    "<key>RunAtLoad</key><true/>",
    "<key>KeepAlive</key><true/>",
    "<key>ThrottleInterval</key><integer>30</integer>",
    `<key>StandardOutPath</key><string>${escapeXml(stdout)}</string>`,
    `<key>StandardErrorPath</key><string>${escapeXml(stderr)}</string>`,
    "</dict></plist>",
    "",
  ].join("\n");
}

function plistPath(): string {
  return path.join(os.homedir(), "Library/LaunchAgents", `${AUTO_SYNC_LABEL}.plist`);
}

function launchDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

function serviceTarget(): string {
  return `${launchDomain()}/${AUTO_SYNC_LABEL}`;
}

function launchctl(...args: string[]): { success: boolean; detail: string } {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  return { success: result.status === 0, detail: (result.stderr || result.stdout || "").trim() };
}

/** Never register a test, development, or DMG-mounted app as the login worker. */
export function canManageLaunchAgent(): boolean {
  if (process.platform !== "darwin" || !app.isPackaged || process.env.VAULTDESK_USER_DATA) return false;
  return app.getPath("exe") === "/Applications/VaultDesk.app/Contents/MacOS/VaultDesk";
}

export function backgroundStatus(): { supported: boolean; installed: boolean; loaded: boolean } {
  if (!canManageLaunchAgent()) return { supported: false, installed: false, loaded: false };
  return {
    supported: true,
    installed: fs.existsSync(plistPath()),
    loaded: launchctl("print", serviceTarget()).success,
  };
}

export function configureLaunchAgent(enabled: boolean): ReturnType<typeof backgroundStatus> {
  if (!canManageLaunchAgent()) return backgroundStatus();
  const file = plistPath();
  const loaded = launchctl("print", serviceTarget()).success;
  if (!enabled) {
    if (loaded) {
      const stopped = launchctl("bootout", serviceTarget());
      if (!stopped.success) throw new Error(`无法停止后台同步：${stopped.detail}`);
    }
    fs.rmSync(file, { force: true });
    return backgroundStatus();
  }

  const logDir = path.join(os.homedir(), "Library/Logs/VaultDesk");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const contents = renderLaunchAgent(app.getPath("exe"), app.getVersion(), logDir);
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (previous !== contents) {
    if (loaded) {
      const stopped = launchctl("bootout", serviceTarget());
      if (!stopped.success) throw new Error(`无法重启后台同步：${stopped.detail}`);
    }
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, contents, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  if (!loaded || previous !== contents) {
    const started = launchctl("bootstrap", launchDomain(), file);
    if (!started.success) throw new Error(`无法启动后台同步：${started.detail}`);
  }
  return backgroundStatus();
}
