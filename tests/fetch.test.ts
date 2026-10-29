import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchUpstream, gitLsRemote, openVault } from "@vaultdesk/core";
import { copyFixture, git, initGitRepo, tempDir } from "./helpers.js";

describe("upstream fetch cache", () => {
  it("resolves an annotated tag to the checked-out commit", async () => {
    const repo = tempDir("tagged-upstream");
    fs.writeFileSync(path.join(repo, "README.md"), "tag fixture\n");
    initGitRepo(repo);
    git(repo, ["tag", "-a", "v1", "-m", "release"]);
    const commit = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(await gitLsRemote(`file://${repo}`, "v1", repo)).toBe(commit);
  });

  it("materializes the paths of every source sharing one remote commit", async () => {
    const repo = tempDir("shared-upstream");
    for (const name of ["alpha", "beta"]) {
      const dir = path.join(repo, "skills", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
    }
    initGitRepo(repo);
    const base = (await openVault(copyFixture("v2-basic"))).sources.find((source) => source.name === "gh-pack");
    if (!base || !base.skills[0]) throw new Error("Missing fixture source");
    const sourceFor = (name: string) => ({
      ...base,
      name,
      repo: "fixture/shared-upstream",
      remoteUrl: `file://${repo}`,
      skills: [{ ...base.skills[0]!, name, sourcePath: `skills/${name}` }],
    });
    const oldCache = process.env.VAULTDESK_CACHE_DIR;
    process.env.VAULTDESK_CACHE_DIR = tempDir("shared-upstream-cache");
    try {
      const first = await fetchUpstream(sourceFor("alpha"));
      expect(fs.existsSync(path.join(first.root, "skills", "alpha", "SKILL.md"))).toBe(true);
      const second = await fetchUpstream(sourceFor("beta"));
      expect(second.commit).toBe(first.commit);
      expect(fs.existsSync(path.join(second.root, "skills", "beta", "SKILL.md"))).toBe(true);
    } finally {
      if (oldCache === undefined) delete process.env.VAULTDESK_CACHE_DIR;
      else process.env.VAULTDESK_CACHE_DIR = oldCache;
    }
  });
});
