export type SyncTrigger = "startup" | "poll" | "resume" | "manual";

/** What a finished run asks of the scheduler. */
export interface SyncOutcome {
  /** The run hit a network failure; try again after the short retry delay. */
  retrySoon?: boolean;
}

export const NETWORK_RETRY_MS = 5 * 60_000;
const MAX_QUICK_RETRIES = 3;

/**
 * Keep at most one sync in flight and never replay missed hourly ticks.
 * A run that failed on the network is retried after a few minutes, at most
 * three times in a row, so a brief outage does not leave sources in an error
 * state for a full interval.
 */
export class AutoSyncScheduler {
  private running = false;
  private lastFinishedAt: number | null = null;
  private wasOffline = false;
  private quickRetries = 0;

  constructor(
    private readonly intervalMs: () => number,
    private readonly now: () => number = Date.now,
    private readonly retryMs: number = NETWORK_RETRY_MS,
  ) {}

  async maybeRun(trigger: SyncTrigger, online: boolean, task: () => Promise<SyncOutcome | void>): Promise<boolean> {
    if (!online) {
      this.wasOffline = true;
      return false;
    }
    if (this.running) return false;
    const reconnected = this.wasOffline;
    this.wasOffline = false;
    const wait = this.quickRetries > 0 ? Math.min(this.retryMs, this.intervalMs()) : this.intervalMs();
    const due = this.lastFinishedAt === null || this.now() - this.lastFinishedAt >= wait;
    if (!due && trigger !== "manual" && trigger !== "resume" && !reconnected) return false;

    this.running = true;
    let retrySoon = false;
    try {
      retrySoon = Boolean((await task())?.retrySoon);
    } finally {
      this.quickRetries = retrySoon && this.quickRetries < MAX_QUICK_RETRIES ? this.quickRetries + 1 : 0;
      this.lastFinishedAt = this.now();
      this.running = false;
    }
    return true;
  }
}
