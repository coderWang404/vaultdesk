import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { gitLsRemote, gitWithGitHubFallback, githubSshFallbackRemote, serializeError } from "@vaultdesk/core";
import { tempDir } from "./helpers.js";

const COMMIT = "a".repeat(40);

describe("GitHub transport fallback", () => {
  it("only converts credential-free standard GitHub HTTPS remotes", () => {
    expect(githubSshFallbackRemote("https://github.com/example/skills.git"))
      .toBe("ssh://git@ssh.github.com:443/example/skills.git");
    for (const remote of [
      "https://user:secret@github.com/example/skills.git",
      "https://github.com/example/skills.git?token=secret",
      "https://github.com.evil.test/example/skills.git",
      "http://github.com/example/skills.git",
      "https://github.com/example/skills/extra.git",
    ]) expect(githubSshFallbackRemote(remote)).toBeUndefined();
  });

  it("retries network failures over SSH, caches an outage, and never retries authentication failures", async () => {
    const root = tempDir("github-fallback");
    const bin = path.join(root, "bin");
    const log = path.join(root, "git.log");
    fs.mkdirSync(bin);
    fs.writeFileSync(log, "");
    fs.writeFileSync(path.join(bin, "git"), [
      "#!/bin/sh",
      "printf '%s\\n' \"$*\" >> \"$FAKE_GIT_LOG\"",
      "case \"$*\" in",
      "  *https://*)",
      "    if [ \"$FAKE_GIT_MODE\" = success ]; then printf '%s\\trefs/heads/main\\n' \"$FAKE_GIT_SHA\"; exit 0; fi",
      "    if [ \"$FAKE_GIT_MODE\" = auth ]; then",
      "      echo \"fatal: Authentication failed for '$*'\" >&2",
      "    else",
      "      echo \"fatal: Failed to connect to github.com: '$*'\" >&2",
      "    fi",
      "    exit 128;;",
      "  *ssh://git@ssh.github.com:443/*)",
      "    if [ \"$FAKE_SSH_MODE\" = auth ]; then echo 'Permission denied (publickey).' >&2; exit 128; fi",
      "    printf '%s\\trefs/heads/main\\n' \"$FAKE_GIT_SHA\"; exit 0;;",
      "esac",
      "exit 2",
    ].join("\n") + "\n", { mode: 0o755 });
    const oldPath = process.env.PATH;
    const oldLog = process.env.FAKE_GIT_LOG;
    const oldMode = process.env.FAKE_GIT_MODE;
    const oldSshMode = process.env.FAKE_SSH_MODE;
    const oldSha = process.env.FAKE_GIT_SHA;
    process.env.PATH = bin + path.delimiter + (oldPath ?? "");
    process.env.FAKE_GIT_LOG = log;
    process.env.FAKE_GIT_SHA = COMMIT;
    try {
      process.env.FAKE_GIT_MODE = "auth";
      await expect(gitLsRemote("https://github.com/example/auth.git", "main", root))
        .rejects.toMatchObject({ code: "auth-failed" });
      expect(fs.readFileSync(log, "utf8").includes("ssh://")).toBe(false);

      fs.writeFileSync(log, "");
      process.env.FAKE_GIT_MODE = "network";
      process.env.FAKE_SSH_MODE = "auth";
      await expect(gitLsRemote("https://github.com/example/no-ssh.git", "main", root))
        .rejects.toMatchObject({ code: "network" });
      process.env.FAKE_GIT_MODE = "auth";
      await expect(gitLsRemote("https://github.com/example/recovered.git", "main", root))
        .rejects.toMatchObject({ code: "auth-failed" });
      let calls = fs.readFileSync(log, "utf8").trim().split("\n");
      expect(calls.slice(-1)[0]?.includes("https://github.com/example/recovered.git")).toBe(true);

      fs.writeFileSync(log, "");
      delete process.env.FAKE_SSH_MODE;
      process.env.FAKE_GIT_MODE = "network";
      expect(await gitLsRemote("https://github.com/example/one.git", "main", root)).toBe(COMMIT);
      expect(await gitLsRemote("https://github.com/example/two.git", "main", root)).toBe(COMMIT);
      calls = fs.readFileSync(log, "utf8").trim().split("\n");
      expect(calls.filter((call) => call.includes("https://github.com/")).length).toBe(1);
      expect(calls.filter((call) => call.includes("ssh://git@ssh.github.com:443/")).length).toBe(2);

      process.env.FAKE_GIT_MODE = "success";
      process.env.FAKE_SSH_MODE = "auth";
      expect(await gitLsRemote("https://github.com/example/private.git", "main", root)).toBe(COMMIT);
      calls = fs.readFileSync(log, "utf8").trim().split("\n");
      expect(calls.slice(-2).map((call) => call.includes("ssh://git@ssh.github.com:443/")))
        .toEqual([true, false]);

      delete process.env.FAKE_SSH_MODE;
      process.env.FAKE_GIT_MODE = "network";
      const future = Date.now() + 6 * 60_000;
      vi.spyOn(Date, "now").mockReturnValue(future);
      const remote = "https://github.com/example/clone.git";
      const result = await gitWithGitHubFallback(["clone", remote, path.join(root, "clone")], remote, root);
      expect(result.code).toBe(0);
      calls = fs.readFileSync(log, "utf8").trim().split("\n");
      expect(calls.slice(-2).map((call) => call.includes("https://github.com/"))).toEqual([true, false]);

      const tokenRemote = "https://user:super-secret@github.com/example/one.git";
      let serialized = "";
      try { await gitWithGitHubFallback(["ls-remote", tokenRemote, "main"], tokenRemote, root); }
      catch (error) { serialized = JSON.stringify(serializeError(error)) + String(error); }
      expect(serialized.length > 0).toBe(true);
      expect(serialized.includes("super-secret")).toBe(false);
    } finally {
      vi.restoreAllMocks();
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldLog === undefined) delete process.env.FAKE_GIT_LOG; else process.env.FAKE_GIT_LOG = oldLog;
      if (oldMode === undefined) delete process.env.FAKE_GIT_MODE; else process.env.FAKE_GIT_MODE = oldMode;
      if (oldSshMode === undefined) delete process.env.FAKE_SSH_MODE; else process.env.FAKE_SSH_MODE = oldSshMode;
      if (oldSha === undefined) delete process.env.FAKE_GIT_SHA; else process.env.FAKE_GIT_SHA = oldSha;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
