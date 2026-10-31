import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultDeskError } from "@vaultdesk/core";

export interface CliContext {
  cliBundlePath?: string;
  appExecutable: string;
}

export interface CliStatus {
  available: boolean;
  installed: boolean;
  managed: boolean;
  conflict: boolean;
  launcherPath: string;
  bundlePath?: string;
  detail: string;
}

const MARKER = "# vaultdesk-managed-launcher:v1";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function cliLauncherContent(appExecutable: string, bundlePath: string): string {
  return [
    "#!/bin/sh",
    MARKER,
    "set -eu",
    "unset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE ELECTRON_NO_ASAR NODE_REPL_EXTERNAL_MODULE DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH",
    `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(appExecutable)} ${shellQuote(bundlePath)} "$@"`,
    "",
  ].join("\n");
}

export function mcpClientConfig(command: string, vaultPath: string): string {
  return JSON.stringify({
    mcpServers: {
      vaultdesk: { command, args: ["mcp", "serve", "--vault", vaultPath] },
    },
  }, null, 2);
}

function launcherState(file: string, expected: string): { present: boolean; managed: boolean; current: boolean } {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return { present: false, managed: false, current: false };
  // Never follow a symlink or overwrite a user-edited launcher, even if it retains our marker.
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) return { present: true, managed: false, current: false };
  const content = fs.readFileSync(file, "utf8");
  // Application updates preserve these paths. Compare the whole template so even
  // edits to a launcher retaining our marker remain protected.
  const managed = content === expected;
  const current = managed && content === expected && (stat.mode & 0o111) !== 0;
  return { present: true, managed, current };
}

export function cliStatus(context: CliContext, homeDir = os.homedir()): CliStatus {
  const launcherPath = path.join(homeDir, ".local", "bin", "vaultdesk");
  const expected = cliLauncherContent(context.appExecutable, context.cliBundlePath ?? "");
  const state = launcherState(launcherPath, expected);
  const available = Boolean(context.cliBundlePath && fs.existsSync(context.cliBundlePath) && fs.existsSync(context.appExecutable));
  return {
    available,
    installed: available && state.current,
    managed: state.managed,
    conflict: state.present && !state.managed,
    launcherPath,
    ...(context.cliBundlePath ? { bundlePath: context.cliBundlePath } : {}),
    detail: state.present && !state.managed
      ? "同名命令已存在或已被手动修改，未覆盖。请先保留并移走该文件。"
      : !available
        ? "请先将正式版 VaultDesk 放入 Applications，再安装命令行工具。"
        : state.current ? "命令行工具随应用更新，无需源码目录或额外 Node.js。" : "将内置命令行工具安装到用户目录，无需管理员权限。",
  };
}

export function installCli(context: CliContext, homeDir = os.homedir()): CliStatus {
  const status = cliStatus(context, homeDir);
  if (!status.available || !context.cliBundlePath) {
    throw new VaultDeskError("operation-failed", "请先将正式版 VaultDesk 放入 Applications，再安装命令行工具。");
  }
  if (status.conflict) {
    throw new VaultDeskError("conflict", `命令行路径已有非受管或已修改文件，未覆盖：${status.launcherPath}`);
  }
  if (status.installed) return status;
  const parent = path.dirname(status.launcherPath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
  const temporary = path.join(parent, `.vaultdesk-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, cliLauncherContent(context.appExecutable, context.cliBundlePath), { mode: 0o755, flag: "wx" });
    fs.chmodSync(temporary, 0o755);
    // Detect a competing writer before replacing the old owned launcher.
    const current = cliStatus(context, homeDir);
    if (current.conflict) throw new VaultDeskError("conflict", `命令行路径已变化，未覆盖：${status.launcherPath}`);
    if (!current.managed) {
      fs.linkSync(temporary, status.launcherPath);
    } else {
      fs.renameSync(temporary, status.launcherPath);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return cliStatus(context, homeDir);
}
