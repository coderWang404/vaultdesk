import { describe, expect, it } from "vitest";
import { loadVault, readState, recordCheck } from "@vaultdesk/core";
import { copyFixture } from "./helpers.js";

describe("check state", () => {
  it("persists failed check status and clears it after a successful check", async () => {
    const vaultPath = copyFixture("v2-basic");
    const before = await loadVault(vaultPath);
    const source = before.sources.find((entry) => entry.name === "gh-standalone");
    expect(source?.status).toBe("unknown");

    recordCheck(vaultPath, {
      checkedAt: new Date().toISOString(),
      results: [
        {
          name: "gh-standalone",
          origin: "github",
          status: "error",
          currentCommit: source?.locked?.commit,
          message: "Could not resolve host: github.com",
        },
      ],
      warnings: [],
    });

    const failedState = readState(vaultPath);
    expect(failedState.sources["gh-standalone"]).toMatchObject({
      status: "error",
      error: "Could not resolve host: github.com",
    });
    const failed = await loadVault(vaultPath);
    const failedSource = failed.sources.find((entry) => entry.name === "gh-standalone");
    expect(failedSource?.status).toBe("error");
    expect(failedSource?.lastError).toBe("Could not resolve host: github.com");

    recordCheck(vaultPath, {
      checkedAt: new Date().toISOString(),
      results: [
        {
          name: "gh-standalone",
          origin: "github",
          status: "current",
          currentCommit: source?.locked?.commit,
          remoteCommit: source?.locked?.commit,
        },
      ],
      warnings: [],
    });

    const recoveredState = readState(vaultPath);
    expect(recoveredState.sources["gh-standalone"]?.status).toBe("current");
    expect(recoveredState.sources["gh-standalone"]?.error).toBeUndefined();
    const recovered = await loadVault(vaultPath);
    const recoveredSource = recovered.sources.find((entry) => entry.name === "gh-standalone");
    expect(recoveredSource?.status).toBe("current");
    expect(recoveredSource?.lastError).toBeUndefined();
  });
});
