import fs from "node:fs";
import path from "node:path";
import { ensureDir, expandHome, nowIso, readText, removePath, sha256 } from "../fsx.js";
import { VaultDeskError } from "../errors.js";

export interface VaultLockHandle {
  release(): void;
}

export function lockDirectory(): string {
  return process.env.VAULTDESK_LOCK_DIR || path.join(expandHome("~/Library/Caches/VaultDesk"), "locks");
}

function lockPath(vaultPath: string): string {
  return path.join(lockDirectory(), `${sha256(path.resolve(vaultPath)).slice(0, 32)}.lock`);
}

export function acquireWriteLock(vaultPath: string): VaultLockHandle {
  const file = lockPath(vaultPath);
  ensureDir(path.dirname(file));
  const payload = JSON.stringify({ pid: process.pid, vault: path.resolve(vaultPath), created_at: nowIso() });

  const tryAcquire = (): boolean => {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  };

  if (!tryAcquire()) {
    let stale = false;
    try {
      const raw = JSON.parse(readText(file)) as { pid?: number; created_at?: string };
      const created = raw.created_at ? Date.parse(raw.created_at) : 0;
      const ageMs = Date.now() - created;
      let alive = false;
      if (typeof raw.pid === "number") {
        try {
          process.kill(raw.pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      stale = !alive || ageMs > 10 * 60 * 1000;
    } catch {
      stale = true;
    }
    if (!stale) {
      throw new VaultDeskError("conflict", "Another VaultDesk operation is already running for this vault.");
    }
    removePath(file);
    if (!tryAcquire()) {
      throw new VaultDeskError("conflict", "Another VaultDesk operation started while acquiring the vault lock.");
    }
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        const raw = JSON.parse(readText(file)) as { pid?: number };
        if (raw.pid === process.pid) removePath(file);
      } catch {
        removePath(file);
      }
    },
  };
}

export async function withWriteLock<T>(vaultPath: string, action: () => Promise<T>): Promise<T> {
  const lock = acquireWriteLock(vaultPath);
  try {
    return await action();
  } finally {
    lock.release();
  }
}

export function writeFileStrict(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    throw new VaultDeskError("path-conflict", `Refusing to overwrite existing file: ${filePath}`);
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}
