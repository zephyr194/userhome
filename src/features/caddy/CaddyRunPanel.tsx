import { useEffect, useRef, useState } from "react";
import { Button, LogViewer, Panel, StatusBadge } from "../../components/ui";
import {
  caddyLogs,
  caddyPrepareStart,
  caddyStart,
  caddyStatus,
  caddyStop,
  type CaddyConfigSource,
  type CaddyRunStatus,
  type CaddyStartSummary,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { createRequestTracker } from "./caddyPreviewFlow";
import {
  LOG_LINE_LIMIT,
  applyLogPage,
  canPrepare,
  canStop,
  initialLogView,
  presentRunState,
  type LogView,
} from "./caddyRunModel";

const STATUS_POLL_MS = 1000;
const LOG_POLL_MS = 1000;

const SOURCE_LABELS: Record<CaddyConfigSource, string> = {
  RULES: "表单规则（最近保存的生成文本）",
  RAW: "原文 Caddyfile（最近保存的原文）",
};

export interface CaddyRunViewProps {
  source: CaddyConfigSource;
  status?: CaddyRunStatus;
  summary?: CaddyStartSummary;
  busy: boolean;
  error?: AppError;
  logs: LogView;
  paused: boolean;
  onPrepare: () => void;
  onStart: () => void;
  onCancelSummary: () => void;
  onStop: () => void;
  onPauseChange: (paused: boolean) => void;
}

export function CaddyRunPanel({ source }: { source: CaddyConfigSource }) {
  const [statusTracker] = useState(createRequestTracker);
  const [previewTracker] = useState(createRequestTracker);
  const [status, setStatus] = useState<CaddyRunStatus | undefined>(undefined);
  const [summary, setSummary] = useState<CaddyStartSummary | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);
  const [logs, setLogs] = useState<LogView>(() => initialLogView(undefined));
  const [paused, setPaused] = useState(false);
  const logRef = useRef(logs);
  const sessionId = status?.sessionId;

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = () => {
      const id = statusTracker.issue();
      caddyStatus().then(
        (next) => {
          if (active && statusTracker.isCurrent(id)) setStatus(next);
        },
        (failure: AppError) => {
          if (active && statusTracker.isCurrent(id)) setError(failure);
        },
      ).finally(() => {
        if (active) timer = window.setTimeout(poll, STATUS_POLL_MS);
      });
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [statusTracker]);

  useEffect(() => {
    if (sessionId === undefined) return;
    let active = true;
    let timer: number | undefined;
    logRef.current = initialLogView(sessionId);
    const poll = () => {
      const cursor = logRef.current;
      caddyLogs(sessionId, cursor.stdoutOffset, cursor.stderrOffset).then(
        (page) => {
          if (!active || page.sessionId !== sessionId) return;
          logRef.current = applyLogPage(logRef.current, page);
          setLogs(logRef.current);
          timer = window.setTimeout(poll, page.hasMore ? 0 : LOG_POLL_MS);
        },
        () => {
          if (active) timer = window.setTimeout(poll, LOG_POLL_MS);
        },
      );
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  // A summary or log view belongs to one source or session; anything older is
  // hidden rather than cleared inside an effect.
  const visibleSummary = summary?.source === source ? summary : undefined;
  const visibleLogs = logs.sessionId === sessionId ? logs : initialLogView(sessionId);

  function prepare() {
    setBusy(true);
    setError(undefined);
    const id = previewTracker.issue();
    caddyPrepareStart(source).then(
      (next) => {
        if (previewTracker.isCurrent(id)) setSummary(next);
      },
      (failure: AppError) => {
        if (previewTracker.isCurrent(id)) setError(failure);
      },
    ).finally(() => setBusy(false));
  }

  function start() {
    const planId = visibleSummary?.planId;
    if (planId === undefined) return;
    setBusy(true);
    setError(undefined);
    previewTracker.invalidate();
    setSummary(undefined);
    const id = statusTracker.issue();
    caddyStart(planId, source).then(
      (next) => {
        if (statusTracker.isCurrent(id)) setStatus(next);
      },
      (failure: AppError) => {
        setError(failure);
      },
    ).finally(() => setBusy(false));
  }

  function stop() {
    setBusy(true);
    setError(undefined);
    const id = statusTracker.issue();
    caddyStop().then(
      (next) => {
        if (statusTracker.isCurrent(id)) setStatus(next);
      },
      (failure: AppError) => {
        setError(failure);
      },
    ).finally(() => setBusy(false));
  }

  function cancelSummary() {
    previewTracker.invalidate();
    setSummary(undefined);
  }

  return (
    <CaddyRunView
      source={source}
      status={status}
      summary={visibleSummary}
      busy={busy}
      error={error}
      logs={visibleLogs}
      paused={paused}
      onPrepare={prepare}
      onStart={start}
      onCancelSummary={cancelSummary}
      onStop={stop}
      onPauseChange={setPaused}
    />
  );
}

export function CaddyRunView({
  source,
  status,
  summary,
  busy,
  error,
  logs,
  paused,
  onPrepare,
  onStart,
  onCancelSummary,
  onStop,
  onPauseChange,
}: CaddyRunViewProps) {
  const state = status?.state;
  const previewEnabled = state !== undefined && canPrepare(state) && !busy;
  const stopEnabled = state !== undefined && canStop(state) && !busy;
  const presentation = state === undefined ? undefined : presentRunState(state);

  return (
    <Panel aria-labelledby="caddy-run-heading" className="grid min-w-0 gap-ui-md p-ui-lg">
      <div className="flex flex-wrap items-center justify-between gap-ui-sm">
        <h2 id="caddy-run-heading" className="text-sm font-semibold">
          运行（自有实例）
        </h2>
        {presentation !== undefined ? (
          <StatusBadge tone={presentation.tone}>
            {`${presentation.symbol} ${presentation.label}`}
          </StatusBadge>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="m-0 text-body text-muted-foreground">
        {status === undefined ? "正在读取运行状态……" : status.message}
      </p>
      <p className="m-0 text-aux text-muted-foreground">
        {`当前来源：${SOURCE_LABELS[source]}。修改已保存的配置不会影响正在运行的实例。`}
      </p>
      {error !== undefined ? (
        <p role="alert" className="m-0 text-body text-danger">
          {error.message}
        </p>
      ) : null}
      {status?.state === "FAILED" ? <FailureBlock status={status} /> : null}
      {summary !== undefined ? (
        <SummaryBlock
          summary={summary}
          busy={busy}
          onStart={onStart}
          onCancel={onCancelSummary}
        />
      ) : null}
      <div className="flex flex-wrap gap-ui-sm">
        <Button variant="secondary" disabled={!previewEnabled} onClick={onPrepare}>
          开启前预览
        </Button>
        <Button variant="danger" disabled={!stopEnabled} onClick={onStop}>
          关闭
        </Button>
      </div>
      <LogViewer
        label="Caddy 日志"
        emptyText="暂无日志"
        lines={logs.lines}
        droppedCount={logs.dropped}
        maxLines={LOG_LINE_LIMIT}
        paused={paused}
        onPauseChange={onPauseChange}
      />
    </Panel>
  );
}

function FailureBlock({ status }: { status: CaddyRunStatus }) {
  return (
    <div role="alert" className="grid gap-ui-xs rounded-panel border border-danger p-ui-md">
      <p className="m-0 text-body font-semibold text-danger">{status.message}</p>
      {status.diagnostics.length > 0 ? (
        <ul className="m-0 grid gap-ui-xxs pl-ui-lg text-body">
          {status.diagnostics.map((diagnostic, index) => (
            <li key={`${index}-${diagnostic.message}`}>
              {diagnostic.line !== undefined
                ? `第 ${diagnostic.line} 行：${diagnostic.message}`
                : diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        未自动重试。修正后可重新预览并开启。
      </p>
    </div>
  );
}

function SummaryBlock({
  summary,
  busy,
  onStart,
  onCancel,
}: {
  summary: CaddyStartSummary;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const listen = summary.listen.length > 0 ? summary.listen.join("、") : emptyAddressText(summary);
  const upstreams =
    summary.upstreams.length > 0 ? summary.upstreams.join("、") : emptyAddressText(summary);
  return (
    <section aria-label="开启前摘要" className="grid gap-ui-sm rounded-panel border border-control-border p-ui-md">
      <h3 className="m-0 text-sm font-semibold">开启前摘要</h3>
      {summary.blocked !== undefined ? (
        <p role="alert" className="m-0 text-body text-danger">
          {`无法开启：${summary.blocked}`}
        </p>
      ) : null}
      <dl className="m-0 grid gap-ui-xs text-body">
        <SummaryRow label="配置来源" value={SOURCE_LABELS[summary.source]} />
        <SummaryRow
          label="可执行文件"
          value={
            summary.executablePath !== undefined
              ? `${summary.executablePath}${summary.version !== undefined ? `（${summary.version}）` : ""}`
              : "未找到"
          }
        />
        <SummaryRow label="运行目录" value={summary.workingDirectory} />
        <SummaryRow label="配置指纹" value={summary.configFingerprint} />
        <SummaryRow label="监听" value={listen} />
        <SummaryRow label="上游" value={upstreams} />
        <SummaryRow label="管理端点" value={summary.adminEndpoint} />
      </dl>
      <ul className="m-0 grid gap-ui-xxs pl-ui-lg text-aux text-muted-foreground">
        {summary.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {summary.blocked === undefined ? (
        <div className="flex flex-wrap gap-ui-sm">
          <Button variant="primary" disabled={busy} onClick={onStart}>
            确认开启
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            取消
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function emptyAddressText(summary: CaddyStartSummary): string {
  return summary.source === "RAW" ? "以原文为准" : "无启用的站点";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-ui-xxs sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-ui-sm">
      <dt className="m-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-all">{value}</dd>
    </div>
  );
}
