import type { ReactNode } from "react";
import type { ConnectionState } from "../app/shellState";
import type { AppRoute, AppRouteIcon, AppRouteId } from "../app/routeDefinitions";

interface NavigationRailProps {
  activeRouteId: AppRouteId;
  connection?: ConnectionState;
  onNavigate: (routeId: AppRouteId) => void;
  routes: readonly AppRoute[];
}

function NavigationIcon({ icon }: { icon: AppRouteIcon }) {
  const paths: Record<AppRouteIcon, ReactNode> = {
    dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><path d="M14 4h6.5v4H14zM14 12h6.5v8H14zM3.5 14h7v6h-7z" /></>,
    applications: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M17 14v6M14 17h6" /></>,
    homebrew: <><path d="M5 8h12l-1 11H6L5 8Z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 5h6M10 2v3" /></>,
    services: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[icon]}</svg>;
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
  return (
    <nav aria-label="主导航" className="navigation-rail">
      <div className="navigation-rail__brand">
        <span className="navigation-rail__mark" aria-hidden="true"><i /><i /><i /></span>
        <span>
          <strong>UserHome</strong>
          <small>CONTROL LAB</small>
        </span>
      </div>
      <p className="navigation-rail__section-label">系统控制台</p>
      <ul>
        {routes.map((route) => (
          <li key={route.id}>
            <a
              href={`#${route.id}`}
              aria-label={`${route.label}：${route.description}`}
              aria-current={activeRouteId === route.id ? "page" : undefined}
              aria-controls="main-content"
              title={route.label}
              onClick={(event) => {
                event.preventDefault();
                if (activeRouteId !== route.id) onNavigate(route.id);
              }}
            >
              <span className="navigation-rail__icon"><NavigationIcon icon={route.icon} /></span>
              <span className="navigation-rail__label">{route.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className={`navigation-rail__status navigation-rail__status--${status.tone}`}>
        <span aria-hidden="true" />
        <div><strong>{status.label}</strong><small>LOCAL WORKSPACE</small></div>
      </div>
    </nav>
  );
}
