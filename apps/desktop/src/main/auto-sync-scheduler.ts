export type SyncTrigger = "startup" | "poll" | "resume" | "manual";

/** Keep at most one sync in flight and never replay missed hourly ticks. */
export class AutoSyncScheduler {
  private running = false;
  private lastFinishedAt: number | null = null;
  private wasOffline = false;

  constructor(
    private readonly intervalMs: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  async maybeRun(trigger: SyncTrigger, online: boolean, task: () => Promise<void>): Promise<boolean> {
    if (!online) {
      this.wasOffline = true;
      return false;
    }
    if (this.running) return false;
    const reconnected = this.wasOffline;
    this.wasOffline = false;
    const due = this.lastFinishedAt === null || this.now() - this.lastFinishedAt >= this.intervalMs();
    if (!due && trigger !== "manual" && trigger !== "resume" && !reconnected) return false;

    this.running = true;
    try {
      await task();
    } finally {
      this.lastFinishedAt = this.now();
      this.running = false;
    }
    return true;
  }
}
