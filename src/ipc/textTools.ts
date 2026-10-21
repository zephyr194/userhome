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
