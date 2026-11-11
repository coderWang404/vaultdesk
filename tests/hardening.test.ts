import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireWriteLock,
  backupRootFor,
  beginManagedDistribution,
  buildVault,
  checkSources,
  detectImport,
  distributeCurrentSourceDetailed,
  installSkills,
  openVault,
  removeSource,
  validateVault,
  verifyTarget,
} from "@vaultdesk/core";
import { AutoSyncScheduler } from "../apps/desktop/src/main/auto-sync-scheduler.js";
import { trimActivityLog } from "../apps/desktop/src/main/activity-log.js";
import { copyFixture, git, initGitRepo, repoRoot, setTargetDest, tempDir } from "./helpers.js";

const DEAD_PID = 999_999;

function setup() {
  const vault = copyFixture("v2-basic");
  const root = fs.realpathSync(tempDir("hardening"));
  const master = path.join(root, "agents", "skills");
  const dest = path.join(root, "codex", "skills");
  const backupRoot = path.join(root, "backups");
  setTargetDest(vault, dest);
  return { vault, root, master, dest, backupRoot, options: { agentsSkillsDir: master, backupRoot } };
}

function listBackupStamps(root: string): string[] {
  return fs.existsSync(root) ? fs.readdirSync(root).sort() : [];
}

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of ["VAULTDESK_LOCK_DIR", "VAULTDESK_AGENTS_SKILLS_DIR", "PATH", "FAKE_GIT_COUNT"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("replacing a locally modified managed copy", () => {
  it("saves the modified copy before install replaces it and keeps only the newest saved copy", async () => {
    const { vault, dest, backupRoot } = setup();
    const input = { names: ["local-notes"], dest, id: "fixture-agents", backupRoot };
    const first = await installSkills(vault, input);
    expect(first.backups).toHaveLength(0);

    fs.writeFileSync(path.join(dest, "local-notes", "runtime-output.txt"), "first run\n");
    const second = await installSkills(vault, input);
    expect(second.plan.slots[0]).toMatchObject({ state: "managed", action: "backup-and-replace" });
    expect(second.backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(second.backups[0]!.to, "runtime-output.txt"), "utf8")).toBe("first run\n");
    expect(fs.existsSync(path.join(dest, "local-notes", "runtime-output.txt"))).toBe(false);
    expect(second.verification.modified).toEqual([]);
    expect(second.verification.missing).not.toContain("local-notes");

    fs.writeFileSync(path.join(dest, "local-notes", "runtime-output.txt"), "second run\n");
    const third = await installSkills(vault, input);
    expect(fs.readFileSync(path.join(third.backups[0]!.to, "runtime-output.txt"), "utf8")).toBe("second run\n");
    const stamps = listBackupStamps(backupRootFor("fixture-agents", backupRoot));
    expect(stamps).toEqual([path.basename(path.dirname(third.backups[0]!.to))]);

    const untouched = await installSkills(vault, input);
    expect(untouched.plan.slots[0]).toMatchObject({ state: "managed", action: "replace-managed" });
    expect(untouched.backups).toHaveLength(0);
  });

  it("refuses to distribute over a modified master, then saves and replaces it when forced", async () => {
    const { vault, master, options } = setup();
    (await beginManagedDistribution(vault, "local-notes", options)).finalize();
    const slot = path.join(master, "local-notes");
    fs.writeFileSync(path.join(slot, "state.json"), "{\"run\":1}\n");

    await expect(beginManagedDistribution(vault, "local-notes", options))
      .rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("force") });
    expect(fs.existsSync(path.join(slot, "state.json"))).toBe(true);

    const forced = await distributeCurrentSourceDetailed(vault, "local-notes", { ...options, force: true });
    expect(forced.overrideBackups).toHaveLength(1);
    expect(fs.readFileSync(path.join(forced.overrideBackups[0]!, "state.json"), "utf8")).toBe("{\"run\":1}\n");
    expect(fs.existsSync(path.join(slot, "state.json"))).toBe(false);
    expect(fs.existsSync(path.join(slot, "SKILL.md"))).toBe(true);

    fs.writeFileSync(path.join(slot, "state.json"), "{\"run\":2}\n");
    const again = await distributeCurrentSourceDetailed(vault, "local-notes", { ...options, force: true });
    expect(again.overrideBackups).toEqual(forced.overrideBackups);
    expect(fs.readFileSync(path.join(again.overrideBackups[0]!, "state.json"), "utf8")).toBe("{\"run\":2}\n");
    expect(fs.readdirSync(path.dirname(again.overrideBackups[0]!))).toHaveLength(1);
  });

  it("never forces over a directory another owner controls", async () => {
    const { vault, master, options } = setup();
    const slot = path.join(master, "local-notes");
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, "SKILL.md"), "mine\n");
    await expect(beginManagedDistribution(vault, "local-notes", { ...options, force: true }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(slot, "SKILL.md"), "utf8")).toBe("mine\n");
  });
});

describe("leftover locks", () => {
  it("releases a distribution lock at once when its owner has exited", async () => {
    const { vault, backupRoot, options } = setup();
    const lock = path.join(backupRoot, "distribution", ".distribution.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: DEAD_PID, started: Date.now() - 1_000 }) + "\n");
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    transaction.finalize();
    expect(transaction.changedPaths.length).toBeGreaterThan(0);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("keeps a distribution lock whose owner is still running", async () => {
    const { vault, backupRoot, options } = setup();
    const lock = path.join(backupRoot, "distribution", ".distribution.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, started: Date.now() }) + "\n");
    await expect(beginManagedDistribution(vault, "local-notes", options))
      .rejects.toMatchObject({ code: "conflict", message: "Another distribution transaction is active." });
  });

  it("treats a write lock as a leftover when its pid now belongs to a different process", () => {
    const lockDir = tempDir("reused-pid-lock");
    process.env.VAULTDESK_LOCK_DIR = lockDir;
    const vault = tempDir("reused-pid-vault");
    const lock = acquireWriteLock(vault);
    const file = path.join(lockDir, fs.readdirSync(lockDir)[0] as string);
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(typeof payload.pid_started).toBe("string");
    expect(() => acquireWriteLock(vault)).toThrowError("Another VaultDesk operation");

    // Same pid, but the recorded owner started at a different moment: the number was reused.
    payload.pid_started = "Thu Jan 1 00:00:00 1970";
    payload.owner = "crashed-earlier-process";
    fs.writeFileSync(file, JSON.stringify(payload));
    const replacement = acquireWriteLock(vault);
    replacement.release();
    lock.release();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("releases a distribution lock whose pid now belongs to a different process", async () => {
    const { vault, backupRoot, options } = setup();
    const lock = path.join(backupRoot, "distribution", ".distribution.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, started: Date.now(), pidStarted: "Thu Jan 1 00:00:00 1970" }) + "\n");
    const transaction = await beginManagedDistribution(vault, "local-notes", options);
    transaction.finalize();
    expect(transaction.changedPaths.length).toBeGreaterThan(0);
  });
});

describe("removing a source", () => {
  it("removes its master, links and saved state from agent directories but leaves foreign paths", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    for (const name of ["local-notes", "gh-standalone"]) {
      (await beginManagedDistribution(vault, name, options)).finalize();
    }
    expect(fs.lstatSync(path.join(dest, "gh-standalone")).isSymbolicLink()).toBe(true);

    const result = await removeSource(vault, "gh-standalone", options);
    expect(fs.existsSync(path.join(master, "gh-standalone"))).toBe(false);
    expect(() => fs.lstatSync(path.join(dest, "gh-standalone"))).toThrow();
    expect(result.distributed.removed.sort()).toEqual(
      [path.join(dest, "gh-standalone"), path.join(master, "gh-standalone")].sort(),
    );
    expect(result.distributed.backups).toHaveLength(1);
    expect(result.distributed.backups[0]!.startsWith(backupRoot)).toBe(true);
    expect(fs.existsSync(path.join(result.distributed.backups[0]!, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(master, "local-notes", "SKILL.md"))).toBe(true);
    expect(fs.lstatSync(path.join(dest, "local-notes")).isSymbolicLink()).toBe(true);
    expect((await validateVault(vault)).ok).toBe(true);
  });

  it("leaves a same-named directory it does not own in place", async () => {
    const { vault, master, options } = setup();
    const foreign = path.join(master, "gh-standalone");
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, "SKILL.md"), "someone else's\n");
    const result = await removeSource(vault, "gh-standalone", options);
    expect(result.distributed.removed).toEqual([]);
    expect(result.distributed.kept).toEqual([foreign]);
    expect(fs.readFileSync(path.join(foreign, "SKILL.md"), "utf8")).toBe("someone else's\n");
  });

  it("keeps distributed files when asked to", async () => {
    const { vault, master, options } = setup();
    (await beginManagedDistribution(vault, "gh-standalone", options)).finalize();
    const result = await removeSource(vault, "gh-standalone", { ...options, removeDistributed: false });
    expect(result.distributed).toEqual({ removed: [], backups: [], kept: [] });
    expect(fs.existsSync(path.join(master, "gh-standalone", "SKILL.md"))).toBe(true);
  });
});

describe("symlinks inside a skill", () => {
  it("keeps a relative link relative through build, install and distribution", async () => {
    const { vault, master, dest, backupRoot, options } = setup();
    process.env.VAULTDESK_AGENTS_SKILLS_DIR = master;
    fs.symlinkSync("SKILL.md", path.join(vault, "skills", "local-notes", "ALIAS.md"));
    await buildVault(vault);
    expect(fs.readlinkSync(path.join(vault, "build", "skills", "local-notes", "ALIAS.md"))).toBe("SKILL.md");
    await installSkills(vault, { names: ["local-notes"], dest, id: "fixture-agents", backupRoot });
    expect(fs.readlinkSync(path.join(dest, "local-notes", "ALIAS.md"))).toBe("SKILL.md");
    (await beginManagedDistribution(vault, "local-notes", options)).finalize();
    expect(fs.readlinkSync(path.join(master, "local-notes", "ALIAS.md"))).toBe("SKILL.md");
    const verification = await verifyTarget(vault, "fixture-agents");
    expect(verification.modified).toEqual([]);
    expect(verification.missing).not.toContain("local-notes");
  });

  it("refuses to import a skill whose link points outside its folder", () => {
    const root = tempDir("escaping-link");
    const skill = path.join(root, "linky");
    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: linky\ndescription: Has a link.\n---\n");
    fs.symlinkSync("/etc/hosts", path.join(skill, "hosts"));
    expect(() => detectImport(skill)).toThrowError(/symlink points outside the skill folder \(hosts\)/);
    fs.unlinkSync(path.join(skill, "hosts"));
    fs.symlinkSync("missing.md", path.join(skill, "dangling"));
    expect(() => detectImport(skill)).toThrowError(/broken symlink \(dangling\)/);
    fs.unlinkSync(path.join(skill, "dangling"));
    fs.symlinkSync("SKILL.md", path.join(skill, "ALIAS.md"));
    expect(detectImport(skill).skills.map((entry) => entry.name)).toEqual(["linky"]);
  });

  it("suggests a valid name when a skill name is not a lowercase slug", () => {
    const skill = path.join(tempDir("bad-name"), "My_Skill");
    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: My_Skill\ndescription: Bad name.\n---\n");
    expect(() => detectImport(skill)).toThrowError(/name: my-skill/);
  });
});

describe("build housekeeping", () => {
  it("removes staging directories left by a build that crashed", async () => {
    const { vault } = setup();
    const buildDir = path.join(vault, "build");
    const crashed = path.join(buildDir, `.staging-${DEAD_PID}-${Date.now() - 60_000}`);
    const live = path.join(buildDir, `.staging-${process.ppid}-${Date.now()}`);
    for (const dir of [crashed, live]) {
      fs.mkdirSync(path.join(dir, "leftover"), { recursive: true });
    }
    await buildVault(vault);
    expect(fs.existsSync(crashed)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(path.join(buildDir, "skills", "local-notes", "SKILL.md"))).toBe(true);
  });
});

describe("network resilience", () => {
  it("retries a failed upstream check once before reporting a network error", async () => {
    const vault = copyFixture("v2-basic");
    const sourceFile = path.join(vault, "sources", "gh-standalone.yml");
    fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, "utf8")
      .replace("ref: main\n", "ref: main\nremote_url: https://git.example.invalid/seed.git\n"));
    const bin = tempDir("flaky-git");
    const counter = path.join(bin, "count");
    fs.writeFileSync(counter, "0");
    fs.writeFileSync(path.join(bin, "git"), [
      "#!/bin/sh",
      "case \"$*\" in",
      "  *ls-remote*)",
      "    n=$(cat \"$FAKE_GIT_COUNT\"); n=$((n+1)); printf '%s' \"$n\" > \"$FAKE_GIT_COUNT\"",
      "    if [ \"$n\" -le \"${FAKE_GIT_FAILS:-1}\" ]; then echo 'fatal: unable to access: Failed to connect to git.example.invalid' >&2; exit 128; fi",
      "    printf '%s\\trefs/heads/main\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; exit 0;;",
      "esac",
      "exit 1",
    ].join("\n") + "\n", { mode: 0o755 });
    process.env.PATH = bin + path.delimiter + (savedEnv.PATH ?? "");
    process.env.FAKE_GIT_COUNT = counter;

    const recovered = await checkSources(vault, { names: ["gh-standalone"], persist: false, retryDelayMs: 0 });
    expect(recovered.results[0]).toMatchObject({ name: "gh-standalone", remoteCommit: "a".repeat(40) });
    expect(fs.readFileSync(counter, "utf8")).toBe("2");

    fs.writeFileSync(counter, "0");
    process.env.FAKE_GIT_FAILS = "9";
    try {
      const failed = await checkSources(vault, { names: ["gh-standalone"], persist: false, retryDelayMs: 0 });
      expect(failed.results[0]).toMatchObject({ status: "error" });
      expect(fs.readFileSync(counter, "utf8")).toBe("2");
    } finally {
      delete process.env.FAKE_GIT_FAILS;
    }
  });

  it("re-runs a few minutes after a network failure, at most three times in a row", async () => {
    let now = 0;
    let runs = 0;
    let failing = true;
    const scheduler = new AutoSyncScheduler(() => 3_600_000, () => now, 300_000);
    const task = async () => { runs += 1; return { retrySoon: failing }; };

    expect(await scheduler.maybeRun("startup", true, task)).toBe(true);
    now += 60_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(false);
    for (let retry = 0; retry < 3; retry += 1) {
      now += 300_000;
      expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    }
    expect(runs).toBe(4);
    now += 300_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(false);
    now += 3_600_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);

    failing = false;
    now += 300_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    now += 300_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(false);
  });
});

describe("activity log", () => {
  it("keeps the newest entries once the log passes its size cap", () => {
    const file = path.join(tempDir("activity"), "auto-sync-activity.jsonl");
    const lines = Array.from({ length: 500 }, (_, index) => JSON.stringify({ n: index, pad: "x".repeat(40) }));
    fs.writeFileSync(file, lines.join("\n") + "\n");
    trimActivityLog(file, 1_000_000, 100);
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(500);
    trimActivityLog(file, 1_000, 100);
    const kept = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(kept).toHaveLength(100);
    expect(JSON.parse(kept[0]!)).toMatchObject({ n: 400 });
    expect(JSON.parse(kept.at(-1)!)).toMatchObject({ n: 499 });
  });
});

describe("CLI wording", () => {
  function runCli(vault: string, args: string[], extraEnv: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "packages/cli/dist/index.js"), "--vault", vault, ...args], {
      cwd: repoRoot, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1", ...extraEnv },
    });
    if (result.error) throw result.error;
    return result;
  }

  it("labels a v2 vault as v2 in vault status", () => {
    const vault = copyFixture("v2-basic");
    expect(runCli(vault, ["vault", "status"]).stdout.split("\n")[0]).toContain("v2 · writable");
  });

  it("says that an unpushed commit pauses automatic updates", () => {
    const vault = copyFixture("v2-basic");
    const remote = tempDir("cli-wording-remote");
    initGitRepo(vault);
    git(remote, ["init", "--bare", "-b", "main"]);
    git(vault, ["remote", "add", "origin", remote]);
    git(vault, ["push", "-u", "origin", "main"]);
    fs.appendFileSync(path.join(vault, "README.md"), "\nlocal note\n");
    const committed = runCli(vault, ["git", "commit", "--path", "README.md", "--message", "docs: note", "--yes"]);
    expect(committed.status).toBe(0);
    expect(committed.stdout).toContain("Automatic source updates stay paused until you run: vaultdesk git push --yes");
  });

  it("offers --force and reports where the replaced copy was saved", async () => {
    const { vault, master, backupRoot } = setup();
    const env = { VAULTDESK_AGENTS_SKILLS_DIR: master, VAULTDESK_BACKUP_DIR: backupRoot, VAULTDESK_LOCK_DIR: tempDir("cli-force-locks") };
    expect(runCli(vault, ["source", "distribute", "local-notes", "--yes"], env).status).toBe(0);
    fs.writeFileSync(path.join(master, "local-notes", "state.json"), "{}\n");
    const blocked = runCli(vault, ["source", "distribute", "local-notes", "--yes"], env);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr + blocked.stdout).toContain("force");
    const forced = runCli(vault, ["source", "distribute", "local-notes", "--force", "--yes", "--json"], env);
    expect(forced.status).toBe(0);
    const data = (JSON.parse(forced.stdout) as { data: { overrideBackups: string[] } }).data;
    expect(data.overrideBackups).toHaveLength(1);
    expect(fs.existsSync(path.join(data.overrideBackups[0]!, "state.json"))).toBe(true);
    expect((await openVault(vault)).issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
