import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listPresets,
  presetById,
  previewPresetVerify,
  runPresetVerifyCommand,
} from "@vaultdesk/core";
import { tempDir } from "./helpers.js";

const originalPresetsFile = process.env.VAULTDESK_PRESETS_FILE;

function usePresetFile(verifyCommand: string): string {
  const file = path.join(tempDir("presets"), "presets.yml");
  fs.writeFileSync(
    file,
    [
      "schema: 1",
      "tools:",
      "  - id: test-tool",
      "    label: Test Tool",
      "    dest: ~/test-skills",
      "    verified_at: null",
      "    verified_version: null",
      "    docs_url: null",
      "    verification_required: true",
      `    verify_command: ${JSON.stringify(verifyCommand)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  process.env.VAULTDESK_PRESETS_FILE = file;
  return file;
}

afterEach(() => {
  if (originalPresetsFile === undefined) delete process.env.VAULTDESK_PRESETS_FILE;
  else process.env.VAULTDESK_PRESETS_FILE = originalPresetsFile;
});

describe("tool presets", () => {
  it("falls back to unverified candidates without verify commands", () => {
    delete process.env.VAULTDESK_PRESETS_FILE;
    const presets = listPresets();
    expect(presets.length).toBeGreaterThan(0);
    for (const preset of presets) {
      expect(preset.verified_at).toBeNull();
      expect(preset.verification_required).toBe(true);
      expect(preset.verify_command).toBeNull();
    }
    expect(presetById("claude-code")?.dest).toBe("~/.claude/skills");
    expect(presetById("missing")).toBeUndefined();
  });

  it("reads verify_command from a preset file and previews it without running", () => {
    usePresetFile("printf 'ok\\n'");
    const preset = presetById("test-tool");
    expect(preset?.verify_command).toBe("printf 'ok\\n'");
    expect(previewPresetVerify("test-tool")).toEqual({
      id: "test-tool",
      label: "Test Tool",
      dest: "~/test-skills",
      command: "printf 'ok\\n'",
      preview: true,
    });
    expect(() => previewPresetVerify("missing")).toThrow(/Unknown preset/);
  });

  it("requires explicit confirmation before spawning", async () => {
    usePresetFile("touch should-not-exist");
    await expect(
      runPresetVerifyCommand("test-tool", { confirm: false }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      runPresetVerifyCommand("missing", { confirm: true }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("captures exit code, streams and duration", async () => {
    usePresetFile("printf 'out\\n'; printf 'err\\n' >&2; exit 3");
    const result = await runPresetVerifyCommand("test-tool", { confirm: true });
    expect(result).toMatchObject({
      id: "test-tool",
      exitCode: 3,
      stdout: "out\n",
      stderr: "err\n",
      timedOut: false,
      truncated: false,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("kills a hung command at the timeout", async () => {
    usePresetFile("sleep 5");
    const started = Date.now();
    const result = await runPresetVerifyCommand("test-tool", { confirm: true, timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("caps captured output and reports truncation", async () => {
    usePresetFile(`node -e "process.stdout.write('x'.repeat(70000))"`);
    const result = await runPresetVerifyCommand("test-tool", { confirm: true });
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(64 * 1024);
  });
});
