import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolCheck } from "@vaultdesk/schema";
import { VaultDeskError } from "./errors.js";
import { canonicalPath, expandHome, isInside } from "./fsx.js";
import { listToolCards } from "./tools.js";

export type ToolCheckStatus = "ok" | "missing" | "incompatible" | "drift" | "error";
export type ToolReadinessStatus = "ready" | "incomplete" | "unconfigured";

export interface ToolCheckResult {
  id: string;
  kind: ToolCheck["kind"];
  label: string;
  status: ToolCheckStatus;
  detail: string;
  pythonPath?: string;
  nodePath?: string;
  optional: boolean;
  profiles: string[];
}

export interface ToolReadinessReport {
  name: string;
  status: ToolReadinessStatus;
  profile?: string;
  pythonPath?: string;
  nodePath?: string;
  checks: ToolCheckResult[];
  checkedAt: string;
}

type CheckOutcome = Pick<ToolCheckResult, "status" | "detail" | "pythonPath" | "nodePath">;
const PROCESS_CHECK_TIMEOUT_MS = 8_000;
const VERIFY_TIMEOUT_MS = 12_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT_CHECKS = 3;
// Preserve PATH priority only for known runtime-manager folders; reject project folders.
const TRUSTED_SYSTEM_DIRS = ["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"];

function trustedPythonDirs(): string[] {
  const home = os.homedir();
  const condaDirs = [path.join(home, "miniconda3", "bin"), path.join(home, "anaconda3", "bin")];
  const pyenvRoot = path.join(home, ".pyenv", "versions");
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter((dir) =>
    path.isAbsolute(dir) && dir === path.resolve(dir) &&
    (TRUSTED_SYSTEM_DIRS.includes(dir) || condaDirs.includes(dir) ||
      (path.basename(dir) === "bin" && path.dirname(path.dirname(dir)) === pyenvRoot &&
        /^\d+\.\d+\.\d+$/.test(path.basename(path.dirname(dir))))));
  return [...new Set([...fromPath, ...TRUSTED_SYSTEM_DIRS])];
}

function executablePath(value: string): string | null {
  if (value.includes("/")) {
    if (!value.startsWith("/") && !value.startsWith("~/")) return null;
    const expanded = path.resolve(expandHome(value));
    try {
      fs.accessSync(expanded, fs.constants.X_OK);
      return fs.statSync(expanded).isFile() ? expanded : null;
    } catch {
      return null;
    }
  }
  for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(folder)) continue;
    const candidate = path.join(folder, value);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* Search the next PATH directory. */ }
  }
  return null;
}

function nativeExecutable(candidates: string[], basename: RegExp): string | null {
  for (const candidate of candidates) {
    let descriptor: number | undefined;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      const real = fs.realpathSync(candidate);
      if (!basename.test(path.basename(real))) continue;
      descriptor = fs.openSync(real, "r");
      const header = Buffer.alloc(4);
      if (fs.readSync(descriptor, header, 0, 4, 0) !== 4) continue;
      const magic = header.toString("hex");
      if (["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "cafebabf",
        "bebafeca", "bfbafeca", "7f454c46"].includes(magic) || magic.startsWith("4d5a")) return candidate;
    } catch {
      // Keep searching trusted executable locations.
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  return null;
}

function pythonExecutable(value: string, explicitOverride = false): string | null {
  const pattern = /^python(?:3(?:\.\d+)?)?$/;
  if (!pattern.test(path.basename(value))) return null;
  if (explicitOverride !== path.isAbsolute(value)) return null;
  return nativeExecutable(explicitOverride ? [value] : trustedPythonDirs().map((dir) => path.join(dir, value)), pattern);
}

function nodeExecutable(explicitPath?: string, ranges?: Extract<ToolCheck, { kind: "node" }>["ranges"]): string | null {
  if (explicitPath !== undefined) {
    return path.isAbsolute(explicitPath) && path.basename(explicitPath) === "node"
      ? nativeExecutable([explicitPath], /^node$/) : null;
  }
  const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  let nvmVersions: { dir: string; version: string; compatible: boolean }[] = [];
  try {
    nvmVersions = fs.readdirSync(nvmRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => {
        const version = entry.name.slice(1);
        return {
          dir: path.join(nvmRoot, entry.name, "bin"), version,
          compatible: ranges?.some((range) => compareVersions(version, range.min_version)! >= 0 &&
            (!range.max_version_exclusive || compareVersions(version, range.max_version_exclusive)! < 0)) ?? false,
        };
      })
      .sort((left, right) => Number(right.compatible) - Number(left.compatible) ||
        -compareVersions(left.version, right.version)!);
  } catch {
    // nvm is optional.
  }
  const compatible = nvmVersions.filter((entry) => entry.compatible).map((entry) => entry.dir);
  const other = nvmVersions.filter((entry) => !entry.compatible).map((entry) => entry.dir);
  return nativeExecutable([...compatible, ...TRUSTED_SYSTEM_DIRS, ...other].map((dir) => path.join(dir, "node")), /^node$/);
}

async function runNative(executable: string, args: string[], signal?: AbortSignal): Promise<{ output?: string; error?: string }> {
  if (signal?.aborted) return { error: "Tool verification timed out." };
  return await new Promise<{ output?: string; error?: string }>((resolve) => {
    let finished = false;
    let output = "";
    let bytes = 0;
    const child = spawn(executable, args, {
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "ignore"],
      // Do not inherit NODE_OPTIONS, NODE_PATH, PYTHONPATH, PYTHONHOME or dynamic-loader
      // preload variables: a fixed version probe must not execute ambient code.
      env: {
        HOME: os.homedir(),
        TMPDIR: os.tmpdir(),
        LANG: process.env.LANG ?? "C",
        PATH: TRUSTED_SYSTEM_DIRS.join(path.delimiter),
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    const finish = (value: { output?: string; error?: string }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish({ error: "Tool verification timed out." });
    };
    const timer = setTimeout(abort, PROCESS_CHECK_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish({ error: "Process check output exceeded the limit." });
      } else {
        output += chunk.toString("utf8");
      }
    });
    child.on("error", () => finish({ error: "Process could not complete the read-only check." }));
    child.on("close", (code) => {
      finish(code === 0 ? { output } : { error: "Process could not complete the read-only check." });
    });
  });
}

async function runPython(
  executable: string, script: string, args: string[] = [], signal?: AbortSignal, explicitOverride = false,
): Promise<Record<string, unknown> | null> {
  const resolved = pythonExecutable(executable, explicitOverride);
  if (!resolved) return null;
  const result = await runNative(resolved, ["-I", "-c", script, ...args], signal);
  if (result.error) return { error: result.error };
  try {
    const parsed: unknown = JSON.parse(result.output?.trim() ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { error: "Python returned an invalid check result." };
  } catch {
    return { error: "Python returned an invalid check result." };
  }
}

function versionParts(value: string): number[] | null {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(value)) return null;
  return value.split(".").map(Number);
}

function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

async function checkPython(
  check: Extract<ToolCheck, { kind: "python" }>, pythonPath?: string, signal?: AbortSignal,
): Promise<CheckOutcome> {
  const executable = pythonPath ?? check.executable;
  const explicitOverride = pythonPath !== undefined;
  const resolved = pythonExecutable(executable, explicitOverride);
  const result = await runPython(executable,
    'import json,sys; print(json.dumps({"version":".".join(map(str,sys.version_info[:3])),"executable":sys.executable}))',
    [], signal, explicitOverride);
  if (!result) return { status: "missing", detail: "Python interpreter was not found." };
  if (typeof result.version !== "string") return { status: "error", detail: "Python version could not be checked." };
  const version = result.version;
  const used = typeof result.executable === "string" ? result.executable : resolved ?? executable;
  if ((check.min_version && compareVersions(version, check.min_version) === -1) ||
      (check.max_version_exclusive && compareVersions(version, check.max_version_exclusive)! >= 0)) {
    return { status: "incompatible", detail: "Python " + version + " (" + used + ") is outside the declared version range.", pythonPath: used };
  }
  return { status: "ok", detail: "Python " + version + " (" + used + ").", pythonPath: used };
}

const PACKAGE_CHECK_SCRIPT = [
  "import importlib.metadata as md, json, sys",
  "try:",
  "    from packaging.requirements import Requirement",
  "except ImportError:",
  "    try:",
  "        from pip._vendor.packaging.requirements import Requirement",
  "    except ImportError:",
  "        print(json.dumps({'error': 'PEP 440 requirement checker unavailable', 'executable': sys.executable})); sys.exit(0)",
  "try:",
  "    requirement = Requirement(sys.argv[1])",
  "except Exception:",
  "    print(json.dumps({'error': 'Invalid Python package requirement', 'executable': sys.executable})); sys.exit(0)",
  "try:",
  "    version = md.version(requirement.name)",
  "except md.PackageNotFoundError:",
  "    print(json.dumps({'missing': True, 'executable': sys.executable})); sys.exit(0)",
  "print(json.dumps({'version': version, 'compatible': version in requirement.specifier, 'executable': sys.executable}))",
].join("\n");

async function checkPythonPackage(
  check: Extract<ToolCheck, { kind: "python-package" }>, pythonPath?: string, signal?: AbortSignal,
): Promise<CheckOutcome> {
  const executable = pythonPath ?? check.interpreter;
  const explicitOverride = pythonPath !== undefined;
  const result = await runPython(executable, PACKAGE_CHECK_SCRIPT, [check.requirement], signal, explicitOverride);
  if (!result) return { status: "missing", detail: "Python interpreter was not found." };
  const used = typeof result.executable === "string" ? result.executable : pythonExecutable(executable, explicitOverride) ?? executable;
  if (result.missing === true) return { status: "missing", detail: check.requirement + " is not installed in " + used + ".", pythonPath: used };
  if (typeof result.version !== "string" || typeof result.compatible !== "boolean") {
    return { status: "error", detail: "Python package could not be checked in " + used + ".", pythonPath: used };
  }
  return result.compatible
    ? { status: "ok", detail: check.requirement + " is satisfied by " + result.version + " (" + used + ").", pythonPath: used }
    : { status: "incompatible", detail: check.requirement + " is not satisfied by " + result.version + " (" + used + ").", pythonPath: used };
}

async function checkNode(
  check: Extract<ToolCheck, { kind: "node" }>, nodePath?: string, signal?: AbortSignal,
): Promise<CheckOutcome> {
  const resolved = nodeExecutable(nodePath, check.ranges);
  if (!resolved) return { status: "missing", detail: "Node.js was not found in a trusted location." };
  const result = await runNative(resolved, ["--version"], signal);
  if (result.error) return { status: "error", detail: result.error, nodePath: resolved };
  const version = result.output?.trim().match(/^v(\d+\.\d+\.\d+)$/)?.[1];
  if (!version) return { status: "error", detail: "Node.js version could not be checked.", nodePath: resolved };
  const compatible = check.ranges.some((range) =>
    compareVersions(version, range.min_version)! >= 0 &&
    (!range.max_version_exclusive || compareVersions(version, range.max_version_exclusive)! < 0));
  return compatible
    ? { status: "ok", detail: "Node.js " + version + " (" + resolved + ") matches a declared version range.", nodePath: resolved }
    : { status: "incompatible", detail: "Node.js " + version + " (" + resolved + ") is outside the declared version ranges.", nodePath: resolved };
}

function checkPath(check: Extract<ToolCheck, { kind: "path" }>): CheckOutcome {
  const target = expandHome(check.path);
  try {
    const stat = fs.statSync(target);
    const matches = check.entry === "any" || (check.entry === "file" ? stat.isFile() : stat.isDirectory());
    return matches
      ? { status: "ok", detail: "Path exists: " + check.path }
      : { status: "incompatible", detail: "Path has the wrong type: " + check.path };
  } catch {
    return { status: "missing", detail: "Path does not exist: " + check.path };
  }
}

async function checkFileHash(
  vaultPath: string, check: Extract<ToolCheck, { kind: "file-hash" }>, signal?: AbortSignal,
): Promise<CheckOutcome> {
  const root = canonicalPath(vaultPath);
  const file = path.join(root, check.path);
  if (!isInside(file, root)) return { status: "error", detail: "Check path escapes the vault." };
  try {
    if (signal?.aborted) return { status: "error", detail: "Tool verification timed out." };
    let current = root;
    for (const part of check.path.split("/")) {
      current = path.join(current, part);
      if ((await fs.promises.lstat(current)).isSymbolicLink()) {
        return { status: "error", detail: "Check path contains a symlink: " + check.path };
      }
    }
    if (!(await fs.promises.stat(file)).isFile()) return { status: "incompatible", detail: "Expected a file: " + check.path };
    const hash = createHash("sha256");
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      for await (const chunk of handle.createReadStream({ highWaterMark: 64 * 1024, signal, autoClose: false })) {
        hash.update(chunk as Buffer);
      }
    } finally {
      await handle.close();
    }
    return "sha256:" + hash.digest("hex") === check.expected_hash
      ? { status: "ok", detail: "File matches the reviewed baseline: " + check.path }
      : { status: "drift", detail: "File changed since checks were reviewed: " + check.path };
  } catch (error) {
    if (signal?.aborted) return { status: "error", detail: "Tool verification timed out." };
    return { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error",
      detail: "File could not be checked: " + check.path };
  }
}

async function runCheck(
  vaultPath: string, check: ToolCheck, pythonPath?: string, nodePath?: string, signal?: AbortSignal,
): Promise<CheckOutcome> {
  switch (check.kind) {
    case "python": return checkPython(check, pythonPath, signal);
    case "python-package": return checkPythonPackage(check, pythonPath, signal);
    case "node": return checkNode(check, nodePath, signal);
    case "executable": return executablePath(check.name)
      ? { status: "ok", detail: "Executable is available on PATH: " + check.name }
      : { status: "missing", detail: "Executable is not available on PATH: " + check.name };
    case "path": return checkPath(check);
    case "env": return process.env[check.name]
      ? { status: "ok", detail: "Environment variable is set: " + check.name }
      : { status: "missing", detail: "Environment variable is not set: " + check.name };
    case "file-hash": return checkFileHash(vaultPath, check, signal);
  }
}

/** Verify declared prerequisites without running an install command or a tool-provided script. */
export async function verifyToolReadiness(
  vaultPath: string,
  name: string,
  options: { profile?: string; pythonPath?: string; nodePath?: string } = {},
): Promise<ToolReadinessReport> {
  const tool = listToolCards(vaultPath).tools.find((entry) => entry.name === name);
  if (!tool) throw new VaultDeskError("unknown-tool", "Unknown tool card: " + name);
  let pythonPath: string | undefined;
  if (options.pythonPath !== undefined) {
    if (!path.isAbsolute(options.pythonPath)) {
      throw new VaultDeskError("invalid-input", "Python override must be an absolute path.");
    }
    pythonPath = pythonExecutable(options.pythonPath, true) ?? undefined;
    if (!pythonPath) {
      throw new VaultDeskError("invalid-input", "Python override must point to a native Python executable.");
    }
  }
  let nodePath: string | undefined;
  if (options.nodePath !== undefined) {
    if (!path.isAbsolute(options.nodePath)) {
      throw new VaultDeskError("invalid-input", "Node.js override must be an absolute path.");
    }
    nodePath = nodeExecutable(options.nodePath) ?? undefined;
    if (!nodePath) {
      throw new VaultDeskError("invalid-input", "Node.js override must point to a native Node executable.");
    }
  }
  const profile = options.profile;
  if (profile && !tool.checks.some((check) => check.profiles.includes(profile))) {
    throw new VaultDeskError("invalid-input", "Unknown readiness profile: " + profile);
  }
  const selected = tool.checks
    .filter((check) => check.profiles.length === 0 || (profile ? check.profiles.includes(profile) : false));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  const checks: ToolCheckResult[] = new Array(selected.length);
  let nextIndex = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, selected.length) }, async () => {
      while (nextIndex < selected.length) {
        const index = nextIndex++;
        const check = selected[index]!;
        checks[index] = {
          id: check.id,
          kind: check.kind,
          label: check.label,
          ...(controller.signal.aborted
            ? { status: "error" as const, detail: "Tool verification timed out." }
            : await runCheck(vaultPath, check, pythonPath, nodePath, controller.signal)),
          optional: check.optional,
          profiles: check.profiles,
        };
      }
    }));
  } finally {
    clearTimeout(timer);
  }
  const primaryCheck = checks.find((check) => check.kind === "python" && !check.optional)
    ?? checks.find((check) => check.kind === "python" || check.kind === "python-package");
  pythonPath = primaryCheck?.pythonPath ?? pythonPath;
  nodePath = checks.find((check) => check.kind === "node")?.nodePath ?? nodePath;
  return {
    name,
    status: checks.length === 0 ? "unconfigured"
      : checks.some((check) => !check.optional && check.status !== "ok") ? "incomplete" : "ready",
    ...(profile ? { profile } : {}),
    ...(pythonPath ? { pythonPath } : {}),
    ...(nodePath ? { nodePath } : {}),
    checks,
    checkedAt: new Date().toISOString(),
  };
}
