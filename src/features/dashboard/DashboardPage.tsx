import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { NavigationIntent } from "../../app/routeDefinitions";
import type {
  ConnectionState,
  DiscoveryState,
  RecentOperationState,
  RefreshState,
} from "../../app/shellState";
import {
  selectCandidateCoverage,
  type CandidateCoverageView,
} from "../../app/discoverySelectors";
import {
  BoardCell,
  Button,
  PageShell,
  Panel,
  StatusBadge,
} from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import type { ManagedAppCoverageClass } from "../../ipc/catalog";
import type {
  CandidateEvidence,
  CandidateScanOutcomeKind,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import type { OptionalDiscoveryRoot } from "../../ipc/settings";
import { listServices, type ServiceSummary } from "../../ipc/services";
import { OperationStatus } from "../operations/OperationStatus";
import { ModuleBay } from "./ModuleBay";
import {
  BAY_NO_VALUE,
  BAY_UNLOADED,
  OVERVIEW_MODULE_BAYS,
  serviceBay,
} from "./overviewBays";

type Tone = "neutral" | "success" | "warning" | "danger";

type ServiceOverview =
  | { status: "loading" }
  | { status: "ready"; services: readonly ServiceSummary[] }
  | { status: "error"; error: AppError };

interface DashboardPageProps {
  connection?: ConnectionState;
  onNavigate?: (intent: NavigationIntent) => void;
  onRefresh?: () => void;
  /**
   * Optional discovery roots enabled in preferences. When provided, the
   * dashboard distinguishes a user-disabled root from a scan that could not
   * read a root it was asked to explore.
   */
  optionalDiscoveryRoots?: readonly OptionalDiscoveryRoot[];
  recentOperation?: RecentOperationState;
  refresh?: RefreshState;
  state: DiscoveryState;
}

const DEFAULT_CONNECTION: ConnectionState = { status: "loading" };
const DEFAULT_REFRESH: RefreshState = { status: "idle" };
const DEFAULT_OPERATION: RecentOperationState = { status: "empty" };

const COVERAGE_LABELS: Record<ManagedAppCoverageClass, string> = {
  MANAGED_WRITABLE: "受管可写",
  MANAGED_READ_ONLY: "受管只读",
  DETECTED_UNSUPPORTED: "已发现，暂不支持",
  EXCLUDED: "已排除",
};

const COVERAGE_PRIORITY: Record<ManagedAppCoverageClass, number> = {
  MANAGED_WRITABLE: 0,
  MANAGED_READ_ONLY: 1,
  DETECTED_UNSUPPORTED: 2,
  EXCLUDED: 3,
};

const COVERAGE_TONES: Record<ManagedAppCoverageClass, Tone> = {
  MANAGED_WRITABLE: "success",
  MANAGED_READ_ONLY: "neutral",
  DETECTED_UNSUPPORTED: "warning",
  EXCLUDED: "warning",
};

const EVIDENCE_LABELS: Record<CandidateEvidence, string> = {
  METADATA_PRESENT: "元数据存在",
  CATALOG_DOCUMENT: "Catalog 文档匹配",
  CATALOG_SERVICE: "Catalog 服务位置",
  BOUNDED_ROOT_ENTRY: "受限根目录条目",
  SYMLINK_METADATA_ONLY: "仅检查符号链接元数据",
  EXCLUSION_RULE: "命中排除规则",
};

const OUTCOME_LABELS: Record<CandidateScanOutcomeKind, string> = {
  COMPLETE: "扫描完整",
  CANDIDATE_LIMIT_REACHED: "达到候选上限",
  ENTRY_LIMIT_REACHED: "达到条目上限",
  METADATA_LIMIT_REACHED: "达到元数据上限",
  PERMISSION_DENIED: "权限受限",
  SYMLINK_METADATA_ONLY: "仅符号链接元数据",
  TIMEOUT: "扫描超时",
  METADATA_UNAVAILABLE: "元数据不可用",
  INVALID_ROOT: "根目录无效",
};

const OPTIONAL_ROOT_LABELS: Record<OptionalDiscoveryRoot, string> = {
  HOME: "~/",
  XDG_CONFIG_HOME: "XDG_CONFIG_HOME/",
  APPLICATION_SUPPORT: "APPLICATION_SUPPORT/",
  HOMEBREW_PREFIX: "HOMEBREW_PREFIX/etc/",
};

const ALL_OPTIONAL_ROOTS: readonly OptionalDiscoveryRoot[] = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPLICATION_SUPPORT",
  "HOMEBREW_PREFIX",
];

/** At most this many actionable candidates are listed in the first group. */
export const MAX_COVERAGE_ACTIONS = 3;

function StatusGlyph({ busy = false, tone }: { busy?: boolean; tone: Tone }) {
  if (busy) {
    return <span className="status-glyph status-glyph--busy" aria-hidden="true" />;
  }
  return <span className={`status-glyph status-glyph--${tone}`} aria-hidden="true" />;
}

function PulseCard({
  detail,
  label,
  status,
  tone,
  busy = false,
}: {
  detail: string;
  label: string;
  status: string;
  tone: Tone;
  busy?: boolean;
}) {
  return (
    <article className={`pulse-card pulse-card--${tone}`} aria-busy={busy || undefined} role={tone === "danger" ? "alert" : undefined}>
      <div className="pulse-card__heading">
        <span className="pulse-card__label"><StatusGlyph busy={busy} tone={tone} />{label}</span>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function connectionPulse(state: ConnectionState) {
  if (state.status === "loading") return { status: "连接中", detail: "正在连接本地服务", tone: "warning" as const, busy: true };
  if (state.status === "error") return { status: "异常", detail: state.error.message, tone: "danger" as const };
  return { status: "在线", detail: `UserHome v${state.appStatus.version}`, tone: "success" as const };
}

function discoveryPulse(state: DiscoveryState) {
  if (state.status === "loading") return { status: "扫描中", detail: "正在读取本机元数据", tone: "warning" as const, busy: true };
  if (state.status === "error") return { status: "不可用", detail: state.error.message, tone: "danger" as const };
  if (state.snapshot.system.status === "LOADING") return { status: "扫描中", detail: "正在读取机器与应用证据", tone: "warning" as const, busy: true };
  if (state.snapshot.system.status === "ERROR") return { status: "失败", detail: state.snapshot.system.error.message, tone: "danger" as const };
  const partial = state.snapshot.system.data.completeness === "PARTIAL";
  return {
    status: partial ? "部分结果" : "完整",
    detail: `${state.snapshot.system.data.osVersion ?? "macOS"} · ${state.snapshot.system.data.architecture ?? "架构未知"}`,
    tone: partial ? "warning" as const : "success" as const,
  };
}

function refreshPulse(state: RefreshState) {
  if (state.status === "refreshing") return { status: "刷新中", detail: "正在同步本机状态", tone: "warning" as const, busy: true };
  if (state.status === "error") return { status: "部分完成", detail: state.message, tone: "warning" as const };
  if (state.status === "ready") {
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(state.completedAt));
    return { status: "已同步", detail: `最近刷新 ${time}`, tone: "success" as const };
  }
  return { status: "等待", detail: "等待首次刷新", tone: "neutral" as const };
}

function operationPulse(state: RecentOperationState) {
  if (state.status === "loading") return { status: "读取中", detail: "正在读取最近操作", tone: "warning" as const, busy: true };
  if (state.status === "error") return { status: "异常", detail: state.error.message, tone: "danger" as const };
  if (state.status === "empty") return { status: "空闲", detail: "暂无操作记录", tone: "neutral" as const };
  const failed = state.operation.status === "FAILED";
  const running = ["PREVIEWED", "RUNNING", "CANCELLING"].includes(state.operation.status);
  return {
    status: failed ? "失败" : running ? "进行中" : "已完成",
    detail: state.operation.summary,
    tone: failed ? "danger" as const : running ? "warning" as const : "success" as const,
    busy: running,
  };
}

interface AttentionItem {
  key: string;
  label: string;
  detail: string;
  tone: "warning" | "danger";
}

function overviewStatus(items: readonly AttentionItem[]): { tone: Tone; text: string } {
  if (items.length === 0) return { tone: "success", text: "当前状态稳定" };
  return {
    tone: items.some((item) => item.tone === "danger") ? "danger" : "warning",
    text: `${items.length} 项需要留意`,
  };
}

function attentionItems(
  connection: ConnectionState,
  discovery: DiscoveryState,
  refresh: RefreshState,
  recentOperation: RecentOperationState,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (connection.status === "error") items.push({ key: "connection", label: "本地服务连接失败", detail: connection.error.message, tone: "danger" });
  if (refresh.status === "error") items.push({ key: "refresh", label: "刷新未完全成功", detail: refresh.message, tone: "warning" });
  if (discovery.status === "error") items.push({ key: "discovery", label: "本机发现不可用", detail: discovery.error.message, tone: "danger" });
  if (discovery.status === "ready") {
    const modules = [
      ["系统发现", discovery.snapshot.system],
      ["Homebrew", discovery.snapshot.brew],
      ["配置发现", discovery.snapshot.candidates],
    ] as const;
    modules.forEach(([label, module]) => {
      if (module.status === "ERROR") {
        items.push({ key: `${label}-error`, label: `${label}异常`, detail: module.error.message, tone: "danger" });
      } else if (module.status === "READY") {
        const dataIssues =
          "issues" in module.data && Array.isArray(module.data.issues)
            ? module.data.issues
            : [];
        const issues = [...(module.issues ?? []), ...dataIssues];
        issues.forEach((issue, index) => items.push({ key: `${label}-${index}`, label: `${label} · ${issue.module}`, detail: issue.message, tone: "warning" }));
        const partial =
          module.completeness === "PARTIAL" ||
          ("completeness" in module.data && module.data.completeness === "PARTIAL");
        if (partial && issues.length === 0) {
          items.push({ key: `${label}-partial`, label: `${label}仅部分可用`, detail: "本次扫描只返回部分结果。", tone: "warning" });
        }
      }
    });
  }
  if (recentOperation.status === "error") items.push({ key: "operation-error", label: "操作记录不可用", detail: recentOperation.error.message, tone: "danger" });
  if (recentOperation.status === "ready" && recentOperation.operation.status === "FAILED") {
    items.push({ key: "operation-failed", label: "最近操作失败", detail: recentOperation.operation.summary, tone: "danger" });
  }
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="overview-metric"><dt>{label}</dt><dd>{value}</dd></div>;
}

function useServiceOverview(refreshId?: string): ServiceOverview {
  const [result, setResult] = useState<{
    refreshId?: string;
    overview: ServiceOverview;
  }>({ refreshId, overview: { status: "loading" } });

  useEffect(() => {
    let disposed = false;
    void listServices().then(
      (services) => {
        if (!disposed) {
          setResult({ refreshId, overview: { status: "ready", services } });
        }
      },
      (error) => {
        if (!disposed) {
          setResult({
            refreshId,
            overview: { status: "error", error: decodeAppError(error) },
          });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [refreshId]);

  return result.refreshId === refreshId
    ? result.overview
    : { status: "loading" };
}

function OverviewPanel({
  children,
  className = "",
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  description: string;
  title: string;
}) {
  return (
    <section className={`overview-panel ${className}`}>
      <header className="overview-panel__header">
        <div><h3>{title}</h3><p>{description}</p></div>
      </header>
      <div className="overview-panel__content">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// User-directory configuration (first dashboard group)
// ---------------------------------------------------------------------------

export interface LocalCoveragePlan {
  /** The bounded, prioritized candidates listed in the first group. */
  actions: UnmanagedCandidate[];
}

/**
 * Builds the bounded candidate list for a coverage view. Candidates are
 * prioritized managed writable, managed read-only, unsupported, excluded;
 * ties keep discovery order so the list is stable, and the list is capped at
 * `limit`. The list is informational: the retired applications workspace is
 * no longer a navigation target.
 */
export function localCoveragePlan(
  view: CandidateCoverageView,
  limit: number = MAX_COVERAGE_ACTIONS,
): LocalCoveragePlan {
  const actions = view.candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const priority =
        COVERAGE_PRIORITY[a.candidate.coverageClass] -
        COVERAGE_PRIORITY[b.candidate.coverageClass];
      return priority !== 0 ? priority : a.index - b.index;
    })
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);

  return { actions };
}

function evidenceSummary(candidate: UnmanagedCandidate): string {
  const labels = candidate.evidence.map((evidence) => EVIDENCE_LABELS[evidence]);
  return labels.length > 0 ? labels.join("、") : "未返回证据";
}

function CoverageLoading() {
  return (
    <div className="attention-clear" role="status">
      <StatusGlyph busy tone="warning" />
      <div>
        <strong>正在读取用户目录配置</strong>
        <p>正在读取本机配置覆盖、证据与扫描结果。</p>
      </div>
    </div>
  );
}

function UserDirectoryCoveragePanel({
  optionalDiscoveryRoots,
  state,
}: {
  optionalDiscoveryRoots?: readonly OptionalDiscoveryRoot[];
  state: DiscoveryState;
}) {
  const snapshot =
    state.status === "ready"
      ? state.snapshot
      : state.status === "error"
        ? state.previousSnapshot
        : undefined;
  const refreshError = state.status === "error" ? state.error : undefined;
  const coverage = selectCandidateCoverage(snapshot?.candidates);
  const moduleError =
    snapshot && snapshot.candidates.status === "ERROR"
      ? snapshot.candidates.error
      : undefined;
  const disabledRoots = optionalDiscoveryRoots
    ? ALL_OPTIONAL_ROOTS.filter((root) => !optionalDiscoveryRoots.includes(root))
    : [];
  const actions = localCoveragePlan(coverage).actions;
  const omitted =
    coverage.status === "empty" ? 0 : coverage.candidates.length - actions.length;
  const outcomes = coverage.outcomes.filter(
    (outcome) => outcome.kind !== "COMPLETE",
  );

  let body: ReactNode;
  if (!snapshot) {
    body = refreshError ? (
      <p className="overview-error" role="alert">
        {refreshError.message}
      </p>
    ) : (
      <CoverageLoading />
    );
  } else if (coverage.status === "loading") {
    body = <CoverageLoading />;
  } else if (coverage.status === "error") {
    body = (
      <p className="overview-error" role="alert">
        {moduleError?.message ?? "用户目录配置不可用。"}
        {moduleError?.retryable ? "（可重试）" : ""}
      </p>
    );
  } else {
    const statusBadge =
      coverage.status === "empty"
        ? { label: "未发现配置", tone: "neutral" as const }
        : coverage.status === "partial"
          ? { label: "部分可用", tone: "warning" as const }
          : { label: "完整", tone: "success" as const };
    body = (
      <>
        <div className="mb-ui-8 flex min-w-0 flex-wrap items-center gap-ui-8">
          <StatusBadge tone={statusBadge.tone}>{statusBadge.label}</StatusBadge>
          {coverage.restricted ? <StatusBadge tone="warning">受限</StatusBadge> : null}
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {coverage.conservesTotals
              ? `四类计数守恒：共 ${coverage.counts.total} 项`
              : `计数与扫描总数不一致：扫描共 ${coverage.summary?.candidateCount ?? 0} 项，四类合计 ${coverage.counts.total} 项`}
          </span>
        </div>

        <dl className="overview-metrics" aria-label="用户目录覆盖计数">
          <Metric label="总数" value={coverage.counts.total} />
          <Metric label="受管可写" value={coverage.counts.managedWritable} />
          <Metric label="受管只读" value={coverage.counts.managedReadOnly} />
          <Metric label="已发现，暂不支持" value={coverage.counts.detectedUnsupported} />
          <Metric label="已排除" value={coverage.counts.excluded} />
        </dl>

        {coverage.summary ? (
          <p className="attention-more">
            本次扫描：根目录 {coverage.summary.rootCount} 个 · 元数据{" "}
            {coverage.summary.metadataCount} 项 · 候选上限 {coverage.summary.limits.maxCandidates} 项
            · 限时 {coverage.summary.limits.timeoutMs} ms
          </p>
        ) : null}

        {coverage.status === "empty" ? (
          <p className="attention-more">
            未发现用户目录配置。本次扫描未识别到需要管理的配置项。
          </p>
        ) : null}

        {outcomes.length > 0 ? (
          <ul className="attention-list" aria-label="扫描结果与限制">
            {outcomes.map((outcome, index) => (
              <li key={`outcome-${outcome.kind}-${index}`}>
                <StatusGlyph tone="warning" />
                <div>
                  <strong>{OUTCOME_LABELS[outcome.kind]}</strong>
                  <p>{outcome.message}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {coverage.issues.length > 0 ? (
          <ul className="attention-list" aria-label="扫描问题">
            {coverage.issues.map((issue, index) => (
              <li key={`issue-${issue.module}-${index}`}>
                <StatusGlyph tone="warning" />
                <div>
                  <strong>{issue.module}</strong>
                  <p>{issue.message}{issue.retryable ? "（可重试）" : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {disabledRoots.length > 0 ? (
          <p className="attention-more">
            已停用可选发现根：{disabledRoots.map((root) => OPTIONAL_ROOT_LABELS[root]).join("、")}
            。这些位置未参与本次识别，可在设置中重新启用。
          </p>
        ) : null}

        {actions.length > 0 ? (
          <ul className="attention-list" aria-label="本机识别行动项">
            {actions.map((candidate) => (
              <li key={candidate.candidateId}>
                <StatusGlyph tone={COVERAGE_TONES[candidate.coverageClass]} />
                <div>
                  <strong>{candidate.displayName}</strong>
                  <p>
                    {COVERAGE_LABELS[candidate.coverageClass]} ·{" "}
                    {candidate.relativePath}
                  </p>
                  <p>证据：{evidenceSummary(candidate)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {omitted > 0 ? (
          <p className="attention-more">另有 {omitted} 项本机配置未在此列出。</p>
        ) : null}
      </>
    );
  }

  return (
    <Panel
      className="overview-panel"
      aria-labelledby="user-directory-coverage-heading"
    >
      <header className="overview-panel__header">
        <div>
          <h2
            className="m-0 text-group font-semibold text-foreground"
            id="user-directory-coverage-heading"
          >
            用户目录配置
          </h2>
          <p>本机识别到的配置覆盖、证据与下一步</p>
        </div>
      </header>
      <div className="overview-panel__content">
        {refreshError && snapshot ? (
          <p className="overview-error" role="alert">
            刷新失败：{refreshError.message}，以下为上次成功结果。
          </p>
        ) : null}
        {body}
      </div>
    </Panel>
  );
}

export function DashboardPage({
  connection = DEFAULT_CONNECTION,
  onNavigate = () => undefined,
  onRefresh = () => undefined,
  optionalDiscoveryRoots,
  recentOperation = DEFAULT_OPERATION,
  refresh = DEFAULT_REFRESH,
  state,
}: DashboardPageProps) {
  const connectionState = connectionPulse(connection);
  const discoveryState = discoveryPulse(state);
  const refreshState = refreshPulse(refresh);
  const operationState = operationPulse(recentOperation);
  const attention = useMemo(() => attentionItems(connection, state, refresh, recentOperation), [connection, state, refresh, recentOperation]);
  const refreshId = state.status === "ready" ? state.snapshot.refreshId : undefined;
  const services = useServiceOverview(refreshId);
  const systemSummary = state.status === "ready" && state.snapshot.system.status === "READY" ? state.snapshot.system.data : undefined;
  const brew = state.status === "ready" ? state.snapshot.brew : undefined;
  const serviceModel = serviceBay(services);
  const overview = overviewStatus(attention);

  return (
    <section className="dashboard-workspace" aria-label="概览">
      <PageShell layout="board">
        <BoardCell span={12}>
          <Panel
            aria-label="概览状态"
            className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8 p-ui-16"
          >
            <span className="flex min-w-0 items-center gap-ui-8 text-aux text-muted-foreground">
              <StatusGlyph tone={overview.tone} />
              <span className="min-w-0 break-words">{overview.text}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={onRefresh}>重新扫描</Button>
          </Panel>
        </BoardCell>
        <BoardCell span={8}>
          <ModuleBay
            actionLabel="打开服务"
            figure={serviceModel.figure}
            id="overview-bay-services"
            onOpen={() => onNavigate({ routeId: "services" })}
            status={serviceModel.status}
            title="服务"
          />
        </BoardCell>
        {OVERVIEW_MODULE_BAYS.map((bay) => (
          <BoardCell key={bay.routeId} span={4}>
            <ModuleBay
              actionLabel={bay.action}
              figure={{ label: bay.figureLabel, value: BAY_NO_VALUE }}
              id={`overview-bay-${bay.routeId}`}
              onOpen={() => onNavigate({ routeId: bay.routeId })}
              status={BAY_UNLOADED}
              title={bay.title}
            />
          </BoardCell>
        ))}

        <BoardCell span={12}>
          <UserDirectoryCoveragePanel
            optionalDiscoveryRoots={optionalDiscoveryRoots}
            state={state}
          />
        </BoardCell>

        <BoardCell span={12}>
          <section className="system-pulse" aria-labelledby="dashboard-system-heading">
            <div className="system-pulse__label"><span>01</span><h2 id="dashboard-system-heading">系统脉冲</h2></div>
            <div className="system-pulse__grid">
              <PulseCard label="本地服务" {...connectionState} />
              <PulseCard label="本机发现" {...discoveryState} />
              <PulseCard label="最近刷新" {...refreshState} />
              <PulseCard label="最近操作" {...operationState} />
            </div>
          </section>
        </BoardCell>

        <BoardCell span={6}>
          <OverviewPanel
            className="overview-panel--attention"
            title="关注事项"
            description="按影响程度排序的本机状态"
          >
            {attention.length === 0 ? (
              <div className="attention-clear" role="status"><StatusGlyph tone="success" /><div><strong>当前状态稳定</strong><p>没有需要立即处理的异常。</p></div></div>
            ) : (
              <ul className="attention-list">
                {attention.slice(0, 3).map((item) => (
                  <li key={item.key}>
                    <StatusGlyph tone={item.tone} />
                    <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 3 ? <p className="attention-more">另有 {attention.length - 3} 项状态需要留意</p> : null}
            {systemSummary ? (
              <dl className="machine-summary" aria-label="本机摘要">
                <Metric label="macOS" value={systemSummary.osVersion ?? "—"} />
                <Metric label="架构" value={systemSummary.architecture ?? "—"} />
                <Metric
                  label="已识别应用"
                  value={systemSummary.applications.filter((item) => item.status !== "ABSENT").length}
                />
                <Metric
                  label="扫描"
                  value={systemSummary.completeness === "COMPLETE" ? "完整" : "部分"}
                />
              </dl>
            ) : null}
          </OverviewPanel>
        </BoardCell>

        <BoardCell span={6}>
          <OverviewPanel title="软件与服务" description="Homebrew 资产与后台进程">
            <div className="software-service-grid">
              <div>
                <div className="overview-resource-heading"><span>软件</span></div>
                {brew?.status === "READY" && brew.data.available ? (
                  <dl className="resource-inline-metrics"><Metric label="Formula" value={brew.data.formulaCount} /><Metric label="Cask" value={brew.data.caskCount} /></dl>
                ) : <p>{brew?.status === "ERROR" ? brew.error.message : brew?.status === "READY" ? "未检测到 Homebrew" : "正在后台读取软件清单…"}</p>}
              </div>
              <div>
                <div className="overview-resource-heading"><span>服务</span><Button size="sm" variant="ghost" onClick={() => onNavigate({ routeId: "services" })}>查看</Button></div>
                {services.status === "ready" ? (
                  <dl className="resource-inline-metrics"><Metric label="运行" value={services.services.filter((item) => item.state === "STARTED").length} /><Metric label="异常" value={services.services.filter((item) => item.state === "ERROR").length} /></dl>
                ) : <p>{services.status === "error" ? services.error.message : "正在读取服务状态…"}</p>}
              </div>
            </div>
          </OverviewPanel>
        </BoardCell>

        <BoardCell span={12}>
          <OverviewPanel className="overview-panel--activity" title="最近活动" description="本机操作记录与当前进度">
            <OperationStatus state={recentOperation} />
          </OverviewPanel>
        </BoardCell>
      </PageShell>
    </section>
  );
}
