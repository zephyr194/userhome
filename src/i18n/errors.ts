import type { AppError, AppErrorCode } from "../ipc/core";
import { translate, type Locale, type MessageKey } from "./index";

const APP_ERROR_MESSAGE_KEYS: Partial<Record<AppErrorCode, MessageKey>> = {
  INVALID_INPUT: "common.error.INVALID_INPUT",
  NOT_FOUND: "common.error.NOT_FOUND",
  NOT_SUPPORTED: "common.error.NOT_SUPPORTED",
  PERMISSION_DENIED: "common.error.PERMISSION_DENIED",
  VALIDATION_FAILED: "common.error.VALIDATION_FAILED",
  CONFLICT: "common.error.CONFLICT",
  PROCESS_FAILED: "common.error.PROCESS_FAILED",
  PARTIAL_FAILURE: "common.error.PARTIAL_FAILURE",
  TIMEOUT: "common.error.TIMEOUT",
  INTERNAL: "common.error.INTERNAL",
};

/** zh-CN keeps the backend sentence; English uses the mapped explanation when one exists. */
export function localizeAppErrorMessage(
  error: Pick<AppError, "code" | "message">,
  locale: Locale,
): string {
  const key = APP_ERROR_MESSAGE_KEYS[error.code];
  if (locale === "zh-CN" || key === undefined) return error.message;
  return translate(locale, key);
}
