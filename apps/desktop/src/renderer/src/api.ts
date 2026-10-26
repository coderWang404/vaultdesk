import type { IpcCommand, IpcPayload } from "@vaultdesk/schema";

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export async function call<T = unknown, K extends IpcCommand = IpcCommand>(
  command: K,
  payload: IpcPayload<K>,
): Promise<T> {
  const response = await window.vaultdesk.invoke(command, payload);
  if (!response.ok) {
    throw new ApiError(response.error.code, response.error.message, response.error.details);
  }
  return response.data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
