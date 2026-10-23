import { useEffect, useState } from "react";
import type { NavigationIntent } from "../../app/routeDefinitions";
import type { ConnectionState, DiscoveryState, RefreshState } from "../../app/shellState";
import { BoardCell, Button, PageShell } from "../../components/ui";
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
  if (state.status === "loading") {
    return <p className="ov-strip ov-strip--muted">正在读取本机信息。</p>;
  }
  const snapshot = state.status === "ready" ? state.snapshot : state.previousSnapshot;
  const system = snapshot?.system;
  if (!system || system.status !== "READY") {
    const message =
      system?.status === "ERROR"
        ? system.error.message
        : state.status === "error"
          ? state.error.message
          : "本机信息暂不可用。";
    return <p className="ov-strip ov-strip--warning" role="alert">{message}，可点击“刷新”重试。</p>;
  }
  const data = system.data;
  const complete = data.completeness === "COMPLETE";
  return (
    <dl className="ov-strip" aria-label="系统信息摘要">
      <div><dt>macOS</dt><dd>{data.osVersion ?? "不可用"}</dd></div>
      <div><dt>架构</dt><dd>{data.architecture ?? "不可用"}</dd></div>
      <div><dt>登录 Shell</dt><dd>{data.shell ?? "不可用"}</dd></div>
      <div>
        <dt>读取</dt>
        <dd>
          <span className="ov-strip__state">
            <StatusMark tone={complete ? "success" : "warning"} />
            <span>{complete ? "完整" : "部分可用"}</span>
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
  return (
    <article className="ov-fact">
      <Button
        className="ov-fact__open"
        onClick={() => onNavigate(model.target)}
        variant="ghost"
      >
        <span className="ov-fact__head">
          <span className="ov-fact__title">{model.title}</span>
          <span className="ov-fact__fresh">{freshnessLabel(model.freshnessAt, now)}</span>
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

function readFailure(message: string): string {
  return `读取失败：${message}。可点击“重试”再读一次。`;
}

function readStatus<T>(state: FactState<T>, attention = false): FactModel["status"] {
  if (state.status === "reading") return { tone: "neutral", label: "读取中…", busy: true };
  if (state.status === "error") return { tone: "danger", label: "读取失败" };
  if (state.status === "unread") return { tone: "neutral", label: "未读取" };
  return attention ? { tone: "warning", label: "需留意" } : { tone: "success", label: "正常" };
}

function readButton<T>(state: FactState<T>, read: () => void): Pick<FactModel, "onRead" | "readBusy" | "readLabel"> {
  if (state.status === "ready") return {};
  if (state.status === "reading") return { onRead: read, readBusy: true, readLabel: "读取中…" };
  if (state.status === "error") return { onRead: read, readLabel: "重试" };
  return { onRead: read, readLabel: "读取" };
}

function aiNeedsAttention(report: AiConfigReport): boolean {
  return report.tools.some((tool) => tool.installStatus === "invalid");
}

function aiModel(
  state: FactState<AiConfigReport>,
  read: () => void,
): FactModel {
  const value = valueOf(state);
  const names = value ? installedAiToolNames(value.value) : [];
  const description =
    value === undefined
      ? state.status === "error"
        ? readFailure(state.message)
        : "读取后显示本机已安装的 AI 工具。"
      : names.length > 0
        ? `已安装：${names.join("、")}`
        : "未发现已安装的 AI 工具。";
  return {
    ...readButton(state, read),
    description,
    figure: value ? `${names.length}/${value.value.tools.length}` : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state, value ? aiNeedsAttention(value.value) : false),
    target: { routeId: "aiConfig" },
    title: "AI 工具",
  };
}

function environmentModel(state: FactState<EnvironmentFacts>, read: () => void): FactModel {
  const value = valueOf(state);
  return {
    ...readButton(state, read),
    description: value
      ? `zsh 启动文件 ${value.value.zshFiles} 个 · 授权目录 ${value.value.dotenvDirectories} 个`
      : state.status === "error"
        ? readFailure(state.message)
        : "读取后显示 zsh 启动文件与授权目录。",
    figure: value ? String(value.value.zshFiles) : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state),
    target: { routeId: "environment" },
    title: "环境变量",
  };
}

function appConfigModel(state: FactState<number>, read: () => void): FactModel {
  const value = valueOf(state);
  return {
    ...readButton(state, read),
    description: value
      ? "已发现的应用配置条目数。"
      : state.status === "error"
        ? readFailure(state.message)
        : "读取后显示已发现的应用配置条目数。",
    figure: value ? String(value.value) : "—",
    freshnessAt: value?.readAt,
    status: readStatus(state),
    target: { routeId: "appConfig" },
    title: "应用配置",
  };
}

function serviceModel(
  overview: ReturnType<typeof useServiceOverview>,
): FactModel {
  const target: NavigationIntent = { routeId: "services" };
  if (overview.status === "loading") {
    return {
      description: "正在读取服务列表。",
      figure: "—",
      status: { tone: "neutral", label: "读取中…", busy: true },
      target,
      title: "服务",
    };
  }
  if (overview.status === "error") {
    return {
      description: readFailure(overview.error.message),
      figure: "—",
      status: { tone: "danger", label: "读取失败" },
      target,
      title: "服务",
    };
  }
  const services: readonly ServiceSummary[] = overview.services;
  const running = services.filter((service) => service.state === "STARTED").length;
  const failed = services.some((service) => service.state === "ERROR");
  return {
    description: `UserHome 管理的任务，运行中 ${running} 个`,
    figure: String(services.length),
    freshnessAt: overview.loadedAt,
    status: failed ? { tone: "warning", label: "需留意" } : { tone: "success", label: "正常" },
    target,
    title: "服务",
  };
}

export function DashboardPage({
  connection,
  onNavigate = () => undefined,
  refresh = DEFAULT_REFRESH,
  state,
}: DashboardPageProps) {
  const now = useNow();
  const finished = useFinishedRefreshCount(refresh.status);
  const refreshId = state.status === "ready" ? state.snapshot.refreshId : undefined;
  const services = useServiceOverview(refreshId);
  const ai = useFact(aiToolsSource, finished);
  const environment = useFact(environmentSource, finished);
  const appConfig = useFact(appConfigSource, finished);

  const models: { key: string; model: FactModel }[] = [
    { key: "services", model: serviceModel(services) },
    { key: "aiTools", model: aiModel(ai.state, ai.read) },
    { key: "environment", model: environmentModel(environment.state, environment.read) },
    { key: "appConfig", model: appConfigModel(appConfig.state, appConfig.read) },
  ];

  return (
    <section className="dashboard-workspace" aria-label="概览">
      <PageShell layout="board">
        <BoardCell span={12}>
          {connection?.status === "error" ? (
            <p className="ov-strip ov-strip--danger" role="alert">
              本地服务连接失败：{connection.error.message}，可点击“刷新”重试。
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
