import type { IpcCommand, IpcPayload, IpcResponse } from "@vaultdesk/schema";

export type MenuAction =
  | "open-vault"
  | "new-vault"
  | "search"
  | "refresh"
  | "check"
  | "settings"
  | "close-vault";

export interface DirectoryDialogOptions {
  title?: string;
  defaultPath?: string;
}

export interface VaultDeskApi {
  invoke<K extends IpcCommand>(command: K, payload: IpcPayload<K>): Promise<IpcResponse>;
  chooseDirectory(options?: DirectoryDialogOptions): Promise<string | null>;
  onMenuAction(listener: (action: MenuAction) => void): () => void;
  platform: string;
  initialVault: string | null;
  versions: {
    app: string;
    electron: string;
    chrome: string;
    node: string;
  };
}
