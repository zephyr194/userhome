import { createInternalError, hasControlCharacters } from "./core";

export interface ConfigDiffLine {
  kind: "REMOVED" | "ADDED";
  text: string;
}

export interface ConfigDiff {
  lines: ConfigDiffLine[];
  redacted: boolean;
  truncated: boolean;
}

export function decodeSafeDisplayPath(value: unknown): string {
  const prefix =
    typeof value === "string"
      ? [
          "~/",
          "XDG_CONFIG_HOME/",
          "APPLICATION_SUPPORT/",
          "HOMEBREW_PREFIX/",
          "APP_SUPPORT/",
        ].find((candidate) => value.startsWith(candidate))
      : undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    !prefix
  ) {
    throw createInternalError();
  }
  const segments = value.slice(prefix.length).split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw createInternalError();
  }
  return value;
}
