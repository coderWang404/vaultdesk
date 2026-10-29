import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireWriteLock } from "@vaultdesk/core";
import { tempDir } from "./helpers.js";

describe("vault write lock", () => {
  it("keeps a long-running live owner's lock", () => {
    const previous = process.env.VAULTDESK_LOCK_DIR;
    const lockDir = tempDir("live-lock");
    process.env.VAULTDESK_LOCK_DIR = lockDir;
    const lock = acquireWriteLock(tempDir("live-lock-vault"));
    const file = path.join(lockDir, fs.readdirSync(lockDir)[0] as string);
    const original = fs.readFileSync(file, "utf8");
    try {
      const payload = JSON.parse(original) as Record<string, unknown>;
      payload.created_at = "2000-01-01T00:00:00.000Z";
      fs.writeFileSync(file, JSON.stringify(payload));
      expect(() => acquireWriteLock(payload.vault as string)).toThrowError("Another VaultDesk operation");
    } finally {
      fs.writeFileSync(file, original);
      lock.release();
      if (previous === undefined) delete process.env.VAULTDESK_LOCK_DIR;
      else process.env.VAULTDESK_LOCK_DIR = previous;
    }
  });

  it("does not release a lock belonging to a replacement owner", () => {
    const previous = process.env.VAULTDESK_LOCK_DIR;
    const lockDir = tempDir("replacement-lock");
    process.env.VAULTDESK_LOCK_DIR = lockDir;
    const lock = acquireWriteLock(tempDir("replacement-lock-vault"));
    const file = path.join(lockDir, fs.readdirSync(lockDir)[0] as string);
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      payload.owner = "replacement-owner";
      fs.writeFileSync(file, JSON.stringify(payload));
      lock.release();
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
      if (previous === undefined) delete process.env.VAULTDESK_LOCK_DIR;
      else process.env.VAULTDESK_LOCK_DIR = previous;
    }
  });
});
