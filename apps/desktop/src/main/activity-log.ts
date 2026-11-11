import fs from "node:fs";

export const ACTIVITY_MAX_BYTES = 512 * 1024;
export const ACTIVITY_KEEP_LINES = 1_000;

/** Keep the newest entries once the append-only activity log passes its size cap. */
export function trimActivityLog(file: string, maxBytes = ACTIVITY_MAX_BYTES, keepLines = ACTIVITY_KEEP_LINES): void {
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-keepLines);
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, lines.join("\n") + "\n", { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch { /* Trimming is housekeeping; never fail a sync because of it. */ }
}
