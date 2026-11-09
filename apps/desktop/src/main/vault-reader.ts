import { Worker } from "node:worker_threads";
import { VaultDeskError, type ErrorCode } from "@vaultdesk/core";
import type { VaultReadRequest, VaultReadResponse, VaultReadTask } from "./vault-reader-protocol.js";

interface PendingRead {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Only read-only snapshots and searches run here. Mutations retain their locks. */
export class VaultReader {
  private worker: Worker | undefined;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRead>();

  constructor(private readonly filename: string, private readonly timeoutMs = 60_000) {}

  private start(): Worker {
    const worker = new Worker(this.filename);
    this.worker = worker;
    worker.on("message", (response: VaultReadResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.data);
      else pending.reject(new VaultDeskError(response.error.code as ErrorCode, response.error.message, { details: response.error.details }));
    });
    worker.on("error", (error) => this.fail(worker, error));
    worker.on("exit", () => this.fail(worker, new VaultDeskError("operation-failed", "仓库读取进程已退出，请重试。")));
    worker.unref();
    return worker;
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  run<T>(task: VaultReadTask): Promise<T> {
    const worker = this.worker ?? this.start();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(worker, new VaultDeskError("operation-failed", "读取仓库超时，请确认目录可访问后重试。"));
        void worker.terminate();
      }, this.timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        worker.postMessage({ id, task } satisfies VaultReadRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.fail(worker, new VaultDeskError("operation-failed", "仓库读取服务已关闭。"));
    await worker.terminate();
  }
}
