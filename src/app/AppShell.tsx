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
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DesktopWorkspace } from "../components/DesktopWorkspace";
import { NavigationRail } from "../components/NavigationRail";
import { ActionRow, Button, StatusBadge } from "../components/ui";
import { GrantStoreNotice } from "../features/grants/GrantStoreNotice";
import { isGrantStoreNoticeVisible } from "../features/grants/grantStoreController";
import { useGrantStoreNotice } from "../features/grants/useGrantStoreNotice";
import {
  cancelQuit,
  confirmQuit,
  registerQuitConfirmationListener,
} from "../ipc/lifecycle";
import type { Appearance, UpdatePreferencesRequest } from "../ipc/settings";
import { registerSettingsRequestListener } from "./refreshEvents";
import {
  APP_ROUTES,
  activeSectionOf,
  type AppRouteId,
  type NavigationIntent,
  type NavigationSource,
  type ServiceFocus,
} from "./routeDefinitions";
import { RoutePanel } from "./routes";
import {
  loadSelectionMemory,
  saveSelectionMemory,
  type SelectionMemory,
} from "./selectionMemory";
import { SectionContext, type SectionContextValue } from "./SectionContext";
import type { ShellState } from "./shellState";

const REFRESHED_NOTICE_MS = 3000;

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
      className="flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-16 py-ui-8 text-xs"
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

export type QuitPrompt = {
  /** Names of the running items, so the user sees what "stop and quit" will stop. */
  items?: readonly string[];
} & (
  | { phase: "asking"; processCount: number }
  | { phase: "stopping"; processCount: number }
  | { phase: "quitting"; processCount: number }
  | { phase: "failed"; processCount: number; message: string }
);

/**
 * Asked when the app is quit while it still runs processes it started. Nothing is
 * stopped until "停止并退出"; cancel is the focused default.
 */
export function QuitConfirmationDialog({
  onCancel,
  onConfirm,
  prompt,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  prompt: QuitPrompt;
}) {
  const busy = prompt.phase === "stopping" || prompt.phase === "quitting";
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="quit-confirmation-heading"
    >
      <h3
        className="break-words [overflow-wrap:anywhere]"
        id="quit-confirmation-heading"
      >
        退出 UserHome？
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        UserHome 仍有 {prompt.processCount} 个由它启动的进程在运行。
        “停止并退出”会先停止这些进程，确认全部已退出后才退出应用；
        “取消退出”不会改变任何内容。
      </p>
      {prompt.items?.length ? (
        <ul
          aria-label="仍在运行的项目"
          className="m-0 flex list-none flex-col gap-ui-4 p-0 text-sm text-foreground"
        >
          {prompt.items.map((item) => (
            <li
              className="flex min-w-0 gap-ui-4 break-words [overflow-wrap:anywhere]"
              key={item}
            >
              <span aria-hidden="true" className="shrink-0 text-muted-foreground">
                ●
              </span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {prompt.phase === "stopping" || prompt.phase === "quitting" ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {prompt.phase === "stopping"
            ? "正在停止进程并等待其退出…"
            : "进程已全部退出，正在退出应用…"}
        </p>
      ) : null}
      {prompt.phase === "failed" ? (
        <p
          className="break-words rounded-control border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger [overflow-wrap:anywhere]"
          role="alert"
        >
          {prompt.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-dialog-cancel disabled={busy} onClick={onCancel}>
          取消退出
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {prompt.phase === "failed" ? "重试停止并退出" : "停止并退出"}
        </Button>
      </div>
    </ConfirmDialog>
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
  const grantStore = useGrantStoreNotice();
  const grantStoreVisible = isGrantStoreNoticeVisible(grantStore.state);
  const [quitPrompt, setQuitPrompt] = useState<QuitPrompt>();
  const refreshCompletedAt =
    state.refresh.status === "ready" ? state.refresh.completedAt : undefined;
  const [dismissedRefreshAt, setDismissedRefreshAt] = useState<string>();
  const quitReturnFocus = useRef<HTMLElement | null>(null);
  const pendingNavigationSource = useRef<NavigationSource>("primary-nav");
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
  const [sectionByRoute, setSectionByRoute] = useState<
    Partial<Record<AppRouteId, string>>
  >({});
  const activeSectionId = activeSectionOf(activeRoute, sectionByRoute[activeRoute.id])?.id;
  const selectSection = useCallback((routeId: AppRouteId, section: string) => {
    setSectionByRoute((current) => ({ ...current, [routeId]: section }));
  }, [setSectionByRoute]);
  const sectionContext = useMemo<SectionContextValue | undefined>(
    () =>
      activeSectionId === undefined
        ? undefined
        : {
            section: activeSectionId,
            select: (section) => selectSection(activeRoute.id, section),
          },
    [activeRoute.id, activeSectionId, selectSection],
  );
  useEffect(() => {
    if (pendingNavigationSource.current === "primary-nav") return;
    document.getElementById("main-content")?.focus({ preventScroll: true });
    pendingNavigationSource.current = "primary-nav";
  }, [activeRouteId]);

  useEffect(() => {
    saveSelectionMemory(restoreSelection, selection);
  }, [restoreSelection, selection]);

  useEffect(() => {
    if (refreshCompletedAt === undefined) return;
    const timer = window.setTimeout(
      () => setDismissedRefreshAt(refreshCompletedAt),
      REFRESHED_NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [refreshCompletedAt]);

  const updateSelection = useCallback((patch: Partial<SelectionMemory>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  const [serviceFocus, setServiceFocus] = useState<ServiceFocus | undefined>(undefined);

  const navigate = useCallback((
    routeId: AppRouteId,
    source: NavigationSource = "primary-nav",
  ) => {
    pendingNavigationSource.current = source;
    setServiceFocus(undefined);
    updateSelection({ routeId });
  }, [updateSelection]);

  const navigateTo = useCallback((intent: NavigationIntent) => {
    pendingNavigationSource.current = intent.source ?? "content";
    if ("section" in intent && intent.section !== undefined) {
      selectSection(intent.routeId, intent.section);
      if (intent.routeId === activeRouteId) return;
    }
    if (intent.routeId === "services") {
      setServiceFocus(intent.serviceFocus);
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
    setServiceFocus(undefined);
    updateSelection({ routeId: intent.routeId });
  }, [activeRouteId, selectSection, updateSelection]);

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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void registerQuitConfirmationListener(({ processCount, items }) => {
      if (document.activeElement instanceof HTMLElement) {
        quitReturnFocus.current = document.activeElement;
      }
      setQuitPrompt({ phase: "asking", processCount, items });
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
          setCommandError("无法监听应用退出请求。");
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const closeQuitPrompt = useCallback(() => {
    setQuitPrompt(undefined);
    const target = quitReturnFocus.current;
    quitReturnFocus.current = null;
    window.setTimeout(() => {
      (target?.isConnected
        ? target
        : document.getElementById("main-content")
      )?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const cancelQuitPrompt = useCallback(() => {
    void cancelQuit()
      .catch(() => {
        setCommandError("无法取消退出请求。");
      })
      .finally(closeQuitPrompt);
  }, [closeQuitPrompt]);

  const confirmQuitPrompt = useCallback(() => {
    setQuitPrompt((current) =>
      current
        ? {
            phase: "stopping",
            processCount: current.processCount,
            items: current.items,
          }
        : current,
    );
    void confirmQuit()
      .then((result) =>
        setQuitPrompt((current) => {
          const processCount = current?.processCount ?? 0;
          const items = current?.items;
          return result.status === "QUITTING"
            ? { phase: "quitting", processCount, items }
            : {
                phase: "failed",
                processCount,
                items,
                message: `应用未退出：无法确认以下进程已退出：${result.unconfirmed.join("、")}。它们可能仍在运行。`,
              };
        }),
      )
      .catch(() =>
        setQuitPrompt((current) => {
          const processCount = current?.processCount ?? 0;
          return {
            phase: "failed",
            processCount,
            items: current?.items,
            message: "无法完成退出请求，应用未退出。",
          };
        }),
      );
  }, []);

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
        className="flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-16 py-ui-8 text-xs"
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
    ) : refreshCompletedAt !== undefined && refreshCompletedAt !== dismissedRefreshAt ? (
      <div
        className="r4-fe5-refreshed flex min-w-0 flex-wrap items-center gap-ui-8 px-ui-16 py-ui-8 text-xs"
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
      {quitPrompt ? (
        <QuitConfirmationDialog
          onCancel={cancelQuitPrompt}
          onConfirm={confirmQuitPrompt}
          prompt={quitPrompt}
        />
      ) : null}
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
            commandError ||
            preferencesNotice ||
            refreshNotice ||
            grantStoreVisible ? (
              <div className="divide-y divide-border">
                {commandError ? (
                  <ShellNotice label="命令不可用" role="alert" tone="danger">
                    {commandError}
                  </ShellNotice>
                ) : null}
                {grantStoreVisible ? (
                  <GrantStoreNotice
                    controller={grantStore.controller}
                    state={grantStore.state}
                  />
                ) : null}
                {preferencesNotice}
                {refreshNotice}
              </div>
            ) : undefined
          }
          toolbar={
            <div className="flex w-full min-w-0 items-center justify-between gap-ui-12">
              <div className="min-w-0 flex-1">
                <h1 className="desktop-workspace__page-title">
                  {activeRoute.label}
                </h1>
                <p className="m-0 mt-ui-2 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                  {activeRoute.description}
                </p>
              </div>
              <ActionRow>
                <Button
                  className="toolbar-refresh-button"
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
              </ActionRow>
            </div>
          }
          detailLabel={`${activeRoute.label}内容`}
          detail={
            <SectionContext.Provider value={sectionContext}>
              <RoutePanel
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
                serviceFocus={serviceFocus}
                route={activeRoute}
                selection={selection}
                settingsGroup={settingsGroup}
              />
            </SectionContext.Provider>
          }
        />
      </div>
    </>
  );
}
