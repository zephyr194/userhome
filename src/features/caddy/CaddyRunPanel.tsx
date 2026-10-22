import { useEffect, useRef, useState } from "react";
import { Button, CheckboxField, LogViewer, Panel, StatusBadge } from "../../components/ui";
import {
  caddyApply,
  caddyLogs,
  caddyPrepareStart,
  caddyStart,
  caddyStatus,
  caddyStop,
  type CaddyApplyReport,
  type CaddyConfigSource,
  type CaddyConflictReport,
  type CaddyRunStatus,
  type CaddyStartSummary,
  type CaddyStatus,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { createRequestTracker } from "./caddyPreviewFlow";
import {
  DOMAIN_LABELS,
  PORT_STATE_LABELS,
  RUN_STATE_LABELS,
  SNAPSHOT_LABELS,
  UPSTREAM_STATE_LABELS,
  externalServiceTargets,
  presentVerdict,
  startGate,
  type ServiceTarget,
} from "./caddyConflictModel";
import {
  LOG_LINE_LIMIT,
  applyFailureLabel,
  applyLogPage,
  canApply,
  canPrepare,
  canStop,
  initialLogView,
  presentApplied,
  presentRunState,
  reviewLines,
  visibleApplyResult,
  type LogView,
} from "./caddyRunModel";

const STATUS_POLL_MS = 1000;
const LOG_POLL_MS = 1000;

const SOURCE_LABELS: Record<CaddyConfigSource, string> = {
  RULES: "表单规则（最近保存的生成文本）",
  RAW: "原文 Caddyfile（最近保存的原文）",
};

// The start and stop responses carry only the run facts; the poll adds the apply facts.
type PanelStatus = CaddyRunStatus & Partial<Omit<CaddyStatus, keyof CaddyRunStatus>>;

export interface CaddyRunViewProps {
  source: CaddyConfigSource;
  status?: PanelStatus;
  summary?: CaddyStartSummary;
  busy: boolean;
  error?: AppError;
  logs: LogView;
  paused: boolean;
  applying?: boolean;
  applyResult?: CaddyApplyReport;
  confirmingApply?: boolean;
  onPrepare: () => void;
  onStart: (options: { acceptUnconfirmed: boolean }) => void;
  onCancelSummary: () => void;
  onStop: () => void;
  onPauseChange: (paused: boolean) => void;
  onApply?: () => void;
  onConfirmApply?: () => void;
  onCancelApply?: () => void;
  onOpenService?: (target: ServiceTarget) => void;
  workdirReason?: string;
}

export function CaddyRunPanel({
  source,
  onOpenService,
  workdirReason,
}: {
  source: CaddyConfigSource;
  onOpenService?: (target: ServiceTarget) => void;
  workdirReason?: string;
}) {
  const [statusTracker] = useState(createRequestTracker);
  const [previewTracker] = useState(createRequestTracker);
  const [applyTracker] = useState(createRequestTracker);
  const [status, setStatus] = useState<PanelStatus | undefined>(undefined);
  const [summary, setSummary] = useState<CaddyStartSummary | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [applyResult, setApplyResult] = useState<CaddyApplyReport | undefined>(undefined);
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

  function start(options: { acceptUnconfirmed: boolean }) {
    const planId = visibleSummary?.planId;
    if (planId === undefined) return;
    setBusy(true);
    setError(undefined);
    previewTracker.invalidate();
    setSummary(undefined);
    const id = statusTracker.issue();
    caddyStart(planId, source, options).then(
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

  // Reloads the own instance only after the user confirmed; the response is
  // shown only while its session is still the one on screen.
  function apply() {
    if (sessionId === undefined) return;
    setConfirmingApply(false);
    setApplying(true);
    setError(undefined);
    const id = applyTracker.issue();
    caddyApply(sessionId, source).then(
      (report) => {
        if (applyTracker.isCurrent(id)) setApplyResult(report);
      },
      (failure: AppError) => {
        if (applyTracker.isCurrent(id)) setError(failure);
      },
    ).finally(() => setApplying(false));
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
      applying={applying}
      applyResult={visibleApplyResult(applyResult, sessionId) ?? status?.lastApply}
      confirmingApply={confirmingApply}
      onPrepare={prepare}
      onStart={start}
      onCancelSummary={cancelSummary}
      onStop={stop}
      onPauseChange={setPaused}
      onApply={() => setConfirmingApply(true)}
      onConfirmApply={apply}
      onCancelApply={() => setConfirmingApply(false)}
      onOpenService={onOpenService}
      workdirReason={workdirReason}
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
  applying = false,
  applyResult,
  confirmingApply = false,
  onPrepare,
  onStart,
  onCancelSummary,
  onStop,
  onPauseChange,
  onApply,
  onConfirmApply,
  onCancelApply,
  onOpenService,
  workdirReason,
}: CaddyRunViewProps) {
  const state = status?.state;
  const applied = status?.applied;
  const previewEnabled = state !== undefined && canPrepare(state) && !busy && workdirReason === undefined;
  const stopEnabled = state !== undefined && canStop(state) && !busy;
  const applyBlocked = busy || applying || status?.applying === true;
  const applyEnabled =
    state !== undefined &&
    canApply(state, applied, applyBlocked) &&
    !confirmingApply &&
    workdirReason === undefined;
  const confirmVisible =
    confirmingApply && state !== undefined && canApply(state, applied, applyBlocked);
  const presentation = state === undefined ? undefined : presentRunState(state);
  const appliedPresentation =
    state === "RUNNING" && applied !== undefined ? presentApplied(applied) : undefined;

  return (
    <Panel aria-labelledby="caddy-run-heading" className="grid min-w-0 gap-ui-8 p-ui-8">
      <div className="flex flex-wrap items-center justify-between gap-ui-8">
        <h2 id="caddy-run-heading" className="text-sm font-semibold">
          运行（自有实例）
        </h2>
        <div className="flex flex-wrap gap-ui-4">
          {presentation !== undefined ? (
            <StatusBadge tone={presentation.tone}>
              {`${presentation.symbol} ${presentation.label}`}
            </StatusBadge>
          ) : null}
          {appliedPresentation !== undefined ? (
            <StatusBadge tone={appliedPresentation.tone}>
              {`${appliedPresentation.symbol} ${appliedPresentation.label}`}
            </StatusBadge>
          ) : null}
        </div>
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
          key={summary.planId ?? "blocked"}
          summary={summary}
          busy={busy || workdirReason !== undefined}
          onStart={onStart}
          onCancel={onCancelSummary}
          onOpenService={onOpenService}
        />
      ) : null}
      {workdirReason !== undefined ? (
        <p className="m-0 text-aux text-muted-foreground">
          {workdirReason}后才能开启或应用配置。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-ui-8">
        <Button variant="secondary" disabled={!previewEnabled} onClick={onPrepare}>
          开启前预览
        </Button>
        {onApply !== undefined ? (
          <Button variant="primary" disabled={!applyEnabled} onClick={onApply}>
            应用到运行中的实例
          </Button>
        ) : null}
        <Button variant="danger" disabled={!stopEnabled} onClick={onStop}>
          关闭
        </Button>
      </div>
      {onApply !== undefined ? (
        <p className="m-0 text-aux text-muted-foreground">
          保存不会启动或重载；只有点击“应用到运行中的实例”并确认后，才会重载自有实例。
        </p>
      ) : null}
      {applying || status?.applying === true ? (
        <p aria-live="polite" className="m-0 text-body">
          正在应用：重载自有实例，结果以复核为准……
        </p>
      ) : null}
      {confirmVisible ? (
        <ApplyConfirm busy={applyBlocked} onConfirm={onConfirmApply} onCancel={onCancelApply} />
      ) : null}
      {applyResult !== undefined ? <ApplyResultBlock report={applyResult} /> : null}
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

function ApplyConfirm({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <section
      aria-label="应用确认"
      className="grid gap-ui-8 rounded-panel border border-warning p-ui-8"
    >
      <p className="m-0 text-body font-semibold">确认应用到运行中的实例？</p>
      <p className="m-0 text-body">
        将重载自有实例（仅通过本次运行的私有管理端点）。失败时旧配置可能仍在运行，且不会自动重试。
      </p>
      <div className="flex flex-wrap gap-ui-8">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          确认应用
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </section>
  );
}

function ApplyResultBlock({ report }: { report: CaddyApplyReport }) {
  const failed = report.outcome === "FAILED";
  const headline = failed
    ? `应用未成功：${report.failure !== undefined ? applyFailureLabel(report.failure) : "原因未知"}`
    : "应用成功（已复核）";
  return (
    <section
      aria-label="应用结果"
      role={failed ? "alert" : undefined}
      className={`grid gap-ui-4 rounded-panel border p-ui-8 ${failed ? "border-danger" : "border-control-border"}`}
    >
      <p className={`m-0 text-body font-semibold ${failed ? "text-danger" : ""}`}>
        {`${failed ? "▲" : "●"} ${headline}`}
      </p>
      <p className="m-0 text-body">{report.message}</p>
      {report.review !== undefined ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {reviewLines(report.review).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {report.diagnostics.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {report.diagnostics.map((diagnostic, index) => (
            <li key={`${index}-${diagnostic.message}`}>{diagnostic.message}</li>
          ))}
        </ul>
      ) : null}
      {failed ? <p className="m-0 text-aux text-muted-foreground">未自动重试。</p> : null}
    </section>
  );
}

function FailureBlock({ status }: { status: CaddyRunStatus }) {
  return (
    <div role="alert" className="grid gap-ui-4 rounded-panel border border-danger p-ui-8">
      <p className="m-0 text-body font-semibold text-danger">{status.message}</p>
      {status.diagnostics.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
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
  onOpenService,
}: {
  summary: CaddyStartSummary;
  busy: boolean;
  onStart: (options: { acceptUnconfirmed: boolean }) => void;
  onCancel: () => void;
  onOpenService?: (target: ServiceTarget) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const listen = summary.listen.length > 0 ? summary.listen.join("、") : emptyAddressText(summary);
  const upstreams =
    summary.upstreams.length > 0 ? summary.upstreams.join("、") : emptyAddressText(summary);
  const conflicts = summary.conflicts;
  const gate = startGate(summary, accepted);
  return (
    <section aria-label="开启前摘要" className="grid gap-ui-8 rounded-panel border border-control-border p-ui-8">
      <h3 className="m-0 text-sm font-semibold">开启前摘要</h3>
      {summary.blocked !== undefined ? (
        <p role="alert" className="m-0 text-body text-danger">
          {`无法开启：${summary.blocked}`}
        </p>
      ) : null}
      <dl className="m-0 grid gap-ui-4 text-body">
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
      {conflicts !== undefined ? (
        <ConflictBlock conflicts={conflicts} onOpenService={onOpenService} />
      ) : null}
      <ul className="m-0 grid gap-ui-2 pl-ui-8 text-aux text-muted-foreground">
        {summary.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {summary.blocked === undefined ? (
        <div className="grid gap-ui-8">
          {conflicts?.verdict === "UNCONFIRMED" ? (
            <CheckboxField
              label="我已确认外部 Caddy 与端口状态，仍要开启"
              description="不会停止、重载或接管外部实例。"
              checked={accepted}
              disabled={busy}
              onCheckedChange={setAccepted}
            />
          ) : null}
          <div className="flex flex-wrap gap-ui-8">
            <Button
              variant="primary"
              disabled={busy || !gate.canStart}
              onClick={() => onStart({ acceptUnconfirmed: gate.acceptUnconfirmed })}
            >
              确认开启
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConflictBlock({
  conflicts,
  onOpenService,
}: {
  conflicts: CaddyConflictReport;
  onOpenService?: (target: ServiceTarget) => void;
}) {
  const verdict = presentVerdict(conflicts.verdict);
  const targets = externalServiceTargets(conflicts);
  return (
    <section aria-label="冲突检查" className="grid gap-ui-4 rounded-panel border border-control-border p-ui-8">
      <p className="m-0 text-body font-semibold">{`${verdict.symbol} ${verdict.label}`}</p>
      <p className="m-0 text-body">{conflicts.headline}</p>
      <h4 className="m-0 text-sm font-semibold">外部 Caddy 归属</h4>
      <p className="m-0 text-aux text-muted-foreground">
        {`${SNAPSHOT_LABELS[conflicts.external.snapshot]}：${conflicts.external.explanation}`}
      </p>
      {conflicts.external.instances.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {conflicts.external.instances.map((instance) => (
            <li key={`${instance.domain}/${instance.label}`}>
              {`${instance.label}（${DOMAIN_LABELS[instance.domain]}，${RUN_STATE_LABELS[instance.runState]}${
                instance.pid !== undefined ? `，pid ${instance.pid}` : ""
              }）：${instance.explanation}`}
            </li>
          ))}
        </ul>
      ) : null}
      {targets.map((target) => (
        <div key={`${target.domain}/${target.label}`} className="flex flex-wrap items-center gap-ui-8">
          <span className="text-aux text-muted-foreground">{`仅跳转查看，不会停止或重载：${target.label}`}</span>
          <Button variant="secondary" onClick={() => onOpenService?.(target)}>
            查看该服务
          </Button>
        </div>
      ))}
      <h4 className="m-0 text-sm font-semibold">端口占用预检查</h4>
      {conflicts.ports.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {conflicts.ports.map((port) => (
            <li key={`${port.host}:${port.port}`}>
              {`${port.host}:${port.port}：${PORT_STATE_LABELS[port.state]}。${port.explanation}`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-aux text-muted-foreground">没有可检查的监听地址。</p>
      )}
      {conflicts.upstreams.length > 0 ? (
        <>
          <h4 className="m-0 text-sm font-semibold">上游（仅提示，不阻止开启）</h4>
          <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
            {conflicts.upstreams.map((upstream) => (
              <li key={`${upstream.host}:${upstream.port}`}>
                {`${upstream.host}:${upstream.port}：${UPSTREAM_STATE_LABELS[upstream.state]}。${upstream.explanation}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {conflicts.notes.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-aux text-muted-foreground">
          {conflicts.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function emptyAddressText(summary: CaddyStartSummary): string {
  return summary.source === "RAW" ? "以原文为准" : "无启用的站点";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-ui-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-ui-8">
      <dt className="m-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-all">{value}</dd>
    </div>
  );
}
