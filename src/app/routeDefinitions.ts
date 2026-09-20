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
    description: "查看 UserHome 与最近本机操作的可用状态。",
  },
  {
    id: "applications",
    icon: "applications",
    label: "应用",
    eyebrow: "用户目录",
    description: "识别应用及其配置文件。",
  },
  {
    id: "homebrew",
    icon: "homebrew",
    label: "Homebrew",
    eyebrow: "软件管理",
    description: "查看 Homebrew 安装的软件。",
  },
  {
    id: "services",
    icon: "services",
    label: "服务",
    eyebrow: "后台服务",
    description: "查看 Homebrew services 的运行状态。",
  },
  {
    id: "settings",
    icon: "settings",
    label: "设置",
    eyebrow: "应用设置",
    description: "管理 UserHome 的本地偏好。",
  },
];
