import type {
  ConnectionState,
  DiscoveryState,
  RecentOperationState,
  RefreshState,
} from "../../app/shellState";
import { StatusBadge } from "../../components/ui";
import { OperationStatus } from "../operations/OperationStatus";
import { SystemSummary } from "./SystemSummary";

type StatusTone = "neutral" | "success" | "warning" | "danger";

interface DashboardPageProps {
  connection?: ConnectionState;
  recentOperation?: RecentOperationState;
  refresh?: RefreshState;
  state: DiscoveryState;
}

function StatusIcon({
  busy = false,
  tone,
}: {
  busy?: boolean;
  tone: StatusTone;
}) {
  if (busy) {
    return (
      <svg
        className="size-4 shrink-0 animate-spin text-warning"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M17 10a7 7 0 1 1-2.05-4.95" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg
        className="size-4 shrink-0 text-danger"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 3 2.5 17h15L10 3Z" />
        <path d="M10 7.5v4M10 14.5h.01" />
      </svg>
    );
  }

  if (tone === "success") {
    return (
      <svg
        className="size-4 shrink-0 text-success"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7" />
        <path d="m6.5 10 2.2 2.2 4.8-5" />
      </svg>
    );
  }

  return (
    <svg
      className={`size-4 shrink-0 ${
        tone === "warning" ? "text-warning" : "text-muted-foreground"
      }`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9.5v4M10 6.5h.01" />
    </svg>
  );
}

function StatusRow({
  busy = false,
  detail,
  label,
  role,
  status,
  tone,
}: {
  busy?: boolean;
  detail: string;
  label: string;
  role?: "alert" | "status";
  status: string;
  tone: StatusTone;
}) {
  return (
    <div className="dashboard-status-row" aria-busy={busy || undefined}>
      <StatusIcon busy={busy} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-md">
          <h4 className="min-w-0 break-words text-xs font-semibold">
            {label}
          </h4>
          <StatusBadge className="shrink-0" tone={tone}>
            {status}
          </StatusBadge>
        </div>
        <p
          className={`mt-1 min-w-0 break-words text-xs leading-relaxed ${
            tone === "danger" ? "text-danger" : "text-muted-foreground"
          }`}
          role={role}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

function ConnectionSummary({ state }: { state: ConnectionState }) {
  if (state.status === "loading") {
    return (
      <StatusRow
        busy
        detail="正在连接本地 Tauri 服务…"
        label="本地服务"
        role="status"
        status="连接中"
        tone="warning"
      />
    );
  }
  if (state.status === "error") {
    return (
      <StatusRow
        detail={state.error.message}
        label="本地服务"
        role="alert"
        status="连接失败"
        tone="danger"
      />
    );
  }
  return (
    <StatusRow
      detail={`UserHome v${state.appStatus.version}`}
      label="本地服务"
      status="已连接"
      tone="success"
    />
  );
}

function RefreshSummary({ state }: { state: RefreshState }) {
  if (state.status === "refreshing") {
    return (
      <StatusRow
        busy
        detail="正在刷新本机状态…"
        label="数据刷新"
        role="status"
        status="进行中"
        tone="warning"
      />
    );
  }
  if (state.status === "error") {
    return (
      <StatusRow
        detail={state.message}
        label="数据刷新"
        role="status"
        status="部分完成"
        tone="warning"
      />
    );
  }
  if (state.status === "ready") {
    const completedAt = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(state.completedAt));
    return (
      <StatusRow
        detail={`最近刷新：${completedAt}`}
        label="数据刷新"
        status="已完成"
        tone="success"
      />
    );
  }
  return (
    <StatusRow
      detail="等待首次刷新"
      label="数据刷新"
      status="等待"
      tone="neutral"
    />
  );
}

function DiscoverySummary({ state }: { state: DiscoveryState }) {
  if (state.status === "loading") {
    return (
      <StatusRow
        busy
        detail="正在读取机器信息与应用证据…"
        label="本机发现"
        role="status"
        status="读取中"
        tone="warning"
      />
    );
  }
  if (state.status === "error") {
    return (
      <StatusRow
        detail={state.error.message}
        label="本机发现"
        role="alert"
        status="不可用"
        tone="danger"
      />
    );
  }
  if (state.snapshot.system.status === "LOADING") {
    return (
      <StatusRow
        busy
        detail="正在读取本机元数据…"
        label="本机发现"
        role="status"
        status="读取中"
        tone="warning"
      />
    );
  }
  if (state.snapshot.system.status === "ERROR") {
    return (
      <StatusRow
        detail={state.snapshot.system.error.message}
        label="本机发现"
        role="alert"
        status="读取失败"
        tone="danger"
      />
    );
  }
  return <SystemSummary summary={state.snapshot.system.data} />;
}

function HomebrewSummary({ state }: { state: DiscoveryState }) {
  if (state.status === "loading") {
    return (
      <StatusRow
        busy
        detail="正在后台读取软件清单…"
        label="Homebrew"
        role="status"
        status="扫描中"
        tone="warning"
      />
    );
  }
  if (state.status === "error") {
    return (
      <StatusRow
        detail="本机发现不可用，Homebrew 状态尚未加载。"
        label="Homebrew"
        status="不可用"
        tone="neutral"
      />
    );
  }

  const { brew } = state.snapshot;
  if (brew.status === "LOADING") {
    return (
      <StatusRow
        busy
        detail="正在后台读取软件清单…"
        label="Homebrew"
        role="status"
        status="扫描中"
        tone="warning"
      />
    );
  }
  if (brew.status === "ERROR") {
    return (
      <StatusRow
        detail={brew.error.message}
        label="Homebrew"
        role="alert"
        status="扫描失败"
        tone="danger"
      />
    );
  }
  if (!brew.data.available) {
    return (
      <StatusRow
        detail="未检测到受信任的 Homebrew 安装。"
        label="Homebrew"
        status="未安装"
        tone="neutral"
      />
    );
  }

  const partial = brew.completeness === "PARTIAL";
  return (
    <div className="dashboard-status-row">
      <StatusIcon tone={partial ? "warning" : "success"} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-md">
          <h4 className="min-w-0 break-words text-xs font-semibold">
            Homebrew
          </h4>
          <StatusBadge
            className="shrink-0"
            tone={partial ? "warning" : "success"}
          >
            {partial ? "部分可用" : "可用"}
          </StatusBadge>
        </div>
        <dl className="dashboard-inline-metrics">
          <div>
            <dt>版本</dt>
            <dd className="break-words">
              {brew.data.version ?? "不可用"}
            </dd>
          </div>
          <div>
            <dt>Formula</dt>
            <dd>{brew.data.formulaCount}</dd>
          </div>
          <div>
            <dt>Cask</dt>
            <dd>{brew.data.caskCount}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const DEFAULT_CONNECTION: ConnectionState = { status: "loading" };
const DEFAULT_REFRESH: RefreshState = { status: "idle" };
const DEFAULT_OPERATION: RecentOperationState = { status: "empty" };

function AttentionSummary({
  connection,
  recentOperation,
  refresh,
  state,
}: {
  connection: ConnectionState;
  recentOperation: RecentOperationState;
  refresh: RefreshState;
  state: DiscoveryState;
}) {
  const items: {
    key: string;
    label: string;
    detail: string;
    tone: "warning" | "danger";
  }[] = [];

  if (connection.status === "error") {
    items.push({
      key: "connection",
      label: "本地服务",
      detail: connection.error.message,
      tone: "danger",
    });
  }
  if (refresh.status === "error") {
    items.push({
      key: "refresh",
      label: "数据刷新",
      detail: refresh.message,
      tone: "warning",
    });
  }
  if (state.status === "error") {
    items.push({
      key: "discovery",
      label: "本机发现",
      detail: state.error.message,
      tone: "danger",
    });
  }
  if (state.status === "ready") {
    const { system, brew, candidates } = state.snapshot;
    for (const [label, module] of [
      ["本机发现", system],
      ["Homebrew", brew],
      ["配置发现", candidates],
    ] as const) {
      if (module.status === "ERROR") {
        items.push({
          key: `${label}-error`,
          label,
          detail: module.error.message,
          tone: "danger",
        });
      } else if (module.status === "READY") {
        const issues = [
          ...(module.issues ?? []),
          ...("issues" in module.data ? module.data.issues : []),
        ];
        if (
          (module.completeness === "PARTIAL" ||
            ("completeness" in module.data &&
              module.data.completeness === "PARTIAL")) &&
          issues.length === 0
        ) {
          items.push({
            key: `${label}-partial`,
            label,
            detail: "本次扫描只返回部分结果。",
            tone: "warning",
          });
        }
        for (const [index, issue] of issues.entries()) {
          items.push({
            key: `${label}-${index}`,
            label: `${label} · ${issue.module}`,
            detail: issue.message,
            tone: "warning",
          });
        }
      }
    }
  }
  if (recentOperation.status === "error") {
    items.push({
      key: "operation-error",
      label: "最近操作",
      detail: recentOperation.error.message,
      tone: "danger",
    });
  } else if (
    recentOperation.status === "ready" &&
    recentOperation.operation.status === "FAILED"
  ) {
    items.push({
      key: "operation-failed",
      label: "最近操作",
      detail: recentOperation.operation.summary,
      tone: "danger",
    });
  }

  const updating =
    connection.status === "loading" ||
    state.status === "loading" ||
    (state.status === "ready" &&
      (state.snapshot.system.status === "LOADING" ||
        state.snapshot.brew.status === "LOADING" ||
        state.snapshot.candidates.status === "LOADING")) ||
    recentOperation.status === "loading" ||
    refresh.status === "refreshing";

  return (
    <div className="dashboard-attention">
      {items.length === 0 ? (
        <p className="dashboard-attention__empty" role="status">
          {updating
            ? "部分状态仍在读取中，关注项会随结果更新。"
            : "当前没有需要关注的状态。"}
        </p>
      ) : (
        <>
          {updating ? (
            <p className="dashboard-attention__empty">
              部分状态仍在读取中，关注项会随结果更新。
            </p>
          ) : null}
          {items.map((item) => (
            <StatusRow
              key={item.key}
              detail={item.detail}
              label={item.label}
              role={item.tone === "danger" ? "alert" : "status"}
              status={item.tone === "danger" ? "异常" : "需留意"}
              tone={item.tone}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function DashboardPage({
  connection = DEFAULT_CONNECTION,
  recentOperation = DEFAULT_OPERATION,
  refresh = DEFAULT_REFRESH,
  state,
}: DashboardPageProps) {
  const systemIsPartial =
    state.status === "ready" &&
    state.snapshot.system.status === "READY" &&
    state.snapshot.system.data.completeness === "PARTIAL";

  return (
    <section
      className="dashboard-workspace min-w-0 break-words"
      aria-labelledby="dashboard-heading"
    >
      <header className="dashboard-workspace__header">
        <div className="min-w-0">
          <h2 id="dashboard-heading">概览</h2>
          <p>本机状态、需要关注的事项和最近活动</p>
        </div>
        {systemIsPartial ? (
          <StatusBadge className="shrink-0" tone="warning">
            部分结果
          </StatusBadge>
        ) : null}
      </header>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-discovery-heading"
      >
        <h3 id="dashboard-discovery-heading">本机概览</h3>
        <div className="dashboard-group__content dashboard-group__content--rows">
          <ConnectionSummary state={connection} />
          <DiscoverySummary state={state} />
          <HomebrewSummary state={state} />
          <RefreshSummary state={refresh} />
        </div>
      </section>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-attention-heading"
      >
        <h3 id="dashboard-attention-heading">需要关注</h3>
        <AttentionSummary
          connection={connection}
          recentOperation={recentOperation}
          refresh={refresh}
          state={state}
        />
      </section>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-activity-heading"
      >
        <h3 id="dashboard-activity-heading">最近活动</h3>
        <div className="dashboard-group__content dashboard-group__content--rows">
          <OperationStatus state={recentOperation} />
        </div>
      </section>
    </section>
  );
}
