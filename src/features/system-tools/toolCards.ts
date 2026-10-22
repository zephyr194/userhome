import type { AppRouteIcon } from "../../app/routeDefinitions";

export type SystemToolRouteId = "caddy";

export interface SystemToolCard {
  routeId: SystemToolRouteId;
  icon: AppRouteIcon;
  name: string;
  description: string;
}

/** Hardcoded card list. Cards show no status and read no backend data. */
export const SYSTEM_TOOL_CARDS: readonly SystemToolCard[] = [
  {
    routeId: "caddy",
    icon: "caddy",
    name: "Caddy",
    description: "检测 Caddy 并编辑本机反向代理规则。",
  },
];
