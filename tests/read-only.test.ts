import { describe, expect, it } from "vitest";
import { openVault, searchVaults, validateVault } from "@vaultdesk/core";
import { copyFixture, snapshotTree } from "./helpers.js";

describe("read-only vault inspection", () => {
  it("opens the v1 fixture without writing to disk", async () => {
    const vaultPath = copyFixture("v1-basic");
    const before = snapshotTree(vaultPath);

    const snapshot = await openVault(vaultPath);
    const validation = await validateVault(vaultPath);

    expect(snapshot.format).toBe("v1");
    expect(snapshot.counts).toMatchObject({ sources: 4, skills: 6, targets: 1 });
    expect(snapshot.sources.map((source) => source.name).sort()).toEqual([
      "collection-pack",
      "gh-standalone",
      "local-notes",
      "suite-pack",
    ]);
    const suite = snapshot.sources.find((source) => source.name === "suite-pack");
    expect(suite?.kind).toBe("suite");
    expect(suite?.entrypoint).toBe("suite-main");
    expect(snapshot.targets[0]?.id).toBe("fixture-agents");
    expect(validation.ok).toBe(true);
    expect(snapshotTree(vaultPath)).toEqual(before);
  });

  it("opens the v2 fixture with lock and target data", async () => {
    const vaultPath = copyFixture("v2-basic");
    const before = snapshotTree(vaultPath);

    const snapshot = await openVault(vaultPath);
    const validation = await validateVault(vaultPath);

    expect(snapshot.format).toBe("v2");
    expect(snapshot.counts).toMatchObject({ sources: 3, skills: 4, targets: 1 });
    expect(snapshot.locked?.sources["gh-standalone"]?.commit).toBe(
      "3333333333333333333333333333333333333333",
    );
    const alpha = snapshot.skills.find((skill) => skill.name === "gh-pack-alpha");
    expect(alpha).toMatchObject({ origin: "github", shape: "package-skill", packageKind: "collection" });
    expect(alpha?.lockedHash).toBe(
      "sha256:68d227dde89dae23ef1be6b186661ada5e8281459f677314d1d95227f3cef47f",
    );
    expect(validation.ok).toBe(true);
    expect(snapshotTree(vaultPath)).toEqual(before);
  });

  it("searches metadata across vaults without loading content into the index", async () => {
    const v1 = copyFixture("v1-basic");
    const v2 = copyFixture("v2-basic");
    const report = await searchVaults({
      query: "github",
      vaults: [
        { path: v1, label: "v1" },
        { path: v2, label: "v2" },
      ],
    });

    expect(report.warnings).toEqual([]);
    expect(report.hits.every((hit) => hit.origin === "github")).toBe(true);
    expect(report.hits.some((hit) => hit.skill === "gh-pack-alpha" && hit.vaultName === "v2")).toBe(true);
    expect(report.hits.some((hit) => hit.skill === "gh-standalone" && hit.vaultName === "v1")).toBe(true);
    expect(report.hits[0]?.score).toBeGreaterThanOrEqual(report.hits.at(-1)?.score ?? 0);

    const local = await searchVaults({
      query: "notes local",
      vaults: [{ path: v2, label: "v2" }],
    });
    expect(local.hits.map((hit) => hit.skill)).toContain("local-notes");
  });
});
