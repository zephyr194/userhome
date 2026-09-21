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
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold">{label}</h4>
          <StatusBadge tone={tone}>{status}</StatusBadge>
        </div>
        <p
          className={`mt-1 text-xs leading-relaxed ${
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

  return (
    <div className="dashboard-status-row">
      <StatusIcon tone="success" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold">Homebrew</h4>
          <StatusBadge tone="success">可用</StatusBadge>
        </div>
        <dl className="dashboard-inline-metrics">
          <div>
            <dt>版本</dt>
            <dd>{brew.data.version ?? "不可用"}</dd>
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
      className="dashboard-workspace"
      aria-labelledby="dashboard-heading"
    >
      <header className="dashboard-workspace__header">
        <div>
          <h2 id="dashboard-heading">概览</h2>
          <p>本机能力、软件与最近活动</p>
        </div>
        {systemIsPartial ? (
          <StatusBadge tone="warning">部分结果</StatusBadge>
        ) : null}
      </header>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-discovery-heading"
      >
        <h3 id="dashboard-discovery-heading">本机与应用</h3>
        <div className="dashboard-group__content">
          <DiscoverySummary state={state} />
        </div>
      </section>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-packages-heading"
      >
        <h3 id="dashboard-packages-heading">软件包</h3>
        <div className="dashboard-group__content">
          <HomebrewSummary state={state} />
        </div>
      </section>

      <section
        className="dashboard-group"
        aria-labelledby="dashboard-runtime-heading"
      >
        <h3 id="dashboard-runtime-heading">运行状态</h3>
        <div className="dashboard-group__content dashboard-group__content--rows">
          <ConnectionSummary state={connection} />
          <RefreshSummary state={refresh} />
          <OperationStatus state={recentOperation} />
        </div>
      </section>
    </section>
  );
}
