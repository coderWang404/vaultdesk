import { contextBridge, ipcRenderer } from "electron";
import type { IpcCommand, IpcPayload, IpcResponse } from "@vaultdesk/schema";
import type { DirectoryDialogOptions, MenuAction, VaultDeskApi } from "../shared/api.js";

function argument(prefix: string): string | null {
  const found = process.argv.find((entry) => entry.startsWith(prefix));
  if (!found) return null;
  const value = found.slice(prefix.length);
  return value ? value : null;
}

let requestId = 0;

const api: VaultDeskApi = {
  invoke<K extends IpcCommand>(command: K, payload: IpcPayload<K>): Promise<IpcResponse> {
    requestId += 1;
    return ipcRenderer.invoke("vaultdesk:invoke", { id: `req-${requestId}`, command, payload });
  },
  chooseDirectory(options: DirectoryDialogOptions = {}): Promise<string | null> {
    return ipcRenderer.invoke("vaultdesk:choose-directory", options);
  },
  onMenuAction(listener: (action: MenuAction) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, action: MenuAction): void => listener(action);
    ipcRenderer.on("vaultdesk:menu", handler);
    return () => ipcRenderer.removeListener("vaultdesk:menu", handler);
  },
  platform: process.platform,
  initialVault: argument("--vaultdesk-initial-vault="),
  versions: {
    app: argument("--vaultdesk-version=") ?? "1.2.9",
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  },
};

contextBridge.exposeInMainWorld("vaultdesk", api);
