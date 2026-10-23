import { dataHub, type HubSourceId, type HubState, type Reading } from "../../app/dataHub";
import type { AppError } from "../../ipc/core";
import type { AiConfigReport } from "../../ipc/aiConfig";
import type { TranslateFunction } from "../../i18n";

export interface EnvironmentFacts {
  zshFiles: number;
  dotenvDirectories: number;
}

export const OVERVIEW_SOURCE_IDS: readonly HubSourceId[] = [
  "appConfig",
  "zshStartup",
  "authorizedDirectories",
  "aiTools",
];

export function readingOf<T>(state: HubState<T>): Reading<T> | undefined {
  switch (state.status) {
    case "ready":
      return state.reading;
    case "loading":
    case "error":
      return state.previous;
    case "empty":
      return undefined;
  }
}

function errorOf<T>(state: HubState<T>): AppError | undefined {
  return state.status === "error" ? state.error : undefined;
}

export function combineEnvironment(
  zsh: HubState<number>,
  directories: HubState<number>,
): HubState<EnvironmentFacts> {
  const zshReading = readingOf(zsh);
  const directoryReading = readingOf(directories);
  const previous: Reading<EnvironmentFacts> | undefined =
    zshReading !== undefined && directoryReading !== undefined
      ? {
          value: { zshFiles: zshReading.value, dotenvDirectories: directoryReading.value },
          readAt: Math.min(zshReading.readAt, directoryReading.readAt),
        }
      : undefined;
  const error = errorOf(zsh) ?? errorOf(directories);
  if (error !== undefined) return { status: "error", error, previous };
  if (zsh.status === "empty" && directories.status === "empty") return { status: "empty" };
  if (zsh.status === "ready" && directories.status === "ready" && previous !== undefined) {
    return { status: "ready", reading: previous };
  }
  return { status: "loading", previous };
}

export function installedAiToolNames(report: AiConfigReport): string[] {
  return report.tools
    .filter((tool) => tool.installStatus === "found")
    .map((tool) => tool.displayName);
}

export function clearOverviewFactCache(): void {
  dataHub.clear();
}

export function freshnessLabel(
  readAt: number | undefined,
  now: number,
  t: TranslateFunction,
): string {
  if (readAt === undefined) return t("dashboard.freshness.unread");
  const minutes = Math.floor((now - readAt) / 60_000);
  return minutes < 1
    ? t("dashboard.freshness.justNow")
    : t("dashboard.freshness.minutesAgo", { count: minutes });
}
