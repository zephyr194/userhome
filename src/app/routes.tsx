import { AiConfigPage } from "../features/ai-config/AiConfigPage";
import { AppConfigPage } from "../features/app-config/AppConfigPage";
import { CaddyPage } from "../features/caddy/CaddyPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EnvironmentPage } from "../features/environment/EnvironmentPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SystemToolsPage } from "../features/system-tools/SystemToolsPage";
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
import {
  routeDescription,
  routeLabel,
  type AppRoute,
  type NavigationIntent,
  type ServiceFocus,
} from "./routeDefinitions";
import { useT } from "../i18n/useLocale";
import { RouteNavigationContext } from "./routeNavigation";
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
  serviceFocus?: ServiceFocus;
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
  refresh,
  route,
  selection,
  serviceFocus,
  settingsGroup,
}: RoutePanelProps) {
  const t = useT();
  if (route.id === "dashboard") {
    return (
      <DashboardPage
        connection={connection}
        onNavigate={onNavigate}
        refresh={refresh}
        state={discovery}
      />
    );
  }

  if (route.id === "services") {
    return (
      <ServicesPage
        initialFocus={serviceFocus}
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
    return (
      <RouteNavigationContext.Provider value={onNavigate}>
        <CaddyPage />
      </RouteNavigationContext.Provider>
    );
  }

  if (route.id === "systemTools") {
    return <SystemToolsPage onOpen={(routeId) => onNavigate({ routeId })} />;
  }

  if (route.id === "appConfig") {
    return (
      <AppConfigPage
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
      />
    );
  }

  if (route.id === "aiConfig") {
    return (
      <AiConfigPage
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
      />
    );
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
      <p className="section-kicker">{t("shell.placeholder.kicker")}</p>
      <h2 id="placeholder-heading">{t("shell.placeholder.title", { label: routeLabel(route, t) })}</h2>
      <p>{t("shell.placeholder.body", { description: routeDescription(route, t) })}</p>
    </section>
  );
}
