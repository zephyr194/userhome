import type { AppRoute, AppRouteIcon, AppRouteId } from "../app/routeDefinitions";

interface NavigationRailProps {
  activeRouteId: AppRouteId;
  onNavigate: (routeId: AppRouteId) => void;
  routes: readonly AppRoute[];
}

function NavigationIcon({ icon }: { icon: AppRouteIcon }) {
  if (icon === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (icon === "applications") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <path d="M17 14v6M14 17h6" />
      </svg>
    );
  }

  if (icon === "homebrew") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 8h12l-1 11H6L5 8Z" />
        <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 5h6M10 2v3" />
      </svg>
    );
  }

  if (icon === "services") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="6" rx="2" />
        <rect x="3" y="14" width="18" height="6" rx="2" />
        <path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

export function NavigationRail({
  activeRouteId,
  onNavigate,
  routes,
}: NavigationRailProps) {
  return (
    <nav aria-label="主导航" className="navigation-rail">
      <ul>
        {routes.map((route) => (
          <li key={route.id}>
            <a
              href={`#${route.id}`}
              aria-current={activeRouteId === route.id ? "page" : undefined}
              aria-controls="main-content"
              onClick={(event) => {
                event.preventDefault();
                onNavigate(route.id);
              }}
            >
              <span className="navigation-rail__icon">
                <NavigationIcon icon={route.icon} />
              </span>
              <span className="navigation-rail__label">{route.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
