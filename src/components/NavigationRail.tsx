import type { ConnectionState } from "../app/shellState";
import {
  groupNavigationRoutes,
  navGroupLabel,
  routeDescription,
  routeLabel,
  type AppRoute,
  type AppRouteId,
} from "../app/routeDefinitions";
import { useT } from "../i18n/useLocale";
import type { TranslateFunction } from "../i18n";
import { BrandMark } from "./ui/BrandMark";
import { useSlideIndicator } from "./ui/useSlideIndicator";
import { RouteIcon } from "./RouteIcon";

interface NavigationRailProps {
  activeRouteId: AppRouteId;
  connection?: ConnectionState;
  onNavigate: (routeId: AppRouteId) => void;
  routes: readonly AppRoute[];
}

function connectionDetails(t: TranslateFunction, connection?: ConnectionState) {
  if (!connection || connection.status === "loading") {
    return { label: t("nav.connection.connecting"), tone: "loading" };
  }
  if (connection.status === "error") {
    return { label: t("nav.connection.error"), tone: "error" };
  }
  return {
    label: t("nav.connection.online", { version: connection.appStatus.version }),
    tone: "ready",
  };
}

export function NavigationRail({
  activeRouteId,
  connection,
  onNavigate,
  routes,
}: NavigationRailProps) {
  const t = useT();
  const status = connectionDetails(t, connection);
  const railRef = useSlideIndicator(activeRouteId, "y", "primary");
  return (
    <nav aria-label={t("nav.label")} className="navigation-rail slide-list" ref={railRef}>
      <div className="navigation-rail__brand">
        <BrandMark className="navigation-rail__brand-mark" />
        <span>
          <strong>UserHome</strong>
          <small>CONTROL LAB</small>
        </span>
      </div>
<<<<<<< HEAD
      {groupNavigationRoutes(routes).map(({ group, routes: groupRoutes }) => {
        const groupLabel = navGroupLabel(group, t);
        const headingId = groupLabel ? `nav-group-${group.id}` : undefined;
        return (
          <div className={`navigation-rail__group navigation-rail__group--${group.id}`} key={group.id}>
            {groupLabel && (
              <p className="navigation-rail__section-label" id={headingId}>
                {groupLabel}
              </p>
            )}
            <ul aria-labelledby={headingId}>
              {groupRoutes.map((route) => {
                const label = routeLabel(route, t);
                return (
                  <li key={route.id}>
                    <a
                      href={`#${route.id}`}
                      className="slide-item"
                      aria-label={t("nav.itemLabel", {
                        label,
                        description: routeDescription(route, t),
                      })}
                      aria-current={activeRouteId === route.id ? "page" : undefined}
                      aria-controls="main-content"
                      title={label}
                      onClick={(event) => {
                        event.preventDefault();
                        if (activeRouteId !== route.id) onNavigate(route.id);
                      }}
                    >
                      <span className="navigation-rail__icon"><RouteIcon icon={route.icon} /></span>
                      <span className="navigation-rail__label">{label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className={`navigation-rail__status navigation-rail__status--${status.tone}`}>
        <span aria-hidden="true" />
        <div><strong>{status.label}</strong><small>LOCAL WORKSPACE</small></div>
      </div>
    </nav>
  );
}
