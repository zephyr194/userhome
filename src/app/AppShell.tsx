import { useEffect, useRef, useState } from "react";
import { NavigationRail } from "../components/NavigationRail";
import { Button, StatusBadge } from "../components/ui";
import { OperationStatus } from "../features/operations/OperationStatus";
import { APP_ROUTES, type AppRouteId } from "./routeDefinitions";
import { RoutePanel } from "./routes";
import type {
  ConnectionState,
  DiscoveryState,
  PreferencesState,
  RefreshState,
  ShellState,
} from "./shellState";

interface AppShellProps {
  onRefresh: () => void;
  state: ShellState;
}

type RailTone = "neutral" | "success" | "warning" | "danger";

function RailIcon({
  tone,
  pending = false,
}: {
  tone: RailTone;
  pending?: boolean;
}) {
  const toneClass = {
    neutral: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];

  if (pending) {
    return (
      <svg
        className={`size-4 shrink-0 ${toneClass}`}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4l2.5 1.5" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg
        className={`size-4 shrink-0 ${toneClass}`}
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
        className={`size-4 shrink-0 ${toneClass}`}
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
      className={`size-4 shrink-0 ${toneClass}`}
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

function PreferencesStatus({ state }: { state: PreferencesState }) {
  if (state.status === "loading") {
    return (
      <section className="px-4 py-4" aria-labelledby="preferences-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="neutral" pending />
            <h3 id="preferences-heading" className="text-xs font-semibold">
              偏好设置
            </h3>
          </div>
          <StatusBadge>加载中</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          正在加载本机偏好设置…
        </p>
      </section>
    );
  }

  if (state.status === "safe-default") {
    return (
      <section className="px-4 py-4" aria-labelledby="preferences-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="warning" />
            <h3 id="preferences-heading" className="text-xs font-semibold">
              偏好设置
            </h3>
          </div>
          <StatusBadge tone="warning">安全默认值</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {state.diagnostic.message}
        </p>
      </section>
    );
  }

  return (
    <section className="px-4 py-4" aria-labelledby="preferences-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RailIcon tone="success" />
          <h3 id="preferences-heading" className="text-xs font-semibold">
            偏好设置
          </h3>
        </div>
        <StatusBadge tone="success">已加载</StatusBadge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        已验证本机偏好设置。
      </p>
    </section>
  );
}

function ModuleStatusRow({
  detail,
  label,
  pending = false,
  status,
  tone,
}: {
  detail: string;
  label: string;
  pending?: boolean;
  status: string;
  tone: RailTone;
}) {
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <RailIcon tone={tone} pending={pending} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium">{label}</span>
          <span
            className={`shrink-0 text-[11px] font-medium ${
              tone === "danger"
                ? "text-danger"
                : tone === "warning"
                  ? "text-warning"
                  : tone === "success"
                    ? "text-success"
                    : "text-muted-foreground"
            }`}
          >
            {status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {detail}
        </p>
      </div>
    </li>
  );
}

function DiscoveryStatus({ state }: { state: DiscoveryState }) {
  if (state.status === "loading") {
    return (
      <section className="px-4 py-3" aria-labelledby="discovery-status-heading">
        <h3
          id="discovery-status-heading"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          本机发现
        </h3>
        <ul className="mt-1 divide-y divide-border">
          {["机器", "应用", "Homebrew"].map((label) => (
            <ModuleStatusRow
              key={label}
              label={label}
              detail="等待发现结果"
              status="读取中"
              tone="warning"
              pending
            />
          ))}
        </ul>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="px-4 py-3" aria-labelledby="discovery-status-heading">
        <h3
          id="discovery-status-heading"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          本机发现
        </h3>
        <ul className="mt-1 divide-y divide-border">
          {["机器", "应用", "Homebrew"].map((label) => (
            <ModuleStatusRow
              key={label}
              label={label}
              detail="本机发现不可用"
              status="失败"
              tone="danger"
            />
          ))}
        </ul>
        <p className="mt-1 text-[11px] leading-relaxed text-danger" role="alert">
          {state.error.message}
        </p>
      </section>
    );
  }

  const { brew, system } = state.snapshot;
  const detectedApplications =
    system.status === "READY"
      ? system.data.applications.filter(
          (application) => application.status !== "ABSENT",
        ).length
      : 0;

  return (
    <section className="px-4 py-3" aria-labelledby="discovery-status-heading">
      <h3
        id="discovery-status-heading"
        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        本机发现
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {system.status === "LOADING" ? (
          <>
            <ModuleStatusRow
              label="机器"
              detail="正在读取本机元数据"
              status="读取中"
              tone="warning"
              pending
            />
            <ModuleStatusRow
              label="应用"
              detail="正在检查应用证据"
              status="读取中"
              tone="warning"
              pending
            />
          </>
        ) : system.status === "ERROR" ? (
          <>
            <ModuleStatusRow
              label="机器"
              detail={system.error.message}
              status="失败"
              tone="danger"
            />
            <ModuleStatusRow
              label="应用"
              detail="应用证据不可用"
              status="失败"
              tone="danger"
            />
          </>
        ) : (
          <>
            <ModuleStatusRow
              label="机器"
              detail={`${system.data.osVersion ?? "macOS 未知"} · ${
                system.data.architecture ?? "架构未知"
              }`}
              status={
                system.data.completeness === "COMPLETE" ? "正常" : "部分"
              }
              tone={
                system.data.completeness === "COMPLETE" ? "success" : "warning"
              }
            />
            <ModuleStatusRow
              label="应用"
              detail={`${detectedApplications}/${system.data.applications.length} 已识别`}
              status={
                system.data.completeness === "COMPLETE" ? "正常" : "部分"
              }
              tone={
                system.data.completeness === "COMPLETE" ? "success" : "warning"
              }
            />
          </>
        )}

        {brew.status === "LOADING" ? (
          <ModuleStatusRow
            label="Homebrew"
            detail="正在读取软件清单"
            status="扫描中"
            tone="warning"
            pending
          />
        ) : brew.status === "ERROR" ? (
          <ModuleStatusRow
            label="Homebrew"
            detail={brew.error.message}
            status="失败"
            tone="danger"
          />
        ) : brew.data.available ? (
          <ModuleStatusRow
            label="Homebrew"
            detail={`${brew.data.formulaCount} Formula · ${brew.data.caskCount} Cask`}
            status="可用"
            tone="success"
          />
        ) : (
          <ModuleStatusRow
            label="Homebrew"
            detail="未检测到受信任安装"
            status="未安装"
            tone="neutral"
          />
        )}
      </ul>
    </section>
  );
}

function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state.status === "loading") {
    return (
      <section className="px-4 py-4" aria-labelledby="connection-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="warning" pending />
            <h3 id="connection-heading" className="text-xs font-semibold">
              本地服务
            </h3>
          </div>
          <StatusBadge tone="warning">连接中</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs leading-relaxed text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          正在连接本地服务…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="px-4 py-4" aria-labelledby="connection-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="danger" />
            <h3 id="connection-heading" className="text-xs font-semibold">
              本地服务
            </h3>
          </div>
          <StatusBadge tone="danger">连接失败</StatusBadge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-danger" role="alert">
          {state.error.message}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {state.error.retryable
            ? "可从托盘选择 Refresh 后重试。"
            : "请检查应用状态后重试。"}
        </p>
      </section>
    );
  }

  return (
    <section className="px-4 py-4" aria-labelledby="connection-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RailIcon tone="success" />
          <h3 id="connection-heading" className="text-xs font-semibold">
            本地服务
          </h3>
        </div>
        <StatusBadge tone="success">已连接</StatusBadge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        UserHome v{state.appStatus.version}
      </p>
    </section>
  );
}

function RefreshStatus({ state }: { state: RefreshState }) {
  if (state.status === "refreshing") {
    return (
      <section className="px-4 py-4" aria-labelledby="refresh-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="warning" pending />
            <h3 id="refresh-heading" className="text-xs font-semibold">
              数据刷新
            </h3>
          </div>
          <StatusBadge tone="warning">进行中</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs leading-relaxed text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          正在刷新本机状态…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="px-4 py-4" aria-labelledby="refresh-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="warning" />
            <h3 id="refresh-heading" className="text-xs font-semibold">
              数据刷新
            </h3>
          </div>
          <StatusBadge tone="warning">部分完成</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs leading-relaxed text-warning"
          role="status"
        >
          {state.message}
        </p>
      </section>
    );
  }

  if (state.status === "ready") {
    const completedAt = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(state.completedAt));

    return (
      <section className="px-4 py-4" aria-labelledby="refresh-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RailIcon tone="success" />
            <h3 id="refresh-heading" className="text-xs font-semibold">
              数据刷新
            </h3>
          </div>
          <StatusBadge tone="success">已完成</StatusBadge>
        </div>
        <p
          className="mt-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          最近刷新：{completedAt}
        </p>
      </section>
    );
  }

  return (
    <section className="px-4 py-4" aria-labelledby="refresh-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RailIcon tone="neutral" />
          <h3 id="refresh-heading" className="text-xs font-semibold">
            数据刷新
          </h3>
        </div>
        <StatusBadge>等待</StatusBadge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">等待首次刷新</p>
    </section>
  );
}

export function AppShell({ onRefresh, state }: AppShellProps) {
  const hasMounted = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const [activeRouteId, setActiveRouteId] =
    useState<AppRouteId>("dashboard");
  const activeRoute =
    APP_ROUTES.find((route) => route.id === activeRouteId) ?? APP_ROUTES[0];

  useEffect(() => {
    if (hasMounted.current) {
      mainRef.current?.focus();
    } else {
      hasMounted.current = true;
    }
  }, [activeRouteId]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell">
        <header className="titlebar" data-tauri-drag-region>
          <div className="titlebar__brand" data-tauri-drag-region>
            <span
              className="brand-mark"
              aria-hidden="true"
              data-tauri-drag-region
            >
              UH
            </span>
            <div data-tauri-drag-region>
              <p className="brand" data-tauri-drag-region>
                UserHome
              </p>
              <p className="brand-subtitle" data-tauri-drag-region>
                本机配置与应用管理
              </p>
            </div>
          </div>
          <p className="titlebar__context" data-tauri-drag-region>
            本机工作区
          </p>
        </header>

        <div className="workspace">
          <NavigationRail
            activeRouteId={activeRouteId}
            onNavigate={setActiveRouteId}
            routes={APP_ROUTES}
          />

          <main
            ref={mainRef}
            id="main-content"
            className="main-content"
            tabIndex={-1}
          >
            <header className="context-toolbar">
              <div className="page-heading">
                <p className="page-eyebrow">{activeRoute.eyebrow}</p>
                <div className="page-heading__title">
                  <h1>{activeRoute.label}</h1>
                  <span aria-hidden="true">/</span>
                  <p>{activeRoute.description}</p>
                </div>
              </div>
              <div className="refresh-controls">
                <Button
                  className="toolbar-refresh-button"
                  size="sm"
                  disabled={
                    state.preferences.status === "loading" ||
                    state.refresh.status === "refreshing"
                  }
                  onClick={onRefresh}
                  aria-label={
                    state.refresh.status === "refreshing"
                      ? "正在刷新本机状态"
                      : "刷新本机状态"
                  }
                >
                  <svg
                    className={
                      state.refresh.status === "refreshing"
                        ? "animate-spin"
                        : undefined
                    }
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
                  </svg>
                  {state.refresh.status === "refreshing" ? "刷新中" : "刷新"}
                </Button>
              </div>
            </header>

            <div className="workspace-scroll">
              <div className="content-grid">
                <RoutePanel
                  applications={state.applications}
                  discovery={state.discovery}
                  onOperationChanged={onRefresh}
                  route={activeRoute}
                />
                <aside className="status-rail" aria-label="本机状态">
                  <div className="col-span-full overflow-hidden rounded-lg border border-border bg-surface">
                    <header className="border-b border-border px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
                        实时状态
                      </p>
                      <h2 className="mt-1 text-sm font-semibold">系统状态轨</h2>
                    </header>
                    <div className="divide-y divide-border">
                      <PreferencesStatus state={state.preferences} />
                      <DiscoveryStatus state={state.discovery} />
                      <ConnectionStatus state={state.connection} />
                      <RefreshStatus state={state.refresh} />
                      <OperationStatus state={state.recentOperation} />
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
