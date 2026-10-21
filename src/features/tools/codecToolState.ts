import type { AppError } from "../../ipc/core";
import type {
  CodecAlgorithm,
  CodecDirection,
  TransformedText,
} from "../../ipc/textTools";
import type { SelectOption } from "../../components/ui";

const ALGORITHM_LABELS: Record<CodecAlgorithm, string> = {
  BASE64: "Base64（UTF-8）",
  URL_COMPONENT: "URL component",
  HTML_ENTITIES: "HTML 实体",
  UNICODE_ESCAPES: "Unicode 转义",
  UTF8_HEX: "UTF-8 Hex",
};

const DIRECTION_LABELS: Record<CodecDirection, string> = {
  ENCODE: "编码",
  DECODE: "解码",
};

const ALGORITHM_ORDER: readonly CodecAlgorithm[] = [
  "BASE64",
  "URL_COMPONENT",
  "HTML_ENTITIES",
  "UNICODE_ESCAPES",
  "UTF8_HEX",
];

const DIRECTION_ORDER: readonly CodecDirection[] = ["ENCODE", "DECODE"];

export const ALGORITHM_OPTIONS: readonly SelectOption<CodecAlgorithm>[] =
  ALGORITHM_ORDER.map((value) => ({ value, label: ALGORITHM_LABELS[value] }));

export const DIRECTION_OPTIONS: readonly SelectOption<CodecDirection>[] =
  DIRECTION_ORDER.map((value) => ({ value, label: DIRECTION_LABELS[value] }));

export type CodecView =
  | { status: "idle" }
  | { status: "pending" }
  | {
      status: "success";
      output: TransformedText;
      algorithm: CodecAlgorithm;
      direction: CodecDirection;
    }
  | { status: "error"; message: string };

export function conversionLabel(
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
): string {
  return `${ALGORITHM_LABELS[algorithm]} · ${DIRECTION_LABELS[direction]}`;
}

export function successView(
  output: TransformedText,
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
): CodecView {
  return { status: "success", output, algorithm, direction };
}

export function failureView(error: AppError): CodecView {
  return { status: "error", message: error.message };
}

export function oversizedView(): CodecView {
  return { status: "error", message: "输入超过 1 MiB 上限，未发送。" };
}
