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
import { localizeError } from "../../i18n/errors";
import { useCaddyCopy, type CaddyCopy } from "./caddyCopy";
import { createRequestTracker } from "./caddyPreviewFlow";
import {
  DOMAIN_LABEL_KEYS,
  PORT_STATE_LABEL_KEYS,
  RUN_STATE_LABEL_KEYS,
  SNAPSHOT_LABEL_KEYS,
  UPSTREAM_STATE_LABEL_KEYS,
  externalServiceTargets,
  presentVerdict,
  startGate,
  type ServiceTarget,
} from "./caddyConflictModel";
import type { MessageKey } from "../../i18n";
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

const SOURCE_LABEL_KEYS: Record<CaddyConfigSource, MessageKey> = {
  RULES: "caddy.run.source.rules",
  RAW: "caddy.run.source.raw",
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
  const copy = useCaddyCopy();
  const { t } = copy;
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
  const presentation = state === undefined ? undefined : presentRunState(state, copy);
  const appliedPresentation =
    state === "RUNNING" && applied !== undefined ? presentApplied(applied, copy) : undefined;

  return (
    <Panel aria-labelledby="caddy-run-heading" className="grid min-w-0 gap-ui-8 p-ui-8">
      <div className="flex flex-wrap items-center justify-between gap-ui-8">
        <h2 id="caddy-run-heading" className="text-sm font-semibold">
          {t("caddy.run.heading")}
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
        {status === undefined ? t("caddy.run.reading") : status.message}
      </p>
      <p className="m-0 text-aux text-muted-foreground">
        {t("caddy.run.currentSource", { source: t(SOURCE_LABEL_KEYS[source]) })}
      </p>
      {error !== undefined ? (
        <p role="alert" className="m-0 text-body text-danger">
          {localizeError(error, copy.locale)}
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
          {t("caddy.run.workdirGate", { reason: workdirReason })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-ui-8">
        <Button variant="secondary" disabled={!previewEnabled} onClick={onPrepare}>
          {t("caddy.run.preview")}
        </Button>
        {onApply !== undefined ? (
          <Button variant="primary" disabled={!applyEnabled} onClick={onApply}>
            {t("caddy.run.apply")}
          </Button>
        ) : null}
        <Button variant="danger" disabled={!stopEnabled} onClick={onStop}>
          {t("caddy.run.stop")}
        </Button>
      </div>
      {onApply !== undefined ? (
        <p className="m-0 text-aux text-muted-foreground">{t("caddy.run.applyNote")}</p>
      ) : null}
      {applying || status?.applying === true ? (
        <p aria-live="polite" className="m-0 text-body">
          {t("caddy.run.applying")}
        </p>
      ) : null}
      {confirmVisible ? (
        <ApplyConfirm busy={applyBlocked} onConfirm={onConfirmApply} onCancel={onCancelApply} />
      ) : null}
      {applyResult !== undefined ? <ApplyResultBlock report={applyResult} /> : null}
      <LogViewer
        label={t("caddy.run.logLabel")}
        emptyText={t("common.log.empty")}
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
  const { t } = useCaddyCopy();
  return (
    <section
      aria-label={t("caddy.run.applyConfirmLabel")}
      className="grid gap-ui-8 rounded-panel border border-warning p-ui-8"
    >
      <p className="m-0 text-body font-semibold">{t("caddy.run.applyConfirmTitle")}</p>
      <p className="m-0 text-body">{t("caddy.run.applyConfirmBody")}</p>
      <div className="flex flex-wrap gap-ui-8">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {t("caddy.run.applyConfirmAction")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </section>
  );
}

function ApplyResultBlock({ report }: { report: CaddyApplyReport }) {
  const copy = useCaddyCopy();
  const { t } = copy;
  const failed = report.outcome === "FAILED";
  const headline = failed
    ? t("caddy.run.applyFailedHeadline", {
        reason:
          report.failure !== undefined
            ? applyFailureLabel(report.failure, copy)
            : t("caddy.run.reasonUnknown"),
      })
    : t("caddy.run.applySucceeded");
  return (
    <section
      aria-label={t("caddy.run.applyResultLabel")}
      role={failed ? "alert" : undefined}
      className={`grid gap-ui-4 rounded-panel border p-ui-8 ${failed ? "border-danger" : "border-control-border"}`}
    >
      <p className={`m-0 text-body font-semibold ${failed ? "text-danger" : ""}`}>
        {`${failed ? "▲" : "●"} ${headline}`}
      </p>
      <p className="m-0 text-body">{report.message}</p>
      {report.review !== undefined ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {reviewLines(report.review, copy).map((line) => (
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
      {failed ? <p className="m-0 text-aux text-muted-foreground">{t("caddy.run.noRetry")}</p> : null}
    </section>
  );
}

function FailureBlock({ status }: { status: CaddyRunStatus }) {
  const { t } = useCaddyCopy();
  return (
    <div role="alert" className="grid gap-ui-4 rounded-panel border border-danger p-ui-8">
      <p className="m-0 text-body font-semibold text-danger">{status.message}</p>
      {status.diagnostics.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {status.diagnostics.map((diagnostic, index) => (
            <li key={`${index}-${diagnostic.message}`}>
              {diagnostic.line !== undefined
                ? t("caddy.run.diagnosticLine", { line: diagnostic.line, message: diagnostic.message })
                : diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">{t("caddy.run.failureNoRetry")}</p>
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
  const copy = useCaddyCopy();
  const { t } = copy;
  const [accepted, setAccepted] = useState(false);
  const listen =
    summary.listen.length > 0
      ? summary.listen.join(t("caddy.preview.listSeparator"))
      : emptyAddressText(summary, copy);
  const upstreams =
    summary.upstreams.length > 0
      ? summary.upstreams.join(t("caddy.preview.listSeparator"))
      : emptyAddressText(summary, copy);
  const conflicts = summary.conflicts;
  const gate = startGate(summary, accepted);
  return (
    <section aria-label={t("caddy.run.summaryHeading")} className="grid gap-ui-8 rounded-panel border border-control-border p-ui-8">
      <h3 className="m-0 text-sm font-semibold">{t("caddy.run.summaryHeading")}</h3>
      {summary.blocked !== undefined ? (
        <p role="alert" className="m-0 text-body text-danger">
          {t("caddy.run.blocked", { reason: summary.blocked })}
        </p>
      ) : null}
      <dl className="m-0 grid gap-ui-4 text-body">
        <SummaryRow label={t("caddy.run.rowSource")} value={t(SOURCE_LABEL_KEYS[summary.source])} />
        <SummaryRow
          label={t("caddy.run.rowExecutable")}
          value={
            summary.executablePath !== undefined
              ? `${summary.executablePath}${
                  summary.version !== undefined
                    ? t("caddy.run.versionSuffix", { version: summary.version })
                    : ""
                }`
              : t("caddy.run.executableMissing")
          }
        />
        <SummaryRow label={t("caddy.run.rowRunFolder")} value={summary.workingDirectory} />
        <SummaryRow label={t("caddy.run.rowFingerprint")} value={summary.configFingerprint} />
        <SummaryRow label={t("caddy.run.rowListen")} value={listen} />
        <SummaryRow label={t("caddy.run.rowUpstream")} value={upstreams} />
        <SummaryRow label={t("caddy.run.rowAdmin")} value={summary.adminEndpoint} />
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
              label={t("caddy.run.acceptUnconfirmed")}
              description={t("caddy.run.acceptUnconfirmedHint")}
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
              {t("caddy.run.confirmStart")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
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
  const copy = useCaddyCopy();
  const { t } = copy;
  const verdict = presentVerdict(conflicts.verdict, copy);
  const targets = externalServiceTargets(conflicts);
  return (
    <section aria-label={t("caddy.run.conflictHeading")} className="grid gap-ui-4 rounded-panel border border-control-border p-ui-8">
      <p className="m-0 text-body font-semibold">{`${verdict.symbol} ${verdict.label}`}</p>
      <p className="m-0 text-body">{conflicts.headline}</p>
      <h4 className="m-0 text-sm font-semibold">{t("caddy.run.externalOwnership")}</h4>
      <p className="m-0 text-aux text-muted-foreground">
        {t("caddy.run.snapshotLine", {
          snapshot: t(SNAPSHOT_LABEL_KEYS[conflicts.external.snapshot]),
          explanation: conflicts.external.explanation,
        })}
      </p>
      {conflicts.external.instances.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {conflicts.external.instances.map((instance) => (
            <li key={`${instance.domain}/${instance.label}`}>
              {t("caddy.run.instanceLine", {
                label: instance.label,
                domain: t(DOMAIN_LABEL_KEYS[instance.domain]),
                runState: t(RUN_STATE_LABEL_KEYS[instance.runState]),
                pid: instance.pid !== undefined ? t("caddy.run.pid", { pid: instance.pid }) : "",
                explanation: instance.explanation,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {targets.map((target) => (
        <div key={`${target.domain}/${target.label}`} className="flex flex-wrap items-center gap-ui-8">
          <span className="text-aux text-muted-foreground">
            {t("caddy.run.targetOnly", { label: target.label })}
          </span>
          <Button variant="secondary" onClick={() => onOpenService?.(target)}>
            {t("caddy.run.openService")}
          </Button>
        </div>
      ))}
      <h4 className="m-0 text-sm font-semibold">{t("caddy.run.portPrecheck")}</h4>
      {conflicts.ports.length > 0 ? (
        <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
          {conflicts.ports.map((port) => (
            <li key={`${port.host}:${port.port}`}>
              {t("caddy.run.addressLine", {
                address: `${port.host}:${port.port}`,
                state: t(PORT_STATE_LABEL_KEYS[port.state]),
                explanation: port.explanation,
              })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-aux text-muted-foreground">{t("caddy.run.noListenAddress")}</p>
      )}
      {conflicts.upstreams.length > 0 ? (
        <>
          <h4 className="m-0 text-sm font-semibold">{t("caddy.run.upstreamAdvisory")}</h4>
          <ul className="m-0 grid gap-ui-2 pl-ui-8 text-body">
            {conflicts.upstreams.map((upstream) => (
              <li key={`${upstream.host}:${upstream.port}`}>
                {t("caddy.run.addressLine", {
                  address: `${upstream.host}:${upstream.port}`,
                  state: t(UPSTREAM_STATE_LABEL_KEYS[upstream.state]),
                  explanation: upstream.explanation,
                })}
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

function emptyAddressText(summary: CaddyStartSummary, copy: CaddyCopy): string {
  return copy.t(summary.source === "RAW" ? "caddy.run.followsRaw" : "caddy.run.noEnabledSites");
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-ui-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-ui-8">
      <dt className="m-0 text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-all">{value}</dd>
    </div>
  );
}
