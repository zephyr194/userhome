export type AppRouteId =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "environment"
  | "settings";

export type AppRouteIcon =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "environment"
  | "settings";

export type NavGroupId = "system-tools" | "toolset" | "support";

export interface NavGroup {
  id: NavGroupId;
  label: string;
}

/** Primary navigation groups, in display order. */
export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "system-tools", label: "系统工具" },
  { id: "toolset", label: "工具集" },
  { id: "support", label: "支撑" },
];

export interface AppRoute {
  id: AppRouteId;
  icon: AppRouteIcon;
  label: string;
  eyebrow: string;
  description: string;
  /**
   * Primary navigation group. A route without a group stays registered and
   * reachable (persisted selection, in-content links) but has no navigation
   * entry.
   */
  group?: NavGroupId;
}

/**
 * Route registry keyed by route id. Adding a module route means extending
 * `AppRouteId` (and `AppRouteIcon` when it needs a new icon) and then adding
 * one entry here; `Record<AppRouteId, ...>` makes a missing entry a type error.
 */
const ROUTE_REGISTRY: Record<AppRouteId, Omit<AppRoute, "id">> = {
  dashboard: {
    icon: "dashboard",
    label: "概览",
    eyebrow: "本机概览",
    description: "掌握系统、配置、软件与服务的实时状态。",
    group: "support",
  },
  // Retired from the primary navigation; page and code are kept.
  applications: {
    icon: "applications",
    label: "应用与配置",
    eyebrow: "配置工作区",
    description: "发现、检查并安全管理本机应用配置。",
  },
  // Retired from the primary navigation; page and code are kept.
  homebrew: {
    icon: "homebrew",
    label: "软件",
    eyebrow: "Homebrew",
    description: "浏览、搜索并维护 Homebrew 软件。",
  },
  services: {
    icon: "services",
    label: "服务",
    eyebrow: "后台服务",
    description: "发现并查看本机常驻任务（launchd），管理自建任务。",
    group: "support",
  },
  environment: {
    icon: "environment",
    label: "环境变量",
    eyebrow: "环境文件",
    description: "在指定目录中只读查看 dotenv 文件，秘密值默认遮盖。",
    group: "system-tools",
  },
  settings: {
    icon: "settings",
    label: "设置",
    eyebrow: "应用设置",
    description: "调整 UserHome 的本地行为与安全边界。",
    group: "support",
  },
};

export const APP_ROUTES: readonly AppRoute[] = (
  Object.keys(ROUTE_REGISTRY) as AppRouteId[]
).map((id) => ({ id, ...ROUTE_REGISTRY[id] }));

export interface NavGroupRoutes {
  group: NavGroup;
  routes: readonly AppRoute[];
}

/** Primary navigation entries per group; every group is returned, even if empty. */
export function groupNavigationRoutes(
  routes: readonly AppRoute[],
): readonly NavGroupRoutes[] {
  return NAV_GROUPS.map((group) => ({
    group,
    routes: routes.filter((route) => route.group === group.id),
  }));
}

/**
 * The applications workspace has two scopes:
 * - `LOCAL_RECOGNIZED` lists the locally discovered candidates.
 * - `CATALOG` browses the curated managed application catalog.
 *
 * The scope is safe to persist in selection memory. Transient navigation
 * details such as `candidateId`/`sourceRefreshId` are intentionally kept out
 * of the persisted shape.
 */
export type ApplicationsScope = "LOCAL_RECOGNIZED" | "CATALOG";
export type NavigationSource = "primary-nav" | "content" | "menu" | "tray";

export interface ApplicationsNavigationIntent {
  routeId: "applications";
  scope?: ApplicationsScope;
  candidateId?: string;
  sourceRefreshId?: string;
  applicationId?: string;
  configId?: string;
}

export type NavigationIntent = (
  | { routeId: "dashboard" }
  | ApplicationsNavigationIntent
  | { routeId: "homebrew" }
  | { routeId: "services"; serviceId?: string }
  | { routeId: "settings"; group?: import("../features/settings/settingsGroups").SettingsGroupId }
) & { source?: NavigationSource };
