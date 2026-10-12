export type AppRouteId =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "settings";

export type AppRouteIcon =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "settings";

export interface AppRoute {
  id: AppRouteId;
  icon: AppRouteIcon;
  label: string;
  eyebrow: string;
  description: string;
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    id: "dashboard",
    icon: "dashboard",
    label: "概览",
    eyebrow: "本机概览",
    description: "掌握系统、配置、软件与服务的实时状态。",
  },
  {
    id: "applications",
    icon: "applications",
    label: "应用与配置",
    eyebrow: "配置工作区",
    description: "发现、检查并安全管理本机应用配置。",
  },
  {
    id: "homebrew",
    icon: "homebrew",
    label: "软件",
    eyebrow: "Homebrew",
    description: "浏览、搜索并维护 Homebrew 软件。",
  },
  {
    id: "services",
    icon: "services",
    label: "服务",
    eyebrow: "后台服务",
    description: "检查并管理 Homebrew 后台服务。",
  },
  {
    id: "settings",
    icon: "settings",
    label: "设置",
    eyebrow: "应用设置",
    description: "调整 UserHome 的本地行为与安全边界。",
  },
];

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
