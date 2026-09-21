import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import { DesktopWorkspace } from "../components/DesktopWorkspace";
import { NavigationRail } from "../components/NavigationRail";
import { Button } from "../components/ui";
import type { Appearance } from "../ipc/settings";
import type { UpdatePreferencesRequest } from "../ipc/settings";
import { registerSettingsRequestListener } from "./refreshEvents";
import { APP_ROUTES, type AppRouteId } from "./routeDefinitions";
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
  onRefresh: () => void;
  state: ShellState;
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

export function AppShell({
  onAppearanceChange,
  onPreferencesChange,
  onRefresh,
  state,
}: AppShellProps) {
  const [commandError, setCommandError] = useState<string>();
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
    saveSelectionMemory(restoreSelection, selection);
  }, [restoreSelection, selection]);

  const updateSelection = useCallback((patch: Partial<SelectionMemory>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  const navigate = useCallback((routeId: AppRouteId) => {
    updateSelection({ routeId });
  }, [updateSelection]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void registerSettingsRequestListener(() => {
      setCommandError(undefined);
      navigate("settings");
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
      <p
        className="m-0 px-4 py-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        正在加载本机偏好设置…
      </p>
    ) : state.preferences.status === "safe-default" ? (
      <p className="m-0 px-4 py-2 text-xs text-warning" role="alert">
        安全默认值：{state.preferences.diagnostic.message}
      </p>
    ) : undefined;

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell" onKeyDownCapture={clearSearchOnEscape}>
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
            </div>
          </div>
          <h1 className="titlebar__context" data-tauri-drag-region>
            {activeRoute.label}
          </h1>
        </header>

        <DesktopWorkspace
          sidebar={
            <NavigationRail
              activeRouteId={activeRouteId}
              onNavigate={navigate}
              routes={APP_ROUTES}
            />
          }
          banner={
            commandError || preferencesNotice ? (
              <div className="divide-y divide-border">
                {commandError ? (
                  <p className="m-0 px-4 py-2 text-xs text-danger" role="alert">
                    {commandError}
                  </p>
                ) : null}
                {preferencesNotice}
              </div>
            ) : undefined
          }
          toolbar={
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
          }
          detailLabel={`${activeRoute.label}内容`}
          detail={
            <RoutePanel
              applications={state.applications}
              connection={state.connection}
              discovery={state.discovery}
              onAppearanceChange={onAppearanceChange}
              onOperationChanged={onRefresh}
              onPreferencesChange={
                onPreferencesChange ??
                (() =>
                  Promise.reject(
                    new Error("Preference updates are unavailable."),
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
