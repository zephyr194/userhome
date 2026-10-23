import type { MessageKey, TranslateFunction } from "../i18n";

export type AppRouteId =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "environment"
  | "caddy"
  | "appConfig"
  | "aiConfig"
  | "systemTools"
  | "tools"
  | "settings";

export type AppRouteIcon =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "environment"
  | "caddy"
  | "appConfig"
  | "aiConfig"
  | "systemTools"
  | "tools"
  | "settings";

export type NavGroupId = "overview" | "system-tools" | "toolset" | "support";

export interface NavGroup {
  id: NavGroupId;
  /** Heading shown above the group; null for a group without a heading. */
  labelKey: MessageKey | null;
}

/** Primary navigation groups, in display order. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "overview", labelKey: null },
  { id: "system-tools", labelKey: "nav.group.systemTools" },
  { id: "toolset", labelKey: "nav.group.toolset" },
  { id: "support", labelKey: "nav.group.support" },
];

export function navGroupLabel(group: NavGroup, t: TranslateFunction): string | null {
  return group.labelKey ? t(group.labelKey) : null;
}

export interface AppRouteSection {
  id: string;
  label: string;
}

export interface AppRoute {
  id: AppRouteId;
  icon: AppRouteIcon;
  labelKey: MessageKey;
  eyebrowKey: MessageKey;
  descriptionKey: MessageKey;
  /**
   * Sidebar entry that stays highlighted while this page is open. A route with
   * a parent has no sidebar entry of its own; it is reached from the parent page.
   */
  parent?: AppRouteId;
  /** Section tabs shown above the content of the tool page. */
  sections?: readonly AppRouteSection[];
}

export function routeLabel(route: AppRoute, t: TranslateFunction): string {
  return t(route.labelKey);
}

export function routeEyebrow(route: AppRoute, t: TranslateFunction): string {
  return t(route.eyebrowKey);
}

export function routeDescription(route: AppRoute, t: TranslateFunction): string {
  return t(route.descriptionKey);
}

/** The section a route shows: the stored id when the route declares it, otherwise its first section. */
export function activeSectionOf(
  route: AppRoute,
  storedId: string | undefined,
): AppRouteSection | undefined {
  return route.sections?.find((section) => section.id === storedId) ?? route.sections?.[0];
}

/** The sections a route declares, in display order; empty when it declares none. */
export function routeSectionsOf(routeId: AppRouteId): readonly AppRouteSection[] {
  return ROUTE_REGISTRY[routeId].sections ?? [];
}

/**
 * Route registry keyed by route id. Adding a module route means extending
 * `AppRouteId` (and `AppRouteIcon` when it needs a new icon) and then adding
 * one entry here; `Record<AppRouteId, ...>` makes a missing entry a type error.
 */
const ROUTE_REGISTRY: Record<AppRouteId, Omit<AppRoute, "id">> = {
  dashboard: {
    icon: "dashboard",
    labelKey: "route.dashboard.label",
    eyebrowKey: "route.dashboard.eyebrow",
    descriptionKey: "route.dashboard.description",
  },
  // Retired from the primary navigation; page and code are kept.
  applications: {
    icon: "applications",
    labelKey: "route.applications.label",
    eyebrowKey: "route.applications.eyebrow",
    descriptionKey: "route.applications.description",
  },
  // Retired from the primary navigation; page and code are kept.
  homebrew: {
    icon: "homebrew",
    labelKey: "route.homebrew.label",
    eyebrowKey: "route.homebrew.eyebrow",
    descriptionKey: "route.homebrew.description",
  },
  services: {
    icon: "services",
    labelKey: "route.services.label",
    eyebrowKey: "route.services.eyebrow",
    descriptionKey: "route.services.description",
  },
  environment: {
    icon: "environment",
    labelKey: "route.environment.label",
    eyebrowKey: "route.environment.eyebrow",
    descriptionKey: "route.environment.description",
    sections: [
      { id: "dotenv", label: "dotenv 文件" }, // i18n-phase-two
      { id: "zsh", label: "zsh 启动文件" }, // i18n-phase-two
      { id: "launchctl", label: "登录会话" }, // i18n-phase-two
    ],
  },
  caddy: {
    icon: "caddy",
    labelKey: "route.caddy.label",
    eyebrowKey: "route.caddy.eyebrow",
    descriptionKey: "route.caddy.description",
    parent: "systemTools",
    sections: [
      { id: "rules", label: "站点规则" }, // i18n-phase-two
      { id: "run", label: "运行" }, // i18n-phase-two
      { id: "raw", label: "原文 Caddyfile" }, // i18n-phase-two
    ],
  },
  appConfig: {
    icon: "appConfig",
    labelKey: "route.appConfig.label",
    eyebrowKey: "route.appConfig.eyebrow",
    descriptionKey: "route.appConfig.description",
  },
  aiConfig: {
    icon: "aiConfig",
    labelKey: "route.aiConfig.label",
    eyebrowKey: "route.aiConfig.eyebrow",
    descriptionKey: "route.aiConfig.description",
  },
  systemTools: {
    icon: "systemTools",
    labelKey: "route.systemTools.label",
    eyebrowKey: "route.systemTools.eyebrow",
    descriptionKey: "route.systemTools.description",
  },
  tools: {
    icon: "tools",
    labelKey: "route.tools.label",
    eyebrowKey: "route.tools.eyebrow",
    descriptionKey: "route.tools.description",
  },
  settings: {
    icon: "settings",
    labelKey: "route.settings.label",
    eyebrowKey: "route.settings.eyebrow",
    descriptionKey: "route.settings.description",
  },
};

export const APP_ROUTES: readonly AppRoute[] = (
  Object.keys(ROUTE_REGISTRY) as AppRouteId[]
).map((id) => ({ id, ...ROUTE_REGISTRY[id] }));

/**
 * Sidebar entries per group, top to bottom. Routes not listed here have no
 * sidebar entry; a child page (with `parent`) is reached from its parent.
 */
const NAV_LAYOUT: Record<NavGroupId, readonly AppRouteId[]> = {
  overview: ["dashboard"],
  "system-tools": ["environment", "appConfig", "aiConfig", "systemTools"],
  toolset: ["tools"],
  support: ["services", "settings"],
};

const PRIMARY_NAV_ORDER: readonly AppRouteId[] = NAV_GROUPS.flatMap(
  (group) => NAV_LAYOUT[group.id],
);

export interface NavGroupRoutes {
  group: NavGroup;
  routes: readonly AppRoute[];
}

/** Sidebar entries per group, in display order; every group is returned. */
export function groupNavigationRoutes(
  routes: readonly AppRoute[],
): readonly NavGroupRoutes[] {
  return NAV_GROUPS.map((group) => ({
    group,
    routes: NAV_LAYOUT[group.id].flatMap((id) => routes.filter((route) => route.id === id)),
  }));
}

export function primaryNavigationRoutes(
  routes: readonly AppRoute[],
): readonly AppRoute[] {
  return groupNavigationRoutes(routes).flatMap(({ routes: groupRoutes }) => groupRoutes);
}

/** The sidebar entry that stays highlighted for a route. */
export function navigationRouteOf(routeId: AppRouteId): AppRouteId {
  return ROUTE_REGISTRY[routeId].parent ?? routeId;
}

/** Sidebar entries and child pages can be restored; retired routes fall back to the dashboard. */
export function isRestorableRoute(value: unknown): value is AppRouteId {
  return APP_ROUTES.some(
    (route) =>
      route.id === value &&
      (PRIMARY_NAV_ORDER.includes(route.id) || route.parent !== undefined),
  );
}

export type NavigationSource = "primary-nav" | "content" | "menu" | "tray" | "deep-link";

/** Navigation only: names a task to select on the services page, never an action on it. */
export interface ServiceFocus {
  label: string;
  domain: "GUI" | "SYSTEM";
}

export type NavigationIntent = (
  | { routeId: "dashboard" }
  | { routeId: "services"; serviceId?: string; serviceFocus?: ServiceFocus }
  | { routeId: "settings"; group?: import("../features/settings/settingsGroups").SettingsGroupId }
  | { routeId: "caddy" | "environment" | "appConfig"; section?: string }
  | { routeId: "aiConfig" }
  | { routeId: "systemTools" }
  | { routeId: "tools" }
) & { source?: NavigationSource };
