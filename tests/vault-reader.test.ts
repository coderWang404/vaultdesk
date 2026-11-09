import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultReader } from "../apps/desktop/src/main/vault-reader.js";
import { tempDir } from "./helpers.js";

const readers: VaultReader[] = [];
afterEach(async () => { await Promise.all(readers.splice(0).map((reader) => reader.dispose())); });

function reader(timeout = 2000): VaultReader {
  const file = path.join(tempDir("read-worker"), "worker.cjs");
  fs.writeFileSync(file, `const {parentPort}=require('node:worker_threads');
parentPort.on('message', ({id,task}) => {
  if (task.path==='crash') process.exit(1);
  if (task.path==='hang') return;
  if (task.path==='invalid') return parentPort.postMessage({id,ok:false,error:{code:'not-a-vault',message:'invalid fixture'}});
  setTimeout(()=>parentPort.postMessage({id,ok:true,data:task.path}), task.path==='slow'?40:0);
});`);
  const value = new VaultReader(file, timeout);
  readers.push(value);
  return value;
}

describe("desktop read worker", () => {
  it("correlates overlapping replies and preserves structured read errors", async () => {
    const service = reader();
    expect(await Promise.all([service.run({command: "open", path: "slow"}), service.run({command: "open", path: "fast"})])).toEqual(["slow", "fast"]);
    await expect(service.run({command: "open", path: "invalid"})).rejects.toMatchObject({code: "not-a-vault"});
    expect(await service.run({command: "open", path: "next"})).toBe("next");
  });

  it("recovers after a crashed worker instead of leaving the UI waiting forever", async () => {
    const service = reader();
    await expect(service.run({command: "open", path: "crash"})).rejects.toMatchObject({code: "operation-failed"});
    expect(await service.run({command: "open", path: "restarted"})).toBe("restarted");
  });

  it("terminates stalled reads and allows a retry", async () => {
    const service = reader(1000);
    await expect(service.run({command: "open", path: "hang"})).rejects.toThrow("超时");
    expect(await service.run({command: "open", path: "restarted"})).toBe("restarted");
  });
});
