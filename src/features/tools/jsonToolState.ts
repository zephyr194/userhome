import { localizeError } from "../../i18n/errors";
import { translate, type Locale } from "../../i18n";
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

export function failureView(error: AppError, locale: Locale = "zh-CN"): JsonView {
  const { line, column } = error.details ?? {};
  if (typeof line === "number" && typeof column === "number") {
    return { status: "error", message: localizeError(error, locale), line, column };
  }
  return { status: "error", message: localizeError(error, locale) };
}

export function oversizedView(locale: Locale = "zh-CN"): JsonView {
  return { status: "error", message: translate(locale, "tools.input.oversized") };
}
