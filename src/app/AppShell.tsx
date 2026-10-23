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
import {
  registerDeepLinkListener,
  takePendingDeepLink,
} from "../ipc/deepLink";
import type { TranslateFunction } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { useT } from "../i18n/useLocale";
import type { Appearance, UpdatePreferencesRequest } from "../ipc/settings";
import { registerSettingsRequestListener } from "./refreshEvents";
import { validateDeepLinkPayload } from "./deepLink";
import {
  APP_ROUTES,
  activeSectionOf,
  navigationRouteOf,
  routeDescription,
  routeLabel,
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
  dismissLabel,
  label,
  onDismiss,
  role = "status",
  tone,
}: {
  busy?: boolean;
  children: ReactNode;
  dismissLabel?: string;
  label: string;
  onDismiss?: () => void;
  role?: "alert" | "status";
  tone: "danger" | "warning";
}) {
  return (
    <div
      className={`r12-shell-notice flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control border px-ui-12 py-ui-8 text-xs ${
        tone === "danger" ? "border-danger-border" : "border-warning-border"
      }`}
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
      {onDismiss ? (
        <Button className="shrink-0" onClick={onDismiss} size="sm" variant="secondary">
          {dismissLabel}
        </Button>
      ) : null}
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
  const t = useT();
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
        {t("shell.quit.title")}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("shell.quit.body", { processCount: prompt.processCount })}
      </p>
      {prompt.items?.length ? (
        <ul
          aria-label={t("shell.quit.runningItems")}
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
            ? t("shell.quit.stopping")
            : t("shell.quit.quitting")}
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
        <Button data-dialog-cancel disabled={busy} onClick={onCancel} variant="secondary">
          {t("shell.quit.cancel")}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {prompt.phase === "failed" ? t("shell.quit.retry") : t("shell.quit.confirm")}
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

export function AppShell(props: AppShellProps) {
  const preference =
    props.state.preferences.status === "loading"
      ? "system"
      : props.state.preferences.preferences.language;
  return (
    <LocaleProvider preference={preference}>
      <ShellContent {...props} />
    </LocaleProvider>
  );
}

export function ShellContent({
  onAppearanceChange,
  onPreferencesChange,
  onPreferencesReset,
  onRefresh,
  state,
}: AppShellProps) {
  const t: TranslateFunction = useT();
  const [commandError, setCommandError] = useState<string>();
  const [dismissedSafeDefault, setDismissedSafeDefault] = useState<string>();
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
          setCommandError(t("shell.error.menuListener"));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigate, t]);

  const navigateToRef = useRef(navigateTo);
  useEffect(() => {
    navigateToRef.current = navigateTo;
  }, [navigateTo]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const openDeepLink = (payload: unknown) => {
      const intent = validateDeepLinkPayload(payload);
      if (intent) navigateToRef.current(intent);
    };

    void registerDeepLinkListener(openDeepLink)
      .then(
        (cleanup) => {
          if (disposed) {
            cleanup();
          } else {
            unlisten = cleanup;
          }
        },
        () => undefined,
      )
      .then(() => takePendingDeepLink())
      .then(openDeepLink, () => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
          setCommandError(t("shell.error.quitListener"));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [t]);

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
        setCommandError(t("shell.quit.cancelFailed"));
      })
      .finally(closeQuitPrompt);
  }, [closeQuitPrompt, t]);

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
                message: t("shell.quit.unconfirmed", {
                  names: result.unconfirmed.join(t("shell.listSeparator")),
                }),
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
            message: t("shell.quit.failed"),
          };
        }),
      );
  }, [t]);

  const safeDefaultMessage =
    state.preferences.status === "safe-default"
      ? state.preferences.diagnostic.message
      : undefined;
  const preferencesNotice =
    state.preferences.status === "loading" ? (
      <ShellNotice
        busy
        label={t("common.loading")}
        tone="warning"
      >
        {t("shell.preferences.loading")}
      </ShellNotice>
    ) : safeDefaultMessage !== undefined && safeDefaultMessage !== dismissedSafeDefault ? (
      <ShellNotice
        dismissLabel={t("common.close")}
        label={t("shell.preferences.safeDefault")}
        onDismiss={() => setDismissedSafeDefault(safeDefaultMessage)}
        role="alert"
        tone="warning"
      >
        {safeDefaultMessage}
      </ShellNotice>
    ) : undefined;

  // A failed refresh stays visible as a persistent alert with one unified
  // retry action. When the discovery error still holds a previous snapshot,
  // the copy states plainly that previously loaded data is retained.
  const refreshNotice =
    state.refresh.status === "error" ? (
      <div
        className="r12-shell-notice flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control border border-danger-border px-ui-12 py-ui-8 text-xs"
        role="alert"
      >
        <StatusBadge className="shrink-0" tone="danger">
          {t("shell.refresh.failed")}
        </StatusBadge>
        <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-danger">
          {state.refresh.message}
          {state.discovery.status === "error" &&
          state.discovery.previousSnapshot
            ? ` ${t("shell.refresh.retained")}`
            : ""}
        </p>
        <Button className="shrink-0" size="sm" variant="secondary" onClick={onRefresh}>
          {t("common.retry")}
        </Button>
      </div>
    ) : refreshCompletedAt !== undefined && refreshCompletedAt !== dismissedRefreshAt ? (
      <div
        className="r4-fe5-refreshed r12-shell-notice flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control border border-line px-ui-12 py-ui-8 text-xs"
        role="status"
      >
        <StatusBadge className="shrink-0" tone="success">
          {t("shell.refresh.refreshed")}
        </StatusBadge>
        <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-muted-foreground">
          {t("shell.refresh.refreshedDetail")}
        </p>
      </div>
    ) : undefined;

  return (
    <>
      <a className="skip-link" href="#main-content">
        {t("shell.skipToContent")}
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
              activeRouteId={navigationRouteOf(activeRouteId)}
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
              <div className="grid min-w-0 gap-ui-8">
                {commandError ? (
                  <ShellNotice
                    dismissLabel={t("common.close")}
                    label={t("shell.notice.commandUnavailable")}
                    onDismiss={() => setCommandError(undefined)}
                    role="alert"
                    tone="danger"
                  >
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
                  {routeLabel(activeRoute, t)}
                </h1>
                <p className="m-0 mt-ui-2 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                  {routeDescription(activeRoute, t)}
                </p>
              </div>
              <ActionRow>
                <Button
                  className="toolbar-refresh-button"
                  size="md"
                  variant="secondary"
                  disabled={
                    state.preferences.status === "loading" ||
                    state.refresh.status === "refreshing"
                  }
                  onClick={onRefresh}
                  aria-label={
                    state.refresh.status === "refreshing"
                      ? t("shell.refresh.buttonBusy")
                      : t("shell.refresh.button")
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
                  {state.refresh.status === "refreshing"
                    ? t("common.refreshing")
                    : t("common.refresh")}
                </Button>
              </ActionRow>
            </div>
          }
          detailLabel={t("shell.workspace.content", {
            label: routeLabel(activeRoute, t),
          })}
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
