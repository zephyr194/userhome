import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import { detectAiConfig, lastAiConfigReport, type AiConfigReport } from "../../ipc/aiConfig";
import { listAppConfigEntries } from "../../ipc/appConfig";
import { readZshStartupFiles } from "../../ipc/environment";
import { listGrants } from "../../ipc/grants";
import type { TranslateFunction } from "../../i18n";

export interface Reading<T> {
  value: T;
  readAt: number;
}

export interface EnvironmentFacts {
  zshFiles: number;
  dotenvDirectories: number;
}

export type FactState<T> =
  | { status: "unread" }
  | { status: "reading"; previous?: Reading<T> }
  | { status: "ready"; reading: Reading<T> }
  | { status: "error"; message: string; previous?: Reading<T> };

interface FactSource<T> {
  cached(): Reading<T> | undefined;
  load(): Promise<Reading<T>>;
}

let environmentReading: Reading<EnvironmentFacts> | undefined;
let appConfigReading: Reading<number> | undefined;
let aiObservedAt: number | undefined;

export const environmentSource: FactSource<EnvironmentFacts> = {
  cached: () => environmentReading,
  async load() {
    const [overview, grants] = await Promise.all([readZshStartupFiles(), listGrants()]);
    environmentReading = {
      value: {
        zshFiles: overview.files.filter((file) => file.outcome.status === "READY").length,
        dotenvDirectories: grants.filter(
          (grant) => grant.kind === "DIRECTORY" && grant.purpose !== "CADDY_WORK_DIR",
        ).length,
      },
      readAt: Date.now(),
    };
    return environmentReading;
  },
};

export const appConfigSource: FactSource<number> = {
  cached: () => appConfigReading,
  async load() {
    const items = await listAppConfigEntries();
    appConfigReading = { value: items.length, readAt: Date.now() };
    return appConfigReading;
  },
};

export const aiToolsSource: FactSource<AiConfigReport> = {
  cached() {
    const report = lastAiConfigReport();
    if (report === undefined) return undefined;
    aiObservedAt ??= Date.now();
    return { value: report, readAt: aiObservedAt };
  },
  async load() {
    const report = await detectAiConfig();
    aiObservedAt = Date.now();
    return { value: report, readAt: aiObservedAt };
  },
};

export function installedAiToolNames(report: AiConfigReport): string[] {
  return report.tools
    .filter((tool) => tool.installStatus === "found")
    .map((tool) => tool.displayName);
}

function initialFactState<T>(source: FactSource<T>): FactState<T> {
  const cached = source.cached();
  return cached === undefined ? { status: "unread" } : { status: "ready", reading: cached };
}

export function useFact<T>(source: FactSource<T>, refreshToken: number): {
  state: FactState<T>;
  read: () => void;
} {
  const [state, setState] = useState<FactState<T>>(() => initialFactState(source));
  const stateRef = useRef(state);
  const pending = useRef(false);

  const read = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    const current = stateRef.current;
    const previous = current.status === "ready" ? current.reading : current.status === "error" || current.status === "reading" ? current.previous : undefined;
    const next: FactState<T> = { status: "reading", previous };
    stateRef.current = next;
    setState(next);
    source.load().then(
      (reading) => {
        pending.current = false;
        stateRef.current = { status: "ready", reading };
        setState(stateRef.current);
      },
      (error: unknown) => {
        pending.current = false;
        stateRef.current = { status: "error", message: decodeAppError(error).message, previous };
        setState(stateRef.current);
      },
    );
  }, [source]);

  const previousToken = useRef(refreshToken);
  useEffect(() => {
    if (previousToken.current === refreshToken) return;
    previousToken.current = refreshToken;
    const status = stateRef.current.status;
    if (status === "ready" || status === "error") read();
  }, [refreshToken, read]);

  return { state, read };
}

export function clearOverviewFactCache(): void {
  environmentReading = undefined;
  appConfigReading = undefined;
  aiObservedAt = undefined;
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
