import { BrewInventoryPage } from "../features/brew/BrewInventoryPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EnvironmentPage } from "../features/environment/EnvironmentPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ToolsPage } from "../features/tools/ToolsPage";
import { Button, StatusBadge } from "../components/ui";
import type { SettingsGroupId } from "../features/settings/settingsGroups";
import type {
  Appearance,
  UpdatePreferencesRequest,
} from "../ipc/settings";
import type {
  ConnectionState,
  DiscoveryState,
  PreferencesState,
  RecentOperationState,
  RefreshState,
} from "./shellState";
import type {
  AppRoute,
  NavigationIntent,
} from "./routeDefinitions";
import { selectBrewSummary } from "./brewDiscoverySelector";
import type { SelectionMemory } from "./selectionMemory";

interface RoutePanelProps {
  connection: ConnectionState;
  discovery: DiscoveryState;
  onAppearanceChange: (appearance: Appearance) => Promise<void>;
  onNavigate: (intent: NavigationIntent) => void;
  onOperationChanged: () => void;
  onPreferencesChange: (patch: UpdatePreferencesRequest) => Promise<void>;
  onPreferencesReset: () => Promise<void>;
  onSelectionChange: (patch: Partial<SelectionMemory>) => void;
  onSettingsGroupChange: (group: SettingsGroupId) => void;
  preferences: PreferencesState;
  recentOperation: RecentOperationState;
  refresh: RefreshState;
  route: AppRoute;
  selection: SelectionMemory;
  settingsGroup: SettingsGroupId;
}

export function RoutePanel({
  connection,
  discovery,
  onAppearanceChange,
  onNavigate,
  onOperationChanged,
  onPreferencesChange,
  onPreferencesReset,
  onSelectionChange,
  onSettingsGroupChange,
  preferences,
  recentOperation,
  refresh,
  route,
  selection,
  settingsGroup,
}: RoutePanelProps) {
  if (route.id === "dashboard") {
    return (
      <DashboardPage
        connection={connection}
        onNavigate={onNavigate}
        onRefresh={onOperationChanged}
        optionalDiscoveryRoots={
          preferences.status === "loading"
            ? undefined
            : preferences.preferences.optionalDiscoveryRoots
        }
        refresh={refresh}
        recentOperation={recentOperation}
        state={discovery}
      />
    );
  }

  if (route.id === "homebrew") {
    const brewView = selectBrewSummary(discovery);
    // Ready and stale views hand the real (or retained) module to the page so
    // previously loaded data never disappears; only a failure without any
    // snapshot becomes a hard provider error.
    const summary =
      brewView.status === "ready" || brewView.status === "stale"
        ? brewView.module
        : brewView.status === "loading"
          ? { status: "LOADING" as const }
          : {
              status: "ERROR" as const,
              error: {
                module: "brew",
                message: brewView.error.message,
                retryable: brewView.error.retryable,
              },
            };
    const refreshId =
      brewView.status === "ready" || brewView.status === "stale"
        ? brewView.refreshId
        : undefined;
    const providerNotice =
      brewView.status === "stale" ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
          role="alert"
        >
          <StatusBadge className="shrink-0" tone="warning">
            数据可能过时
          </StatusBadge>
          <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-warning">
            {brewView.error.message} 正在显示上次成功刷新保留的 Homebrew 数据。
          </p>
          <Button className="shrink-0" size="sm" onClick={onOperationChanged}>
            重试
          </Button>
        </div>
      ) : brewView.status === "error" ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
          role="alert"
        >
          <StatusBadge className="shrink-0" tone="danger">
            获取失败
          </StatusBadge>
          <p className="m-0 min-w-0 flex-1 break-words leading-relaxed text-danger">
            {brewView.error.message}
          </p>
          <Button className="shrink-0" size="sm" onClick={onOperationChanged}>
            重试
          </Button>
        </div>
      ) : undefined;

    return (
      <>
        {providerNotice}
        <BrewInventoryPage
          initialSelection={selection.brewSelection}
          onSelectionChange={(brewSelection) =>
            onSelectionChange({ brewSelection })
          }
          onOperationChanged={onOperationChanged}
          refreshId={refreshId}
          summary={summary}
        />
      </>
    );
  }

  if (route.id === "services") {
    return (
      <ServicesPage
        initialSelectedServiceId={selection.serviceId}
        onSelectedServiceChange={(serviceId) =>
          onSelectionChange({ serviceId })
        }
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
      />
    );
  }

  if (route.id === "environment") {
    return <EnvironmentPage />;
  }

  if (route.id === "tools") {
    return <ToolsPage />;
  }

  if (route.id === "settings") {
    return (
      <SettingsPage
        onAppearanceChange={onAppearanceChange}
        onDiscoveryRefresh={onOperationChanged}
        onPreferencesChange={onPreferencesChange}
        onPreferencesReset={onPreferencesReset}
        onSelectedGroupChange={onSettingsGroupChange}
        preferences={preferences}
        selectedGroup={settingsGroup}
      />
    );
  }

  return (
    <section className="placeholder-panel" aria-labelledby="placeholder-heading">
      <p className="section-kicker">即将提供</p>
      <h2 id="placeholder-heading">{route.label}功能尚未实现</h2>
      <p>{route.description} 此页面会在后续任务中逐步开放。</p>
    </section>
  );
}
