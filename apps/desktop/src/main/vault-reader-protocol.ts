import type { SearchOptions } from "@vaultdesk/core";

export type VaultReadTask =
  | { command: "open"; path: string }
  | { command: "validate"; path: string }
  | { command: "search"; options: SearchOptions };

export interface VaultReadRequest {
  id: number;
  task: VaultReadTask;
}

export type VaultReadResponse =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: { code: string; message: string; details?: unknown } };
