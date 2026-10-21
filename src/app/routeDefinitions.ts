export type AppRouteId =
  | "dashboard"
  | "applications"
  | "homebrew"
  | "services"
  | "environment"
  | "caddy"
  | "appConfig"
  | "aiConfig"
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
  | "tools"
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
  caddy: {
    icon: "caddy",
    label: "Caddy",
    eyebrow: "本地代理",
    description: "检测 Caddy 并编辑本机反向代理规则；保存不会启动或重载 Caddy。",
    group: "system-tools",
  },
  appConfig: {
    icon: "appConfig",
    label: "应用配置",
    eyebrow: "只读配置",
    description: "按登记的默认位置只读查看应用配置，秘密值默认遮盖。",
    group: "system-tools",
  },
  aiConfig: {
    icon: "aiConfig",
    label: "AI 配置",
    eyebrow: "AI 工具",
    description: "只读检测 Claude Code、Codex、Gemini 与 Copilot CLI 的安装状态、版本与配置位置。",
    group: "system-tools",
  },
  tools: {
    icon: "tools",
    label: "工具集",
    eyebrow: "文本工具",
    description: "本机格式化与转换文本，输入只保存在本次页面中。",
    group: "toolset",
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

export type NavigationSource = "primary-nav" | "content" | "menu" | "tray";

export type NavigationIntent = (
  | { routeId: "dashboard" }
  | { routeId: "services"; serviceId?: string }
  | { routeId: "settings"; group?: import("../features/settings/settingsGroups").SettingsGroupId }
) & { source?: NavigationSource };
