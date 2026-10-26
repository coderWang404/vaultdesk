import path from "node:path";
import { nowIso, readJson, removePath, writeJsonAtomic } from "./fsx.js";
import type { Operation } from "@vaultdesk/schema";

export function journalPath(vaultPath: string): string {
  return path.join(vaultPath, ".vault", "operation.json");
}

export async function readJournal(vaultPath: string): Promise<Operation | null> {
  const file = journalPath(vaultPath);
  const raw = readJson<Record<string, unknown> | null>(file, null);
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as Operation;
}

export class Journal {
  private readonly file: string;
  private readonly operation: Operation;

  private constructor(file: string, operation: Operation) {
    this.file = file;
    this.operation = operation;
  }

  static begin(vaultPath: string, kind: Operation["kind"], steps: { id: string; label: string }[]): Journal {
    const operation: Operation = {
      schema: 1,
      kind,
      started_at: nowIso(),
      vault: vaultPath,
      steps: steps.map((step) => ({ ...step, status: "pending" })),
    };
    const journal = new Journal(journalPath(vaultPath), operation);
    journal.persist();
    return journal;
  }

  private persist(): void {
    writeJsonAtomic(this.file, this.operation);
  }

  start(id: string): void {
    const step = this.operation.steps.find((entry) => entry.id === id);
    if (!step) return;
    step.status = "running";
    step.started_at = nowIso();
    this.persist();
  }

  done(id: string, detail?: string): void {
    const step = this.operation.steps.find((entry) => entry.id === id);
    if (!step) return;
    step.status = "done";
    step.finished_at = nowIso();
    if (detail) step.detail = detail;
    this.persist();
  }

  skipped(id: string, detail?: string): void {
    const step = this.operation.steps.find((entry) => entry.id === id);
    if (!step) return;
    step.status = "skipped";
    step.finished_at = nowIso();
    if (detail) step.detail = detail;
    this.persist();
  }

  fail(id: string, message: string): void {
    const step = this.operation.steps.find((entry) => entry.id === id);
    if (step) {
      step.status = "failed";
      step.finished_at = nowIso();
      step.detail = message;
    }
    this.operation.error = message;
    this.persist();
  }

  finish(): void {
    removePath(this.file);
  }

  get path(): string {
    return this.file;
  }
}
