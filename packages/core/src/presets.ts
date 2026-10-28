import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { presetsFileSchema, type ToolPreset } from "@vaultdesk/schema";
import { VaultDeskError } from "./errors.js";
import { isFile, readText } from "./fsx.js";

const MAX_VERIFY_OUTPUT = 64 * 1024;
const DEFAULT_VERIFY_TIMEOUT_MS = 15_000;

export interface PresetVerifyResult {
  id: string;
  command: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

// Candidate discovery locations only. None of these are treated as verified by
// VaultDesk; the desktop UI labels them as unverified until a user checks the
// tool's current documentation and records it.
const CANDIDATES: ToolPreset[] = [
  {
    id: "shared-agents",
    label: "Shared agent skills",
    dest: "~/.agents/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    verify_command: null,
    notes: "多个 agent 工具共用。安装前确认你的工具会读取此目录。",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    dest: "~/.claude/skills",
    verified_at: null,
    verified_version: null,
    docs_url: "https://docs.anthropic.com/en/docs/claude-code/skills",
    verification_required: true,
    verify_command: null,
    notes: "安装前按 Claude Code 文档确认当前技能发现规则。",
  },
  {
    id: "codex",
    label: "Codex",
    dest: "~/.codex/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    verify_command: null,
    notes: "候选目录。安装前对照已安装的 Codex 版本核实。",
  },
  {
    id: "qoder",
    label: "Qoder",
    dest: "~/.qoder/skills",
    verified_at: null,
    verified_version: null,
    docs_url: null,
    verification_required: true,
    verify_command: null,
    notes: "候选目录。安装前对照已安装的 Qoder 版本核实。",
  },
];

export function listPresets(): ToolPreset[] {
  const file = process.env.VAULTDESK_PRESETS_FILE;
  if (!file || !isFile(file)) return CANDIDATES.map((preset) => ({ ...preset }));
  try {
    const parsed = presetsFileSchema.safeParse(YAML.parse(readText(file)));
    if (parsed.success) return parsed.data.tools;
  } catch {
    // fall through to candidates
  }
  return CANDIDATES.map((preset) => ({ ...preset }));
}

export function presetById(id: string): ToolPreset | undefined {
  return listPresets().find((preset) => preset.id === id);
}

export interface PresetVerifyPreview {
  id: string;
  label: string;
  dest: string;
  command: string;
  preview: true;
}

export function previewPresetVerify(id: string): PresetVerifyPreview {
  const preset = presetById(id);
  if (!preset) throw new VaultDeskError("invalid-input", `Unknown preset: ${id}`);
  const command = preset.verify_command;
  if (!command) {
    throw new VaultDeskError("invalid-input", `Preset ${id} has no verify_command.`);
  }
  return { id, label: preset.label, dest: preset.dest, command, preview: true };
}

export async function runPresetVerifyCommand(
  id: string,
  options: { confirm: boolean; timeoutMs?: number },
): Promise<PresetVerifyResult> {
  if (options.confirm !== true) {
    throw new VaultDeskError(
      "invalid-input",
      "Running a preset verify command requires explicit confirmation.",
    );
  }
  const preset = presetById(id);
  if (!preset) {
    throw new VaultDeskError("invalid-input", `Unknown preset: ${id}`);
  }
  const command = preset.verify_command;
  if (!command) {
    throw new VaultDeskError("invalid-input", `Preset ${id} has no verify_command.`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const started = Date.now();
  const home = os.homedir();
  const pathParts = [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
  ]
    .filter(Boolean)
    .join(path.delimiter);

  return await new Promise<PresetVerifyResult>((resolve, reject) => {
    const envShell = process.env.SHELL;
    const shell = envShell && isFile(envShell) ? envShell : "/bin/sh";
    const child = spawn(shell, ["-lc", command], {
      cwd: home,
      env: { ...process.env, PATH: pathParts },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let captured = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const capture = (chunk: Buffer, target: string[]): void => {
      if (captured >= MAX_VERIFY_OUTPUT) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const remaining = MAX_VERIFY_OUTPUT - captured;
      if (text.length > remaining) {
        target.push(text.slice(0, remaining));
        captured = MAX_VERIFY_OUTPUT;
        truncated = true;
        return;
      }
      target.push(text);
      captured += text.length;
    };

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, stdout));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, stderr));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new VaultDeskError("subprocess-failed", `Verify command failed to start: ${error.message}`));
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        id,
        command,
        exitCode,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
