import type { AppError } from "../../ipc/core";
import type { FormattedJson, JsonFormatMode } from "../../ipc/textTools";

export const MAX_INPUT_BYTES = 1024 * 1024;

export type JsonView =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; output: FormattedJson; mode: JsonFormatMode }
  | { status: "error"; message: string; line?: number; column?: number };

export function exceedsInputLimit(text: string): boolean {
  return new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES;
}

/**
 * Issues request ids and reports whether a response still matches the latest
 * request. Invalidating (tool switch, clear, input edit) makes every in-flight
 * response stale so it can never be shown as the current result.
 */
export function createRequestTracker() {
  let latest = 0;
  return {
    issue(): number {
      latest += 1;
      return latest;
    },
    isCurrent(id: number): boolean {
      return id === latest;
    },
    invalidate(): void {
      latest += 1;
    },
  };
}

export function successView(
  output: FormattedJson,
  mode: JsonFormatMode,
): JsonView {
  return { status: "success", output, mode };
}

export function failureView(error: AppError): JsonView {
  const { line, column } = error.details ?? {};
  if (typeof line === "number" && typeof column === "number") {
    return { status: "error", message: error.message, line, column };
  }
  return { status: "error", message: error.message };
}

export function oversizedView(): JsonView {
  return { status: "error", message: "输入超过 1 MiB 上限，未发送。" };
}
