import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { DesktopWorkspace } from "../components/DesktopWorkspace";
import { NavigationRail } from "../components/NavigationRail";
import { Button, StatusBadge } from "../components/ui";
import type { Appearance, UpdatePreferencesRequest } from "../ipc/settings";
import { registerSettingsRequestListener } from "./refreshEvents";
import { APP_ROUTES, type AppRouteId, type NavigationIntent, type NavigationSource } from "./routeDefinitions";
import {
  activeDiscoverySnapshot,
  resolveApplicationsNavigation,
  type ApplicationNavigationContext,
  type StaleApplicationNavigation,
} from "./applicationNavigation";
import { RoutePanel } from "./routes";
import {
  loadSelectionMemory,
  saveSelectionMemory,
  type SelectionMemory,
} from "./selectionMemory";
import type { ShellState } from "./shellState";

interface AppShellProps {
  onAppearanceChange: (appearance: Appearance) => Promise<void>;
  onPreferencesChange?: (patch: UpdatePreferencesRequest) => Promise<void>;
  onPreferencesReset?: () => Promise<void>;
  onRefresh: () => void;
  state: ShellState;
}

function ShellNotice({
  busy = false,
  children,
  label,
  role = "status",
  tone,
}: {
  busy?: boolean;
  children: ReactNode;
  label: string;
  role?: "alert" | "status";
  tone: "danger" | "warning";
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
      role={role}
      aria-busy={busy || undefined}
    >
      <StatusBadge className="shrink-0" tone={tone}>
        {label}
      </StatusBadge>
      <p
        className={`m-0 min-w-0 flex-1 break-words leading-relaxed ${
          tone === "danger" ? "text-danger" : "text-warning"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function clearSearchOnEscape(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }

  const input = event.target;
  if (
    !(input instanceof HTMLInputElement) ||
    input.type !== "search" ||
    input.value.length === 0
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (valueSetter) {
    valueSetter.call(input, "");
  } else {
    input.value = "";
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function suppressTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

export function AppShell({
  onAppearanceChange,
  onPreferencesChange,
  onPreferencesReset,
  onRefresh,
  state,
}: AppShellProps) {
  const [commandError, setCommandError] = useState<string>();
  const pendingNavigationSource = useRef<NavigationSource>("primary-nav");
  // Transient, session-only application navigation context. Candidates and
  // refresh ids validate against a live discovery snapshot; they are never
  // written to selection memory (and so never reach localStorage).
  const [applicationNavigation, setApplicationNavigation] = useState<{
    context?: ApplicationNavigationContext;
    stale?: StaleApplicationNavigation;
  }>({});
  const restoreSelection =
    state.preferences.status !== "loading" &&
    state.preferences.preferences.restoreSelection;
  const [selection, setSelection] = useState<SelectionMemory>(() =>
    loadSelectionMemory(restoreSelection),
  );
  const activeRouteId = selection.routeId;
  const settingsGroup = selection.settingsGroup;
  const activeRoute =
    APP_ROUTES.find((route) => route.id === activeRouteId) ?? APP_ROUTES[0];

  useEffect(() => {
    if (pendingNavigationSource.current === "primary-nav") return;
    document.getElementById("main-content")?.focus({ preventScroll: true });
    pendingNavigationSource.current = "primary-nav";
  }, [activeRouteId]);

  useEffect(() => {
    saveSelectionMemory(restoreSelection, selection);
  }, [restoreSelection, selection]);

  const updateSelection = useCallback((patch: Partial<SelectionMemory>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  const navigate = useCallback((
    routeId: AppRouteId,
    source: NavigationSource = "primary-nav",
  ) => {
    pendingNavigationSource.current = source;
    updateSelection({ routeId });
  }, [updateSelection]);

  const navigateTo = useCallback((intent: NavigationIntent) => {
    pendingNavigationSource.current = intent.source ?? "content";
    if (intent.routeId === "applications") {
      const resolved = resolveApplicationsNavigation(
        intent,
        activeDiscoverySnapshot(state.discovery),
      );
      // A catalog navigation clears any transient local candidate context; a
      // stale local navigation drops the candidate selection so no ghost
      // selection is produced.
      setApplicationNavigation({
        ...(resolved.context ? { context: resolved.context } : {}),
        ...(resolved.stale ? { stale: resolved.stale } : {}),
      });
      if (resolved.scope === "CATALOG") {
        const applicationKey = intent.applicationId
          ? `catalog:${intent.applicationId}`
          : undefined;
        const applicationConfigIds =
          intent.applicationId && intent.configId
            ? { ...selection.applicationConfigIds, [intent.applicationId]: intent.configId }
            : selection.applicationConfigIds;
        updateSelection({
          routeId: intent.routeId,
          applicationsScope: "CATALOG",
          ...(applicationKey ? { applicationKey } : {}),
          applicationConfigIds,
        });
        return;
      }
      // Local scope keeps the recognized list; the candidate itself lives only
      // in transient state and is forwarded to the applications workspace.
      updateSelection({
        routeId: intent.routeId,
        applicationsScope: "LOCAL_RECOGNIZED",
      });
      return;
    }
    if (intent.routeId === "services") {
      updateSelection({
        routeId: intent.routeId,
        ...(intent.serviceId ? { serviceId: intent.serviceId } : {}),
      });
      return;
    }
    if (intent.routeId === "settings") {
      updateSelection({
        routeId: intent.routeId,
        ...(intent.group ? { settingsGroup: intent.group } : {}),
      });
      return;
    }
    updateSelection({ routeId: intent.routeId });
  }, [selection.applicationConfigIds, state.discovery, updateSelection]);

  // When a refresh removes the currently selected candidate, derive a stale
  // context (rather than mutating state in an effect) so the workspace never
  // shows a vanished candidate.
  const activeSnapshot = activeDiscoverySnapshot(state.discovery);
  const effectiveApplicationNavigation = useMemo(() => {
    const context = applicationNavigation.context;
    if (!context?.candidateId) {
      return applicationNavigation;
    }
    const resolved = resolveApplicationsNavigation(
      {
        routeId: "applications",
        scope: "LOCAL_RECOGNIZED",
        candidateId: context.candidateId,
        sourceRefreshId: context.sourceRefreshId,
      },
      activeSnapshot,
    );
    return {
      ...(resolved.context ? { context: resolved.context } : {}),
      ...(resolved.stale ? { stale: resolved.stale } : {}),
    };
  }, [activeSnapshot, applicationNavigation]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void registerSettingsRequestListener(() => {
      setCommandError(undefined);
      navigate("settings", "menu");
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch(() => {
        if (!disposed) {
          setCommandError("无法监听应用菜单命令。");
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate]);

  const preferencesNotice =
    state.preferences.status === "loading" ? (
      <ShellNotice
        busy
        label="加载中"
        tone="warning"
      >
        正在加载本机偏好设置…
      </ShellNotice>
    ) : state.preferences.status === "safe-default" ? (
      <ShellNotice label="安全默认值" role="alert" tone="warning">
        {state.preferences.diagnostic.message}
      </ShellNotice>
    ) : undefined;

  // A failed refresh stays visible as a persistent alert with one unified
  // retry action. When the discovery error still holds a previous snapshot,
  // the copy states plainly that previously loaded data is retained.
  const refreshNotice =
    state.refresh.status === "error" ? (
      <div
        className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
        role="alert"
      >
        <StatusBadge className="shrink-0" tone="danger">
          刷新未完成
        </StatusBadge>
        <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-danger">
          {state.refresh.message}
          {state.discovery.status === "error" &&
          state.discovery.previousSnapshot
            ? " 已保留上次成功加载的数据。"
            : ""}
        </p>
        <Button className="shrink-0" size="sm" onClick={onRefresh}>
          重试
        </Button>
      </div>
    ) : state.refresh.status === "ready" ? (
      <div
        className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
        role="status"
      >
        <StatusBadge className="shrink-0" tone="success">
          已刷新
        </StatusBadge>
        <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-muted-foreground">
          本机状态已刷新。
        </p>
      </div>
    ) : undefined;

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell" onKeyDownCapture={clearSearchOnEscape}>
        <header
          className="titlebar"
          data-tauri-drag-region
          onDoubleClick={suppressTitlebarDoubleClick}
        >
          <p className="titlebar__title" data-tauri-drag-region>
            <span data-tauri-drag-region>UserHome</span>
          </p>
        </header>

        <DesktopWorkspace
          sidebar={
            <NavigationRail
              activeRouteId={activeRouteId}
              connection={state.connection}
              onNavigate={navigate}
              routes={APP_ROUTES}
            />
          }
          banner={
            commandError || preferencesNotice || refreshNotice ? (
              <div className="divide-y divide-border">
                {commandError ? (
                  <ShellNotice label="命令不可用" role="alert" tone="danger">
                    {commandError}
                  </ShellNotice>
                ) : null}
                {preferencesNotice}
                {refreshNotice}
              </div>
            ) : undefined
          }
          toolbar={
            <div className="flex w-full min-w-0 items-center justify-between gap-ui-xl">
              <div className="min-w-0 flex-1">
                <h1 className="desktop-workspace__page-title">
                  {activeRoute.label}
                </h1>
                <p className="m-0 mt-ui-xxs min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                  {activeRoute.description}
                </p>
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
            </div>
          }
          detailLabel={`${activeRoute.label}内容`}
          detail={
            <RoutePanel
              applicationNavigation={effectiveApplicationNavigation}
              applications={state.applications}
              applicationsScope={selection.applicationsScope}
              connection={state.connection}
              discovery={state.discovery}
              onAppearanceChange={onAppearanceChange}
              onNavigate={navigateTo}
              onOperationChanged={onRefresh}
              onPreferencesChange={
                onPreferencesChange ??
                (() =>
                  Promise.reject(
                    new Error("Preference updates are unavailable."),
                  ))
              }
              onPreferencesReset={
                onPreferencesReset ??
                (() =>
                  Promise.reject(
                    new Error("Preference reset is unavailable."),
                  ))
              }
              onSelectionChange={updateSelection}
              onSettingsGroupChange={(group) =>
                updateSelection({ settingsGroup: group })
              }
              preferences={state.preferences}
              recentOperation={state.recentOperation}
              refresh={state.refresh}
              route={activeRoute}
              selection={selection}
              settingsGroup={settingsGroup}
            />
          }
        />
      </div>
    </>
  );
}
