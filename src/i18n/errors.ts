import { isAppErrorCode, type AppErrorCode } from "../ipc/core";
import { translate, type Locale, type MessageKey } from "./index";

const CODE_KEYS: Readonly<Record<AppErrorCode, MessageKey>> = {
  INVALID_INPUT: "error.code.INVALID_INPUT",
  NOT_FOUND: "error.code.NOT_FOUND",
  NOT_SUPPORTED: "error.code.NOT_SUPPORTED",
  PERMISSION_DENIED: "error.code.PERMISSION_DENIED",
  VALIDATION_FAILED: "error.code.VALIDATION_FAILED",
  CONFLICT: "error.code.CONFLICT",
  PROCESS_FAILED: "error.code.PROCESS_FAILED",
  PARTIAL_FAILURE: "error.code.PARTIAL_FAILURE",
  TIMEOUT: "error.code.TIMEOUT",
  INTERNAL: "error.code.INTERNAL",
};

/** Frontend-generated messages, keyed by the exact zh-CN text the decoder or form produces. */
const FRONTEND_MESSAGE_KEYS: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ["未知的应用配置条目。", "appConfig.error.unknownEntry"],
  ["预览已失效，请重新预览。", "appConfig.error.previewExpired"],
  ["没有需要保存的修改。", "appConfig.edit.noChanges"],
  ["请先修正标出的设置，再预览更改。", "appConfig.edit.fixFirst"],
]);

/**
 * zh-CN shows the backend text. English shows the message of an exact frontend match,
 * else the text of the known error code; anything else keeps the backend text.
 */
export function localizeError(
  error: { readonly code: string; readonly message: string },
  locale: Locale,
): string {
  if (locale === "zh-CN") return error.message;
  const key =
    FRONTEND_MESSAGE_KEYS.get(error.message) ??
    (isAppErrorCode(error.code) ? CODE_KEYS[error.code] : undefined);
  return key === undefined ? error.message : translate(locale, key);
}
