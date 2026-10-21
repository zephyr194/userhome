import { AiConfigPage } from "../features/ai-config/AiConfigPage";
import { AppConfigPage } from "../features/app-config/AppConfigPage";
import { CaddyPage } from "../features/caddy/CaddyPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EnvironmentPage } from "../features/environment/EnvironmentPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ToolsPage } from "../features/tools/ToolsPage";
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

  if (route.id === "caddy") {
    return <CaddyPage />;
  }

  if (route.id === "appConfig") {
    return <AppConfigPage />;
  }

  if (route.id === "aiConfig") {
    return <AiConfigPage />;
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
