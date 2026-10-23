import type { AppError } from "../../ipc/core";
import type {
  CodecAlgorithm,
  CodecDirection,
  TransformedText,
} from "../../ipc/textTools";
import type { SelectOption } from "../../components/ui";
import { translate, type Locale, type MessageKey } from "../../i18n";
import { localizeError } from "../../i18n/errors";

const ALGORITHM_LABEL_KEYS: Record<CodecAlgorithm, MessageKey> = {
  BASE64: "tools.codec.algorithm.base64",
  BASE64_URL_SAFE: "tools.codec.algorithm.base64UrlSafe",
  URL_COMPONENT: "tools.codec.algorithm.urlComponent",
  HTML_ENTITIES: "tools.codec.algorithm.htmlEntities",
  UNICODE_ESCAPES: "tools.codec.algorithm.unicodeEscapes",
  UTF8_HEX: "tools.codec.algorithm.utf8Hex",
};

const ALGORITHM_NOTE_KEYS: Partial<Record<CodecAlgorithm, MessageKey>> = {
  BASE64_URL_SAFE: "tools.codec.note.base64UrlSafe",
};

const DIRECTION_LABEL_KEYS: Record<CodecDirection, MessageKey> = {
  ENCODE: "tools.codec.direction.encode",
  DECODE: "tools.codec.direction.decode",
};

const NOTICE_KEYS: Readonly<Record<string, MessageKey>> = {
  "未识别的实体已保留。": "tools.codec.notice.unknownEntities",
};

const ALGORITHM_ORDER: readonly CodecAlgorithm[] = [
  "BASE64",
  "BASE64_URL_SAFE",
  "URL_COMPONENT",
  "HTML_ENTITIES",
  "UNICODE_ESCAPES",
  "UTF8_HEX",
];

const DIRECTION_ORDER: readonly CodecDirection[] = ["ENCODE", "DECODE"];

export function algorithmOptions(
  locale: Locale = "zh-CN",
): readonly SelectOption<CodecAlgorithm>[] {
  return ALGORITHM_ORDER.map((value) => ({
    value,
    label: translate(locale, ALGORITHM_LABEL_KEYS[value]),
  }));
}

export function directionOptions(
  locale: Locale = "zh-CN",
): readonly SelectOption<CodecDirection>[] {
  return DIRECTION_ORDER.map((value) => ({
    value,
    label: translate(locale, DIRECTION_LABEL_KEYS[value]),
  }));
}

export function algorithmNote(
  algorithm: CodecAlgorithm,
  locale: Locale = "zh-CN",
): string | undefined {
  const key = ALGORITHM_NOTE_KEYS[algorithm];
  return key === undefined ? undefined : translate(locale, key);
}

export function conversionLabel(
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
  locale: Locale = "zh-CN",
): string {
  return translate(locale, "tools.codec.conversion", {
    algorithm: translate(locale, ALGORITHM_LABEL_KEYS[algorithm]),
    direction: translate(locale, DIRECTION_LABEL_KEYS[direction]),
  });
}

/** Known backend notices are matched by their zh-CN text and shown in the active language. */
export function noticeText(notice: string, locale: Locale = "zh-CN"): string {
  const key = NOTICE_KEYS[notice];
  return key === undefined ? notice : translate(locale, key);
}

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

export function successView(
  output: TransformedText,
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
): CodecView {
  return { status: "success", output, algorithm, direction };
}

export function failureView(error: AppError, locale: Locale = "zh-CN"): CodecView {
  return { status: "error", message: localizeError(error, locale) };
}

export function oversizedView(locale: Locale = "zh-CN"): CodecView {
  return { status: "error", message: translate(locale, "tools.input.oversized") };
}
