import { useEffect, useState } from "react";
import type { NavigationIntent } from "../../app/routeDefinitions";
import type { ConnectionState, DiscoveryState, RefreshState } from "../../app/shellState";
import { BoardCell, Button, PageShell } from "../../components/ui";
import type { Locale, TranslateFunction } from "../../i18n";
import { formatNumber } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type { ServiceSummary } from "../../ipc/services";
import { StatusMark, type StatusTone } from "./StatusMark";
import {
  aiToolsSource,
  appConfigSource,
  environmentSource,
  freshnessLabel,
  installedAiToolNames,
  useFact,
  type EnvironmentFacts,
  type FactState,
  type Reading,
} from "./overviewFacts";
import type { AiConfigReport } from "../../ipc/aiConfig";
import { useServiceOverview } from "./useServiceOverview";

interface DashboardPageProps {
  connection?: ConnectionState;
  onNavigate?: (intent: NavigationIntent) => void;
  refresh?: RefreshState;
  state: DiscoveryState;
}

const DEFAULT_REFRESH: RefreshState = { status: "idle" };
const NOW_TICK_MS = 60_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Counts finished discovery refreshes so the fact cells can re-read what they already show. */
function useFinishedRefreshCount(status: RefreshState["status"]): number {
  const [seen, setSeen] = useState(status);
  const [finished, setFinished] = useState(0);
  if (seen !== status) {
    setSeen(status);
    if (seen === "refreshing" && status !== "refreshing") setFinished((count) => count + 1);
  }
  return finished;
}

function SystemStrip({ state }: { state: DiscoveryState }) {
  const t = useT();
  if (state.status === "loading") {
    return <p className="ov-strip ov-strip--muted">{t("dashboard.system.loading")}</p>;
  }
  const snapshot = state.status === "ready" ? state.snapshot : state.previousSnapshot;
  const system = snapshot?.system;
  if (!system || system.status !== "READY") {
    const message =
      system?.status === "ERROR"
        ? system.error.message
        : state.status === "error"
          ? state.error.message
          : t("dashboard.system.unavailable");
    return (
      <p className="ov-strip ov-strip--warning" role="alert">
        {t("dashboard.system.errorHint", { message })}
      </p>
    );
  }
  const data = system.data;
  const complete = data.completeness === "COMPLETE";
  const unavailable = t("dashboard.value.unavailable");
  return (
    <dl className="ov-strip" aria-label={t("dashboard.system.regionLabel")}>
      <div><dt>macOS</dt><dd>{data.osVersion ?? unavailable}</dd></div>
      <div><dt>{t("dashboard.system.architecture")}</dt><dd>{data.architecture ?? unavailable}</dd></div>
      <div><dt>{t("dashboard.system.loginShell")}</dt><dd>{data.shell ?? unavailable}</dd></div>
      <div>
        <dt>{t("dashboard.system.readState")}</dt>
        <dd>
          <span className="ov-strip__state">
            <StatusMark tone={complete ? "success" : "warning"} />
            <span>{complete ? t("dashboard.system.complete") : t("dashboard.system.partial")}</span>
          </span>
        </dd>
      </div>
    </dl>
  );
}

interface FactModel {
  description: string;
  figure: string;
  freshnessAt?: number;
  onRead?: () => void;
  readBusy?: boolean;
  readLabel?: string;
  status: { tone: StatusTone; label: string; busy?: boolean };
  target: NavigationIntent;
  title: string;
}

function FactCell({ model, now, onNavigate }: { model: FactModel; now: number; onNavigate: (intent: NavigationIntent) => void }) {
  const t = useT();
  return (
    <article className="ov-fact">
      <Button
        className="ov-fact__open"
        onClick={() => onNavigate(model.target)}
        variant="ghost"
      >
        <span className="ov-fact__head">
          <span className="ov-fact__title">{model.title}</span>
          <span className="ov-fact__fresh">{freshnessLabel(model.freshnessAt, now, t)}</span>
        </span>
        <span className="ov-fact__figure">{model.figure}</span>
        <span className="ov-fact__desc">{model.description}</span>
        <span className="ov-fact__status">
          <StatusMark busy={model.status.busy} tone={model.status.tone} />
          <span>{model.status.label}</span>
        </span>
      </Button>
      {model.onRead ? (
        <Button
          className="ov-fact__read"
          disabled={model.readBusy}
          onClick={model.onRead}
          size="sm"
          variant="secondary"
        >
          {model.readLabel}
        </Button>
      ) : null}
    </article>
  );
}

/** The last successful value, kept visible while a re-read is in flight or after it fails. */
function valueOf<T>(state: FactState<T>): Reading<T> | undefined {
  switch (state.status) {
    case "ready":
      return state.reading;
    case "reading":
    case "error":
      return state.previous;
    case "unread":
      return undefined;
  }
}

function readFailure(message: string, t: TranslateFunction): string {
  return t("dashboard.fact.readFailed", { message });
}

function readStatus<T>(
  state: FactState<T>,
  t: TranslateFunction,
  attention = false,
): FactModel["status"] {
  if (state.status === "reading") {
    return { tone: "neutral", label: t("dashboard.fact.reading"), busy: true };
  }
  if (state.status === "error") return { tone: "danger", label: t("dashboard.fact.failed") };
  if (state.status === "unread") return { tone: "neutral", label: t("dashboard.fact.unread") };
  return attention
    ? { tone: "warning", label: t("dashboard.fact.attention") }
    : { tone: "success", label: t("dashboard.fact.normal") };
}

function readButton<T>(
  state: FactState<T>,
  read: () => void,
  t: TranslateFunction,
): Pick<FactModel, "onRead" | "readBusy" | "readLabel"> {
  if (state.status === "ready") return {};
  if (state.status === "reading") {
    return { onRead: read, readBusy: true, readLabel: t("dashboard.fact.reading") };
  }
  if (state.status === "error") return { onRead: read, readLabel: t("common.retry") };
  return { onRead: read, readLabel: t("dashboard.fact.read") };
}

function aiNeedsAttention(report: AiConfigReport): boolean {
  return report.tools.some((tool) => tool.installStatus === "invalid");
}

function aiModel(
  state: FactState<AiConfigReport>,
  read: () => void,
  t: TranslateFunction,
  locale: Locale,
): FactModel {
  const value = valueOf(state);
  const names = value ? installedAiToolNames(value.value) : [];
  const description =
    value === undefined
      ? state.status === "error"
        ? readFailure(state.message, t)
        : t("dashboard.ai.unread")
      : names.length > 0
        ? t("dashboard.ai.installed", {
            names: names.join(t("dashboard.ai.separator")),
          })
        : t("dashboard.ai.none");
  return {
    ...readButton(state, read, t),
    description,
    figure: value
      ? `${formatNumber(names.length, locale)}/${formatNumber(value.value.tools.length, locale)}`
      : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state, t, value ? aiNeedsAttention(value.value) : false),
    target: { routeId: "aiConfig" },
    title: t("dashboard.fact.aiTools"),
  };
}

function environmentModel(
  state: FactState<EnvironmentFacts>,
  read: () => void,
  t: TranslateFunction,
  locale: Locale,
): FactModel {
  const value = valueOf(state);
  return {
    ...readButton(state, read, t),
    description: value
      ? t("dashboard.environment.summary", {
          zshFiles: formatNumber(value.value.zshFiles, locale),
          directories: formatNumber(value.value.dotenvDirectories, locale),
        })
      : state.status === "error"
        ? readFailure(state.message, t)
        : t("dashboard.environment.unread"),
    figure: value ? formatNumber(value.value.zshFiles, locale) : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state, t),
    target: { routeId: "environment" },
    title: t("dashboard.fact.environment"),
  };
}

function appConfigModel(
  state: FactState<number>,
  read: () => void,
  t: TranslateFunction,
  locale: Locale,
): FactModel {
  const value = valueOf(state);
  return {
    ...readButton(state, read, t),
    description: value
      ? t("dashboard.appConfig.summary")
      : state.status === "error"
        ? readFailure(state.message, t)
        : t("dashboard.appConfig.unread"),
    figure: value
      ? t("dashboard.appConfig.figure", { count: formatNumber(value.value, locale) })
      : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state, t),
    target: { routeId: "appConfig" },
    title: t("dashboard.fact.appConfig"),
  };
}

function serviceModel(
  overview: ReturnType<typeof useServiceOverview>,
  t: TranslateFunction,
  locale: Locale,
): FactModel {
  const target: NavigationIntent = { routeId: "services" };
  const title = t("dashboard.fact.services");
  if (overview.status === "loading") {
    return {
      description: t("dashboard.service.loading"),
      figure: "—",
      status: { tone: "neutral", label: t("dashboard.fact.reading"), busy: true },
      target,
      title,
    };
  }
  if (overview.status === "error") {
    return {
      description: readFailure(overview.error.message, t),
      figure: "—",
      status: { tone: "danger", label: t("dashboard.fact.failed") },
      target,
      title,
    };
  }
  const services: readonly ServiceSummary[] = overview.services;
  const running = services.filter((service) => service.state === "STARTED").length;
  const failed = services.some((service) => service.state === "ERROR");
  return {
    description: t("dashboard.service.summary", { running: formatNumber(running, locale) }),
    figure: formatNumber(services.length, locale),
    freshnessAt: overview.loadedAt,
    status: failed
      ? { tone: "warning", label: t("dashboard.fact.attention") }
      : { tone: "success", label: t("dashboard.fact.normal") },
    target,
    title,
  };
}

export function DashboardPage({
  connection,
  onNavigate = () => undefined,
  refresh = DEFAULT_REFRESH,
  state,
}: DashboardPageProps) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const finished = useFinishedRefreshCount(refresh.status);
  const refreshId = state.status === "ready" ? state.snapshot.refreshId : undefined;
  const services = useServiceOverview(refreshId);
  const ai = useFact(aiToolsSource, finished);
  const environment = useFact(environmentSource, finished);
  const appConfig = useFact(appConfigSource, finished);

  const models: { key: string; model: FactModel }[] = [
    { key: "services", model: serviceModel(services, t, locale) },
    { key: "aiTools", model: aiModel(ai.state, ai.read, t, locale) },
    {
      key: "environment",
      model: environmentModel(environment.state, environment.read, t, locale),
    },
    { key: "appConfig", model: appConfigModel(appConfig.state, appConfig.read, t, locale) },
  ];

  return (
    <section className="dashboard-workspace" aria-label={t("dashboard.regionLabel")}>
      <PageShell layout="board">
        <BoardCell span={12}>
          {connection?.status === "error" ? (
            <p className="ov-strip ov-strip--danger" role="alert">
              {t("dashboard.connection.errorHint", { message: connection.error.message })}
            </p>
          ) : null}
          <SystemStrip state={state} />
        </BoardCell>
        <BoardCell span={12}>
          <div className="ov-ledger">
            {models.map(({ key, model }) => (
              <FactCell key={key} model={model} now={now} onNavigate={onNavigate} />
            ))}
          </div>
        </BoardCell>
      </PageShell>
    </section>
  );
}
