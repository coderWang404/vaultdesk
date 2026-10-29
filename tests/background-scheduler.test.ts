import { describe, expect, it } from "vitest";
import { AutoSyncScheduler } from "../apps/desktop/src/main/auto-sync-scheduler.js";

describe("background auto-sync scheduler", () => {
  it("checks at startup, hourly, on reconnect and after resume without replaying missed ticks", async () => {
    let now = 0;
    let runs = 0;
    const scheduler = new AutoSyncScheduler(() => 3_600_000, () => now);
    const task = async () => { runs += 1; };

    expect(await scheduler.maybeRun("startup", true, task)).toBe(true);
    now = 60_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(false);
    now = 3_600_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    now += 5 * 3_600_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    expect(runs).toBe(3);
    expect(await scheduler.maybeRun("poll", false, task)).toBe(false);
    now += 60_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    expect(await scheduler.maybeRun("resume", true, task)).toBe(true);
    expect(runs).toBe(5);
  });

  it("rejects a concurrent run and recovers after task failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new AutoSyncScheduler(() => 3_600_000);
    const first = scheduler.maybeRun("startup", true, async () => gate);
    expect(await scheduler.maybeRun("manual", true, async () => undefined)).toBe(false);
    release();
    expect(await first).toBe(true);
    await expect(scheduler.maybeRun("manual", true, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await scheduler.maybeRun("manual", true, async () => undefined)).toBe(true);
  });

  it("runs on the first online sample after a brief observed outage", async () => {
    let now = 0;
    let runs = 0;
    const scheduler = new AutoSyncScheduler(() => 3_600_000, () => now);
    const task = async () => { runs += 1; };
    await scheduler.maybeRun("startup", true, task);
    now = 15_000;
    expect(await scheduler.maybeRun("poll", false, task)).toBe(false);
    now = 30_000;
    expect(await scheduler.maybeRun("poll", true, task)).toBe(true);
    expect(runs).toBe(2);
  });
});
