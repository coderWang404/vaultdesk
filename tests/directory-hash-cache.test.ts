import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDirectory, withDirectoryHashCache } from "@vaultdesk/core";
import { tempDir } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("read snapshot directory hashes", () => {
  it("reads symlink aliases once, but sees edits in later snapshots and outside a read scope", async () => {
    const root = tempDir("hash-cache");
    const content = path.join(root, "content");
    const link = path.join(root, "linked");
    fs.mkdirSync(content);
    const file = path.join(content, "SKILL.md");
    fs.writeFileSync(file, "original");
    fs.symlinkSync(content, link);
    const read = vi.spyOn(fs, "readFileSync");
    const original = await withDirectoryHashCache(async () => {
      const first = hashDirectory(content);
      expect(hashDirectory(link)).toBe(first);
      expect(hashDirectory(content)).toBe(first);
      return first;
    });
    expect(read.mock.calls.filter(([name]) => String(name).endsWith("SKILL.md"))).toHaveLength(1);
    fs.writeFileSync(file, "modified");
    const updated = await withDirectoryHashCache(async () => hashDirectory(content));
    expect(updated).not.toBe(original);
    expect(read.mock.calls.filter(([name]) => String(name).endsWith("SKILL.md"))).toHaveLength(2);
    fs.writeFileSync(file, "changed again");
    expect(hashDirectory(content)).not.toBe(updated);
  });

  it("keeps exclusion policies and overlapping read scopes independent", async () => {
    const root = tempDir("hash-options");
    fs.writeFileSync(path.join(root, "SKILL.md"), "skill");
    fs.writeFileSync(path.join(root, "extra.txt"), "one");
    const plain = hashDirectory(root);
    await withDirectoryHashCache(async () => {
      expect(hashDirectory(root)).toBe(plain);
      expect(hashDirectory(root, { excludeFiles: new Set(["extra.txt"]) })).not.toBe(plain);
      fs.writeFileSync(path.join(root, "extra.txt"), "two");
      await withDirectoryHashCache(async () => expect(hashDirectory(root)).not.toBe(plain));
      expect(hashDirectory(root)).toBe(plain);
    });
  });
});
