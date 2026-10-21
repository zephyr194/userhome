import { createInternalError, invokeCommand, isRecord } from "./core";

export type JsonFormatMode = "INDENT2" | "INDENT4" | "MINIFY";

export interface JsonWarning {
  key: string;
  line: number;
  column: number;
}

export interface FormattedJson {
  text: string;
  warnings: JsonWarning[];
  omittedWarnings: number;
}

const MAX_WARNINGS = 100;
const MAX_WARNING_KEY_CHARS = 65;

function decodePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw createInternalError();
  }
  return value;
}

function decodeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createInternalError();
  }
  return value;
}

export function decodeJsonWarning(value: unknown): JsonWarning {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    Array.from(value.key).length > MAX_WARNING_KEY_CHARS
  ) {
    throw createInternalError();
  }
  return {
    key: value.key,
    line: decodePositiveInteger(value.line),
    column: decodePositiveInteger(value.column),
  };
}

export function decodeFormattedJson(value: unknown): FormattedJson {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > MAX_WARNINGS
  ) {
    throw createInternalError();
  }
  return {
    text: value.text,
    warnings: value.warnings.map(decodeJsonWarning),
    omittedWarnings: decodeNonNegativeInteger(value.omittedWarnings),
  };
}

export function formatJsonArgs(
  text: string,
  mode: JsonFormatMode,
): { input: { text: string; mode: JsonFormatMode } } {
  return { input: { text, mode } };
}

export function formatJson(
  text: string,
  mode: JsonFormatMode,
): Promise<FormattedJson> {
  return invokeCommand(
    "format_json",
    decodeFormattedJson,
    formatJsonArgs(text, mode),
  );
}

export type XmlFormatMode = "INDENT2" | "INDENT4";

export interface FormattedXml {
  text: string;
}

export function decodeFormattedXml(value: unknown): FormattedXml {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw createInternalError();
  }
  return { text: value.text };
}

export function formatXmlArgs(
  text: string,
  mode: XmlFormatMode,
): { input: { text: string; mode: XmlFormatMode } } {
  return { input: { text, mode } };
}

export function formatXml(
  text: string,
  mode: XmlFormatMode,
): Promise<FormattedXml> {
  return invokeCommand("format_xml", decodeFormattedXml, formatXmlArgs(text, mode));
}

export type CodecAlgorithm =
  | "BASE64"
  | "BASE64_URL_SAFE"
  | "URL_COMPONENT"
  | "HTML_ENTITIES"
  | "UNICODE_ESCAPES"
  | "UTF8_HEX";

export type CodecDirection = "ENCODE" | "DECODE";

export interface TransformedText {
  text: string;
  notices: string[];
}

const MAX_NOTICES = 4;
const KNOWN_NOTICES: readonly string[] = ["未识别的实体已保留。"];

function decodeNotice(value: unknown): string {
  if (typeof value !== "string" || !KNOWN_NOTICES.includes(value)) {
    throw createInternalError();
  }
  return value;
}

export function decodeTransformedText(value: unknown): TransformedText {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    !Array.isArray(value.notices) ||
    value.notices.length > MAX_NOTICES
  ) {
    throw createInternalError();
  }
  return {
    text: value.text,
    notices: value.notices.map(decodeNotice),
  };
}

export function transformTextArgs(
  text: string,
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
): {
  input: { text: string; algorithm: CodecAlgorithm; direction: CodecDirection };
} {
  return { input: { text, algorithm, direction } };
}

export function transformText(
  text: string,
  algorithm: CodecAlgorithm,
  direction: CodecDirection,
): Promise<TransformedText> {
  return invokeCommand(
    "transform_text",
    decodeTransformedText,
    transformTextArgs(text, algorithm, direction),
  );
}
