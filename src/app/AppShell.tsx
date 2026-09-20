import { useEffect, useRef, useState } from "react";
import { NavigationRail } from "../components/NavigationRail";
import { Button } from "../components/ui";
import { OperationStatus } from "../features/operations/OperationStatus";
import { APP_ROUTES, type AppRouteId } from "./routeDefinitions";
import { RoutePanel } from "./routes";
import type { ConnectionState, RefreshState, ShellState } from "./shellState";

interface AppShellProps {
  onRefresh: () => void;
  state: ShellState;
}

function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state.status === "loading") {
    return (
      <section className="status-card" aria-labelledby="connection-heading">
        <div className="status-card__heading">
          <h2 id="connection-heading">本地服务</h2>
          <span className="status-dot status-dot--pending" aria-hidden="true" />
        </div>
        <p role="status" aria-live="polite" aria-busy="true">
          正在连接本地服务…
        </p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="status-card" aria-labelledby="connection-heading">
        <div className="status-card__heading">
          <h2 id="connection-heading">本地服务</h2>
          <span className="status-dot status-dot--error" aria-hidden="true" />
        </div>
        <p role="alert">{state.error.message}</p>
        <p className="status-note">
          {state.error.retryable
            ? "可从托盘选择 Refresh 后重试。"
            : "请检查应用状态后重试。"}
        </p>
      </section>
    );
  }

  return (
    <section className="status-card" aria-labelledby="connection-heading">
      <div className="status-card__heading">
        <h2 id="connection-heading">本地服务</h2>
        <span className="status-dot status-dot--ok" aria-hidden="true" />
      </div>
      <p>连接正常</p>
      <p className="status-note">UserHome v{state.appStatus.version}</p>
    </section>
  );
}

function RefreshStatus({ state }: { state: RefreshState }) {
  if (state.status === "refreshing") {
    return (
      <p
        className="refresh-status"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        正在刷新本机状态…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p className="refresh-status refresh-status--warning" role="status">
        {state.message}
      </p>
    );
  }

  if (state.status === "ready") {
    const completedAt = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(state.completedAt));

    return (
      <p className="refresh-status" role="status" aria-live="polite">
        最近刷新：{completedAt}
      </p>
    );
  }

  return <p className="refresh-status">等待首次刷新</p>;
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
                <RefreshStatus state={state.refresh} />
                <Button
                  className="toolbar-refresh-button"
                  size="sm"
                  disabled={state.refresh.status === "refreshing"}
                  onClick={onRefresh}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
                  </svg>
                  刷新
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
                  <ConnectionStatus state={state.connection} />
                  <OperationStatus state={state.recentOperation} />
                </aside>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
