import { localizeAppErrorMessage } from "../../i18n/errors";
import { translate, type Locale } from "../../i18n";
import type { AppError } from "../../ipc/core";
import type { FormattedXml } from "../../ipc/textTools";

export {
  MAX_INPUT_BYTES,
  createRequestTracker,
  exceedsInputLimit,
} from "./toolRequestState";

export type XmlView =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; output: FormattedXml }
  | { status: "error"; message: string; line?: number; column?: number };

export function successView(output: FormattedXml): XmlView {
  return { status: "success", output };
}

export function failureView(error: AppError, locale: Locale = "zh-CN"): XmlView {
  const { line, column } = error.details ?? {};
  if (typeof line === "number" && typeof column === "number") {
    return { status: "error", message: localizeAppErrorMessage(error, locale), line, column };
  }
  return { status: "error", message: localizeAppErrorMessage(error, locale) };
}

export function oversizedView(locale: Locale = "zh-CN"): XmlView {
  return { status: "error", message: translate(locale, "tools.input.oversized") };
}
