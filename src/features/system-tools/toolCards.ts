import type { AppRouteIcon } from "../../app/routeDefinitions";
import type { MessageKey } from "../../i18n";

export type SystemToolRouteId = "caddy";

export interface SystemToolCard {
  routeId: SystemToolRouteId;
  icon: AppRouteIcon;
  name: string;
  descriptionKey: MessageKey;
}

/** Hardcoded card list. Cards show no status and read no backend data. */
export const SYSTEM_TOOL_CARDS: readonly SystemToolCard[] = [
  {
    routeId: "caddy",
    icon: "caddy",
    name: "Caddy",
    descriptionKey: "systemTools.caddy.description",
  },
];
