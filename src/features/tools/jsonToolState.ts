import type { AppError } from "../../ipc/core";
import type { FormattedJson, JsonFormatMode } from "../../ipc/textTools";

export {
  MAX_INPUT_BYTES,
  createRequestTracker,
  exceedsInputLimit,
} from "./toolRequestState";

export type JsonView =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; output: FormattedJson; mode: JsonFormatMode }
  | { status: "error"; message: string; line?: number; column?: number };

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
