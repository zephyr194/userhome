import { ApplicationsPage } from "../features/apps/ApplicationsPage";
import { BrewInventoryPage } from "../features/brew/BrewInventoryPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { EnvironmentPage } from "../features/environment/EnvironmentPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { Button, StatusBadge } from "../components/ui";
import type { SettingsGroupId } from "../features/settings/settingsGroups";
import type {
  Appearance,
  UpdatePreferencesRequest,
} from "../ipc/settings";
import type { AppError } from "../ipc/core";
import type {
  ApplicationsState,
  ConnectionState,
  DiscoveryState,
  PreferencesState,
  RecentOperationState,
  RefreshState,
} from "./shellState";
import type {
  AppRoute,
  ApplicationsScope,
  NavigationIntent,
} from "./routeDefinitions";
import {
  activeDiscoverySnapshot,
  candidateSelectionKey,
  type ApplicationNavigationContext,
  type StaleApplicationNavigation,
} from "./applicationNavigation";
import { selectBrewSummary } from "./brewDiscoverySelector";
import type { SelectionMemory } from "./selectionMemory";

function detectedApplicationIds(
  discovery: DiscoveryState,
): readonly string[] | undefined {
  const snapshot = activeDiscoverySnapshot(discovery);
  if (!snapshot || snapshot.system.status !== "READY") {
    return undefined;
  }
  return snapshot.system.data.applications
    .filter((application) => application.status !== "ABSENT")
    .map((application) => application.appId);
}

function applicationDetectionError(
  discovery: DiscoveryState,
): AppError | undefined {
  if (discovery.status === "error") {
    return discovery.error;
  }
  if (
    discovery.status === "ready" &&
    discovery.snapshot.system.status === "ERROR"
  ) {
    return {
      code: "PARTIAL_FAILURE",
      message: discovery.snapshot.system.error.message,
      retryable: discovery.snapshot.system.error.retryable,
    };
  }
  return undefined;
}

interface RoutePanelProps {
  applicationNavigation?: {
    context?: ApplicationNavigationContext;
    stale?: StaleApplicationNavigation;
  };
  applications: ApplicationsState;
  applicationsScope: ApplicationsScope;
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
  applicationNavigation,
  applications,
  applicationsScope,
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

  if (route.id === "applications") {
    return (
      <ApplicationsPage
        applicationsScope={applicationsScope}
        candidates={
          activeDiscoverySnapshot(discovery)?.candidates ??
          (discovery.status === "error"
            ? {
                status: "ERROR",
                error: {
                  module: "candidates",
                  message: discovery.error.message,
                  retryable: discovery.error.retryable,
                },
              }
            : { status: "LOADING" })
        }
        candidateId={applicationNavigation?.context?.candidateId}
        sourceRefreshId={applicationNavigation?.context?.sourceRefreshId}
        staleReason={applicationNavigation?.stale?.reason}
        state={applications}
        detectedAppIds={detectedApplicationIds(discovery)}
        detectionError={applicationDetectionError(discovery)}
        initialSelectedConfigIds={selection.applicationConfigIds}
        initialSelectedKey={
          applicationNavigation?.context?.candidateId
            ? candidateSelectionKey(applicationNavigation.context.candidateId)
            : selection.applicationKey
        }
        initialQuery={selection.applicationQuery}
        initialCategory={selection.applicationCategory}
        initialCoverage={selection.applicationCoverage}
        initialCapability={selection.applicationCapability}
        initialDetected={selection.applicationDetected}
        initialPage={selection.applicationPage}
        initialScrollTop={selection.applicationScrollTop}
        onApplicationsScopeChange={(applicationsScope) =>
          onSelectionChange({ applicationsScope })
        }
        onBrowseStateChange={(browseState) =>
          onSelectionChange({
            applicationQuery: browseState.query,
            applicationCategory: browseState.category,
            applicationCoverage: browseState.coverageClass,
            applicationCapability: browseState.capability,
            applicationDetected: browseState.detected,
            applicationPage: browseState.page,
            applicationScrollTop: browseState.scrollTop,
          })
        }
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
        refreshId={activeDiscoverySnapshot(discovery)?.refreshId}
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
        onOperationChanged={onOperationChanged}
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
