import type { AppError, AppErrorCode } from "../ipc/core";
import { translate, type Locale, type MessageKey, type TranslateFunction } from "./index";

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

export interface LocalizableError {
  code: string;
  message: string;
}

/** Frontend-generated error text, keyed by the exact zh-CN message the decoder or form produces. */
const ERROR_MESSAGE_KEYS: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ["未知的应用配置条目。", "appConfig.error.unknownEntry"],
  ["预览已失效，请重新预览。", "appConfig.error.previewExpired"],
  ["没有需要保存的修改。", "appConfig.edit.noChanges"],
  ["请先修正标出的设置，再预览更改。", "appConfig.edit.fixFirst"],
]);

export function localizeErrorMessage(
  error: LocalizableError,
  t: TranslateFunction,
): string {
  const key = ERROR_MESSAGE_KEYS.get(error.message);
  return key ? t(key) : error.message;
}

const SERVICE_ERROR_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {};

/** Backend messages stay in their original text unless a known code has a translation. */
export function localizedErrorMessage(
  error: { readonly code: string; readonly message: string },
  t: TranslateFunction,
): string {
  const key = SERVICE_ERROR_MESSAGE_KEYS[error.code];
  return key === undefined ? error.message : t(key);
}
