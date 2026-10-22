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

export interface AppRouteSection {
  id: string;
  label: string;
}

export interface AppRoute {
  id: AppRouteId;
  icon: AppRouteIcon;
  label: string;
  eyebrow: string;
  description: string;
  /**
   * Sidebar entry that stays highlighted while this page is open. A route with
   * a parent has no sidebar entry of its own; it is reached from the parent page.
   */
  parent?: AppRouteId;
  /** Section tabs shown above the content of the tool page. */
  sections?: readonly AppRouteSection[];
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
    label: "概览",
    eyebrow: "本机概览",
    description: "掌握系统、配置、软件与服务的实时状态。",
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
  },
  environment: {
    icon: "environment",
    label: "环境变量",
    eyebrow: "环境文件",
    description: "在指定目录中只读查看 dotenv 文件，秘密值默认遮盖。",
    sections: [
      { id: "dotenv", label: "dotenv 文件" },
      { id: "zsh", label: "zsh 启动文件" },
      { id: "launchctl", label: "登录会话" },
    ],
  },
  caddy: {
    icon: "caddy",
    label: "Caddy",
    eyebrow: "本地代理",
    description: "检测 Caddy 并编辑本机反向代理规则；保存不会启动或重载 Caddy。",
    parent: "systemTools",
    sections: [
      { id: "rules", label: "站点规则" },
      { id: "run", label: "运行" },
      { id: "raw", label: "原文 Caddyfile" },
    ],
  },
  appConfig: {
    icon: "appConfig",
    label: "应用配置",
    eyebrow: "只读配置",
    description: "按登记的默认位置只读查看应用配置，秘密值默认遮盖。",
  },
  aiConfig: {
    icon: "aiConfig",
    label: "AI 工具",
    eyebrow: "AI 工具",
    description: "只读检测 Claude Code、Codex、Gemini 与 Copilot CLI 的安装状态、版本与配置位置。",
  },
  systemTools: {
    icon: "systemTools",
    label: "系统工具",
    eyebrow: "系统工具",
    description: "本机常用系统工具入口。",
  },
  tools: {
    icon: "tools",
    label: "工具集",
    eyebrow: "文本工具",
    description: "本机格式化与转换文本，输入只保存在本次页面中。",
  },
  settings: {
    icon: "settings",
    label: "设置",
    eyebrow: "应用设置",
    description: "调整 UserHome 的本地行为与安全边界。",
  },
};

export const APP_ROUTES: readonly AppRoute[] = (
  Object.keys(ROUTE_REGISTRY) as AppRouteId[]
).map((id) => ({ id, ...ROUTE_REGISTRY[id] }));

/** Sidebar entries from top to bottom. Routes not listed here have no sidebar entry. */
const PRIMARY_NAV_ORDER: readonly AppRouteId[] = [
  "dashboard",
  "environment",
  "appConfig",
  "aiConfig",
  "systemTools",
  "tools",
  "services",
  "settings",
];

export function primaryNavigationRoutes(
  routes: readonly AppRoute[],
): readonly AppRoute[] {
  return PRIMARY_NAV_ORDER.flatMap((id) => routes.filter((route) => route.id === id));
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

export type NavigationSource = "primary-nav" | "content" | "menu" | "tray";

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
) & { source?: NavigationSource };
