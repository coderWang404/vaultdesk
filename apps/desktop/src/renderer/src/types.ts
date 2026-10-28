import type { VaultSnapshot, ValidationReport } from "@vaultdesk/core";

export type Section =
  | "overview"
  | "sources"
  | "skills"
  | "plugins"
  | "mcp"
  | "tools"
  | "targets"
  | "git"
  | "settings";

export interface OpenVault {
  snapshot: VaultSnapshot;
  validation?: ValidationReport;
  checkedAt?: string;
  loading?: boolean;
}

export interface Selection {
  kind: "source" | "skill" | "plugin" | "external" | null;
  name: string | null;
}

export type ModalState =
  | { kind: "new-vault" }
  | { kind: "migration"; vaultPath: string }
  | { kind: "validation"; vaultPath: string }
  | { kind: "diff"; vaultPath: string; source: string }
  | { kind: "update"; vaultPath: string; source?: string }
  | { kind: "install"; vaultPath: string; targetId?: string }
  | { kind: "import"; vaultPath: string }
  | { kind: "fork"; vaultPath: string; skill: string }
  | { kind: "editor"; vaultPath: string; skill: string }
  | { kind: "remove-source"; vaultPath: string; source: string }
  | { kind: "backups"; vaultPath: string; targetId?: string };

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface ToastItem {
  id: number;
  tone: "info" | "ok" | "warn" | "danger";
  message: string;
}
