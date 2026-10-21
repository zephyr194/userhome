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

export function failureView(error: AppError): XmlView {
  const { line, column } = error.details ?? {};
  if (typeof line === "number" && typeof column === "number") {
    return { status: "error", message: error.message, line, column };
  }
  return { status: "error", message: error.message };
}

export function oversizedView(): XmlView {
  return { status: "error", message: "输入超过 1 MiB 上限，未发送。" };
}
