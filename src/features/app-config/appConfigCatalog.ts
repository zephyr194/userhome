import type { MessageKey } from "../../i18n";
import type { AppConfigListItem, AppConfigSupportedEntry } from "../../ipc/appConfig";
import { ZH_COPY, type AppConfigCopy, type ProbeTone } from "./appConfigModel";

export const APP_TOOL_ICON_KEYS = ["branch", "package", "container", "editor", "terminal", "key"] as const;
export type AppToolIconKey = (typeof APP_TOOL_ICON_KEYS)[number];

/** One row of the supported-configurations sheet. Registry ids are grouped per tool. */
export interface AppTool {
  id: string;
  name: string;
  summaryKey: MessageKey;
  icon: AppToolIconKey;
  entryIds: readonly string[];
}

export const APP_TOOLS: readonly AppTool[] = [
  {
    id: "git",
    name: "Git",
    summaryKey: "appConfig.tool.git.summary",
    icon: "branch",
    entryIds: ["git-config-home", "git-config-xdg", "git-credentials"],
  },
  {
    id: "npm",
    name: "npm",
    summaryKey: "appConfig.tool.npm.summary",
    icon: "package",
    entryIds: ["npmrc"],
  },
  {
    id: "pnpm",
    name: "pnpm",
    summaryKey: "appConfig.tool.pnpm.summary",
    icon: "package",
    entryIds: ["pnpm-auth-ini"],
  },
  {
    id: "docker",
    name: "Docker",
    summaryKey: "appConfig.tool.docker.summary",
    icon: "container",
    entryIds: ["docker-config"],
  },
  {
    id: "zed",
    name: "Zed",
    summaryKey: "appConfig.tool.zed.summary",
    icon: "editor",
    entryIds: ["zed-settings"],
  },
  {
    id: "neovim",
    name: "Neovim",
    summaryKey: "appConfig.tool.neovim.summary",
    icon: "editor",
    entryIds: ["neovim-init"],
  },
  {
    id: "ghostty",
    name: "Ghostty",
    summaryKey: "appConfig.tool.ghostty.summary",
    icon: "terminal",
    entryIds: ["ghostty-config"],
  },
  {
    id: "alacritty",
    name: "Alacritty",
    summaryKey: "appConfig.tool.alacritty.summary",
    icon: "terminal",
    entryIds: ["alacritty-config"],
  },
  {
    id: "tmux",
    name: "tmux",
    summaryKey: "appConfig.tool.tmux.summary",
    icon: "terminal",
    entryIds: ["tmux-conf", "tmux-config-xdg"],
  },
  {
    id: "ssh",
    name: "SSH",
    summaryKey: "appConfig.tool.ssh.summary",
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
export function describeToolDiscovery(
  state: ToolDiscovery,
  copy: AppConfigCopy = ZH_COPY,
): ToolDiscoveryBadge {
  switch (state) {
    case "discovered":
      return { symbol: "✓", label: copy.t("appConfig.status.found"), tone: "success" };
    case "absent":
      return { symbol: "○", label: copy.t("appConfig.status.notFound"), tone: "neutral" };
    case "unverified":
      return { symbol: "⊘", label: copy.t("appConfig.status.cannotCheck"), tone: "warning" };
    case "unchecked":
      return { symbol: "…", label: copy.t("appConfig.status.unchecked"), tone: "neutral" };
  }
}

/** Keeps catalog order and only the tools whose locations the backend reports as supported. */
export function toolsForSupported(supported: readonly AppConfigSupportedEntry[]): AppTool[] {
  const ids = new Set(supported.map((entry) => entry.id));
  return APP_TOOLS.filter((tool) => tool.entryIds.some((id) => ids.has(id)));
}
