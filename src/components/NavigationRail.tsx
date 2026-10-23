import type { ConnectionState } from "../app/shellState";
import {
  groupNavigationRoutes,
  type AppRoute,
  type AppRouteId,
} from "../app/routeDefinitions";
import { BrandMark } from "./ui/BrandMark";
import { useSlideIndicator } from "./ui/useSlideIndicator";
import { RouteIcon } from "./RouteIcon";

interface NavigationRailProps {
  activeRouteId: AppRouteId;
  connection?: ConnectionState;
  onNavigate: (routeId: AppRouteId) => void;
  routes: readonly AppRoute[];
}

function connectionDetails(connection?: ConnectionState) {
  if (!connection || connection.status === "loading") {
    return { label: "正在连接", tone: "loading" };
  }
  if (connection.status === "error") {
    return { label: "连接异常", tone: "error" };
  }
  return { label: `本机在线 · v${connection.appStatus.version}`, tone: "ready" };
}

export function NavigationRail({
  activeRouteId,
  connection,
  onNavigate,
  routes,
}: NavigationRailProps) {
  const status = connectionDetails(connection);
  const railRef = useSlideIndicator(activeRouteId, "y", "primary");
  return (
    <nav aria-label="主导航" className="navigation-rail slide-list" ref={railRef}>
      <div className="navigation-rail__brand">
        <BrandMark className="navigation-rail__brand-mark" />
        <span>
          <strong>UserHome</strong>
          <small>CONTROL LAB</small>
        </span>
      </div>
      {groupNavigationRoutes(routes).map(({ group, routes: groupRoutes }) => (
        <div className={`navigation-rail__group navigation-rail__group--${group.id}`} key={group.id}>
          <p className="navigation-rail__section-label" id={`nav-group-${group.id}`}>
            {group.label}
          </p>
          <ul aria-labelledby={`nav-group-${group.id}`}>
            {groupRoutes.map((route) => (
              <li key={route.id}>
                <a
                  href={`#${route.id}`}
                  className="slide-item"
                  aria-label={`${route.label}：${route.description}`}
                  aria-current={activeRouteId === route.id ? "page" : undefined}
                  aria-controls="main-content"
                  title={route.label}
                  onClick={(event) => {
                    event.preventDefault();
                    if (activeRouteId !== route.id) onNavigate(route.id);
                  }}
                >
                  <span className="navigation-rail__icon"><RouteIcon icon={route.icon} /></span>
                  <span className="navigation-rail__label">{route.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className={`navigation-rail__status navigation-rail__status--${status.tone}`}>
        <span aria-hidden="true" />
        <div><strong>{status.label}</strong><small>LOCAL WORKSPACE</small></div>
      </div>
    </nav>
  );
}
