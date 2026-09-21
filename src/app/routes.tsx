import { ApplicationsPage } from "../features/apps/ApplicationsPage";
import { BrewInventoryPage } from "../features/brew/BrewInventoryPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import type { SettingsGroupId } from "../features/settings/settingsGroups";
import type {
  Appearance,
  UpdatePreferencesRequest,
} from "../ipc/settings";
import type {
  ApplicationsState,
  ConnectionState,
  DiscoveryState,
  PreferencesState,
  RecentOperationState,
  RefreshState,
} from "./shellState";
import type { AppRoute } from "./routeDefinitions";
import type { SelectionMemory } from "./selectionMemory";

interface RoutePanelProps {
  applications: ApplicationsState;
  connection: ConnectionState;
  discovery: DiscoveryState;
  onAppearanceChange: (appearance: Appearance) => Promise<void>;
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
  applications,
  connection,
  discovery,
  onAppearanceChange,
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
        refresh={refresh}
        recentOperation={recentOperation}
        state={discovery}
      />
    );
  }

  if (route.id === "applications") {
    return (
      <ApplicationsPage
        candidates={
          discovery.status === "ready"
            ? discovery.snapshot.candidates
            : discovery.status === "error"
              ? {
                  status: "ERROR",
                  error: {
                    module: "candidates",
                    message: discovery.error.message,
                    retryable: discovery.error.retryable,
                  },
                }
              : { status: "LOADING" }
        }
        state={applications}
        initialSelectedConfigIds={selection.applicationConfigIds}
        initialSelectedKey={selection.applicationKey}
        onSelectedConfigChange={(applicationId, configId) => {
          const next = { ...selection.applicationConfigIds };
          if (configId) {
            next[applicationId] = configId;
          } else {
            delete next[applicationId];
          }
          onSelectionChange({ applicationConfigIds: next });
        }}
        onSelectedKeyChange={(applicationKey) =>
          onSelectionChange({ applicationKey })
        }
        onOperationChanged={onOperationChanged}
        preferredEditorMode={
          preferences.status === "loading"
            ? "STRUCTURED"
            : preferences.preferences.preferredEditorMode
        }
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
      />
    );
  }

  if (route.id === "homebrew") {
    return (
      <BrewInventoryPage
        initialSelection={selection.brewSelection}
        onSelectionChange={(brewSelection) =>
          onSelectionChange({ brewSelection })
        }
        onOperationChanged={onOperationChanged}
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
        summary={
          discovery.status === "ready"
            ? discovery.snapshot.brew
            : { status: "LOADING" }
        }
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
        onOperationChanged={onOperationChanged}
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
      />
    );
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
