import type { Locale } from "./index";

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

export function formatDateTime(
  value: Date | number | string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = DATE_TIME_OPTIONS,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatByteSize(bytes: number, locale: Locale): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 1;
  const formatted = formatNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}
