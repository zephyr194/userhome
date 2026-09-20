import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

export type AppErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PROCESS_FAILED"
  | "PARTIAL_FAILURE"
  | "TIMEOUT"
  | "ELEVATION_REQUIRED"
  | "ELEVATION_UNAVAILABLE"
  | "INTERNAL";

export interface AppError {
  code: AppErrorCode;
  message: string;
  details?: Record<string, string | number | boolean>;
  retryable: boolean;
}

export interface AppStatus {
  status: "ok";
  version: string;
}

const APP_ERROR_CODES: readonly string[] = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "NOT_SUPPORTED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "CONFLICT",
  "PROCESS_FAILED",
  "PARTIAL_FAILURE",
  "TIMEOUT",
  "ELEVATION_REQUIRED",
  "ELEVATION_UNAVAILABLE",
  "INTERNAL",
];

export function createInternalError(): AppError {
  return {
    code: "INTERNAL",
    message: "An internal error occurred.",
    retryable: false,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeDetails(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const details: Array<[string, string | number | boolean]> = [];
  for (const [key, detail] of Object.entries(value)) {
    if (
      typeof detail !== "string" &&
      typeof detail !== "boolean" &&
      (typeof detail !== "number" || !Number.isFinite(detail))
    ) {
      return undefined;
    }
    details.push([key, detail]);
  }

  return Object.fromEntries(details);
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === "string" && APP_ERROR_CODES.includes(value);
}

export function decodeAppError(value: unknown): AppError {
  if (
    !isRecord(value) ||
    !isAppErrorCode(value.code) ||
    typeof value.message !== "string" ||
    typeof value.retryable !== "boolean"
  ) {
    return createInternalError();
  }

  const details = decodeDetails(value.details);
  if (value.details !== undefined && details === undefined) {
    return createInternalError();
  }

  return {
    code: value.code,
    message: value.message,
    ...(details === undefined ? {} : { details }),
    retryable: value.retryable,
  };
}

function decodeAppStatus(value: unknown): AppStatus {
  if (
    !isRecord(value) ||
    value.status !== "ok" ||
    typeof value.version !== "string"
  ) {
    throw createInternalError();
  }

  return {
    status: "ok",
    version: value.version,
  };
}

export async function invokeCommand<TResult>(
  command: string,
  decode: (value: unknown) => TResult,
  args?: InvokeArgs,
): Promise<TResult> {
  let response: unknown;
  try {
    response = await invoke<unknown>(command, args);
  } catch (error) {
    throw decodeAppError(error);
  }

  return decode(response);
}

export function getAppStatus(): Promise<AppStatus> {
  return invokeCommand("get_app_status", decodeAppStatus);
}
