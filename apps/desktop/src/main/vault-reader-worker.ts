import { parentPort } from "node:worker_threads";
import { openVault, searchVaults, serializeError, validateVault } from "@vaultdesk/core";
import type { VaultReadRequest, VaultReadResponse } from "./vault-reader-protocol.js";

if (!parentPort) throw new Error("Vault reader must run in a worker thread.");
const port = parentPort;

port.on("message", async ({ id, task }: VaultReadRequest) => {
  let response: VaultReadResponse;
  try {
    const data = task.command === "open" ? await openVault(task.path)
      : task.command === "validate" ? await validateVault(task.path)
        : await searchVaults(task.options);
    response = { id, ok: true, data };
  } catch (error) {
    response = { id, ok: false, error: serializeError(error) };
  }
  port.postMessage(response);
});
