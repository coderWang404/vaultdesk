import type { VaultDeskApi } from "../../shared/api";

declare global {
  interface Window {
    vaultdesk: VaultDeskApi;
  }
}

export {};
