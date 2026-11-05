import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openVault, previewUpdate, updateSources } from "@vaultdesk/core";
import { copyFixture, git, initGitRepo, tempDir } from "./helpers.js";

function commit(dir: string, message: string): void {
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
}

function setupStandaloneUpdate(): {
  vaultPath: string;
  vendorFile: string;
  workingFile: string;
  upstreamCommit: string;
} {
  const vaultPath = copyFixture("v2-basic");
  const upstream = tempDir("skill-update-upstream");
  const upstreamSkill = path.join(upstream, "skills", "gh-standalone");
  fs.mkdirSync(upstreamSkill, { recursive: true });
  const workingFile = path.join(vaultPath, "skills", "gh-standalone", "SKILL.md");
  const nextContent = fs.readFileSync(workingFile, "utf8") + "\nUpstream version two.\n";
  fs.writeFileSync(path.join(upstreamSkill, "SKILL.md"), nextContent);
  initGitRepo(upstream);
  const upstreamCommit = git(upstream, ["rev-parse", "HEAD"]).trim();

  const sourceFile = path.join(vaultPath, "sources", "gh-standalone.yml");
  fs.writeFileSync(
    sourceFile,
    fs.readFileSync(sourceFile, "utf8").replace("ref: main\n", `ref: main\nremote_url: file://${upstream}\n`),
  );
  initGitRepo(vaultPath);
  return {
    vaultPath,
    vendorFile: path.join(vaultPath, "third_party", "gh-standalone", "SKILL.md"),
    workingFile,
    upstreamCommit,
  };
}

describe("skill source update", () => {
  it("skips paused sources in bulk previews and updates but permits an explicit manual update", async () => {
    const { vaultPath, workingFile, upstreamCommit } = setupStandaloneUpdate();
    for (const name of ["gh-standalone", "gh-pack"]) {
      const file = path.join(vaultPath, "sources", `${name}.yml`);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("update_mode: review-before-apply", "update_mode: frozen"));
    }
    commit(vaultPath, "pause remote sources");
    const before = fs.readFileSync(workingFile, "utf8");
    const head = git(vaultPath, ["rev-parse", "HEAD"]).trim();
    expect((await previewUpdate(vaultPath)).changes).toEqual([]);
    expect((await updateSources(vaultPath, { commit: true })).changes).toEqual([]);
    expect(git(vaultPath, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(fs.readFileSync(workingFile, "utf8")).toBe(before);

    expect((await previewUpdate(vaultPath, ["gh-standalone"])).changes.map((change) => change.name)).toEqual(["gh-standalone"]);
    expect((await updateSources(vaultPath, { names: ["gh-standalone"], commit: true })).applied).toBe(true);
    const source = (await openVault(vaultPath)).sources.find((entry) => entry.name === "gh-standalone");
    expect(source?.locked?.commit).toBe(upstreamCommit);
    expect(source?.updateMode).toBe("frozen");
    expect(fs.readFileSync(workingFile, "utf8")).toContain("Upstream version two.");
  });

  it("blocks a committed pristine vendor edit unless forced", async () => {
    const { vaultPath, vendorFile, workingFile, upstreamCommit } = setupStandaloneUpdate();
    const workingBefore = fs.readFileSync(workingFile, "utf8");
    fs.appendFileSync(vendorFile, "\nCommitted vendor customization.\n");
    commit(vaultPath, "chore: edit pristine vendor");
    expect(git(vaultPath, ["status", "--porcelain"]).trim()).toBe("");
    expect((await openVault(vaultPath)).issues.filter((issue) => issue.severity === "error")).toEqual([]);

    await expect(updateSources(vaultPath, { names: ["gh-standalone"] })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(fs.readFileSync(vendorFile, "utf8")).toContain("Committed vendor customization.");
    expect(fs.readFileSync(workingFile, "utf8")).toBe(workingBefore);

    const forced = await updateSources(vaultPath, { names: ["gh-standalone"], force: true });
    expect(forced.applied).toBe(true);
    expect(fs.readFileSync(vendorFile, "utf8")).toContain("Upstream version two.");
    expect(fs.readFileSync(vendorFile, "utf8")).not.toContain("Committed vendor customization.");
    expect(fs.readFileSync(workingFile, "utf8")).toContain("Upstream version two.");
    expect((await openVault(vaultPath)).sources.find((source) => source.name === "gh-standalone")?.locked?.commit).toBe(upstreamCommit);
  });

  it("blocks a committed deletion of the pristine vendor copy", async () => {
    const { vaultPath, vendorFile, workingFile } = setupStandaloneUpdate();
    const workingBefore = fs.readFileSync(workingFile, "utf8");
    fs.rmSync(path.dirname(vendorFile), { recursive: true, force: true });
    commit(vaultPath, "chore: remove pristine vendor");
    expect(git(vaultPath, ["status", "--porcelain"]).trim()).toBe("");

    await expect(updateSources(vaultPath, { names: ["gh-standalone"] })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(fs.existsSync(vendorFile)).toBe(false);
    expect(fs.readFileSync(workingFile, "utf8")).toBe(workingBefore);
  });
});
