import type { AppConfigListItem, AppConfigSupportedEntry } from "../../ipc/appConfig";
import type { ProbeTone } from "./appConfigModel";

export const APP_TOOL_ICON_KEYS = ["branch", "package", "container", "editor", "terminal", "key"] as const;
export type AppToolIconKey = (typeof APP_TOOL_ICON_KEYS)[number];

/** One row of the supported-configurations sheet. Registry ids are grouped per tool. */
export interface AppTool {
  id: string;
  name: string;
  summary: string;
  icon: AppToolIconKey;
  entryIds: readonly string[];
}

export const APP_TOOLS: readonly AppTool[] = [
  {
    id: "git",
    name: "Git",
    summary: "全局身份、默认分支与行为设置。",
    icon: "branch",
    entryIds: ["git-config-home", "git-config-xdg", "git-credentials"],
  },
  {
    id: "npm",
    name: "npm",
    summary: "包仓库地址与用户级的安装设置。",
    icon: "package",
    entryIds: ["npmrc"],
  },
  {
    id: "pnpm",
    name: "pnpm",
    summary: "包仓库地址与认证信息。",
    icon: "package",
    entryIds: ["pnpm-auth-ini"],
  },
  {
    id: "docker",
    name: "Docker",
    summary: "镜像仓库的登录信息与 CLI 默认行为。",
    icon: "container",
    entryIds: ["docker-config"],
  },
  {
    id: "zed",
    name: "Zed",
    summary: "编辑器的外观、字体与行为设置。",
    icon: "editor",
    entryIds: ["zed-settings"],
  },
  {
    id: "neovim",
    name: "Neovim",
    summary: "启动时加载的初始化脚本。",
    icon: "editor",
    entryIds: ["neovim-init"],
  },
  {
    id: "ghostty",
    name: "Ghostty",
    summary: "终端的字体、配色与按键设置。",
    icon: "terminal",
    entryIds: ["ghostty-config"],
  },
  {
    id: "alacritty",
    name: "Alacritty",
    summary: "终端的窗口、字体与颜色设置。",
    icon: "terminal",
    entryIds: ["alacritty-config"],
  },
  {
    id: "tmux",
    name: "tmux",
    summary: "会话的按键绑定、状态栏与窗口行为。",
    icon: "terminal",
    entryIds: ["tmux-conf", "tmux-config-xdg"],
  },
  {
    id: "ssh",
    name: "SSH",
    summary: "系统范围的 SSH 客户端默认选项。",
    icon: "key",
    entryIds: ["ssh-system-config"],
  },
];

export type ToolDiscovery = "discovered" | "absent" | "unverified" | "unchecked";

/**
 * A tool is discovered when any of its locations exists. A location that could
 * not be inspected does not prove absence, so it reads as unverified.
 */
export function toolDiscovery(
  tool: AppTool,
  items: readonly AppConfigListItem[] | undefined,
): ToolDiscovery {
  if (items === undefined) return "unchecked";
  const listed = items.filter((item) => tool.entryIds.includes(item.summary.id));
  if (listed.some((item) => item.probe.status === "found" || item.probe.status === "symlinkOrNonRegular")) {
    return "discovered";
  }
  if (listed.some((item) => item.probe.status === "inaccessible" || item.probe.status === "outOfBounds")) {
    return "unverified";
  }
  return "absent";
}

export interface ToolDiscoveryBadge {
  symbol: string;
  label: string;
  tone: ProbeTone;
}

/** Each state carries a text label and a symbol, so colour is never the only cue. */
export function describeToolDiscovery(state: ToolDiscovery): ToolDiscoveryBadge {
  switch (state) {
    case "discovered":
      return { symbol: "✓", label: "已发现", tone: "success" };
    case "absent":
      return { symbol: "○", label: "未发现", tone: "neutral" };
    case "unverified":
      return { symbol: "⊘", label: "无法检查", tone: "warning" };
    case "unchecked":
      return { symbol: "…", label: "未检查", tone: "neutral" };
  }
}

/** Keeps catalog order and only the tools whose locations the backend reports as supported. */
export function toolsForSupported(supported: readonly AppConfigSupportedEntry[]): AppTool[] {
  const ids = new Set(supported.map((entry) => entry.id));
  return APP_TOOLS.filter((tool) => tool.entryIds.some((id) => ids.has(id)));
}
