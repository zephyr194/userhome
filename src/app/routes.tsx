import { ApplicationsPage } from "../features/apps/ApplicationsPage";
import { BrewInventoryPage } from "../features/brew/BrewInventoryPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ServicesPage } from "../features/services/ServicesPage";
import type { ApplicationsState, DiscoveryState } from "./shellState";
import type { AppRoute } from "./routeDefinitions";

interface RoutePanelProps {
  applications: ApplicationsState;
  discovery: DiscoveryState;
  onOperationChanged: () => void;
  route: AppRoute;
}

export function RoutePanel({
  applications,
  discovery,
  onOperationChanged,
  route,
}: RoutePanelProps) {
  if (route.id === "dashboard") {
    return <DashboardPage state={discovery} />;
  }

  if (route.id === "applications") {
    return (
      <ApplicationsPage
        candidates={
          discovery.status === "ready"
            ? discovery.snapshot.candidates
            : { status: "LOADING" }
        }
        state={applications}
        onOperationChanged={onOperationChanged}
      />
    );
  }

  if (route.id === "homebrew") {
    return (
      <BrewInventoryPage
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
        onOperationChanged={onOperationChanged}
        refreshId={
          discovery.status === "ready"
            ? discovery.snapshot.refreshId
            : undefined
        }
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
