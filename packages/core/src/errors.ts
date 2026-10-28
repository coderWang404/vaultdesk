export type ErrorCode =
  | "vault-not-found"
  | "not-a-vault"
  | "unsupported-schema"
  | "not-writable-v1"
  | "read-only-preview"
  | "git-not-clean"
  | "git-failed"
  | "network"
  | "auth-failed"
  | "validation-failed"
  | "unknown-source"
  | "unknown-skill"
  | "unknown-target"
  | "unknown-plugin"
  | "unknown-tool"
  | "unknown-external"
  | "plugin-not-installable"
  | "not-a-plugin"
  | "source-not-found"
  | "upstream-not-found"
  | "path-escape"
  | "path-conflict"
  | "conflict"
  | "unsupported"
  | "subprocess-failed"
  | "operation-failed"
  | "invalid-input";

export class VaultDeskError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: 1 | 2 | 3;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options?: { details?: unknown; exitCode?: 1 | 2 | 3; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "VaultDeskError";
    this.code = code;
    this.details = options?.details;
    this.exitCode = options?.exitCode ?? defaultExitCode(code);
  }
}

export function defaultExitCode(code: ErrorCode): 1 | 2 | 3 {
  switch (code) {
    case "invalid-input":
    case "validation-failed":
    case "unsupported":
    case "unsupported-schema":
    case "not-a-vault":
    case "vault-not-found":
    case "unknown-source":
    case "unknown-skill":
    case "unknown-target":
    case "unknown-plugin":
    case "unknown-tool":
    case "unknown-external":
    case "plugin-not-installable":
    case "not-a-plugin":
      return 2;
    case "network":
    case "auth-failed":
      return 3;
    default:
      return 1;
  }
}

export function serializeError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof VaultDeskError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    return { code: "operation-failed", message: error.message };
  }
  return { code: "operation-failed", message: String(error) };
}
