import {
  SETTINGS_GROUPS,
  type SettingsGroupId,
} from "../features/settings/settingsGroups";
import {
  routeSectionsOf,
  type AppRouteId,
  type NavigationIntent,
} from "./routeDefinitions";

export const DEEP_LINK_MAX_LENGTH = 512;
export const DEEP_LINK_SOURCE = "deep-link";

const DEEP_LINK_ROUTE_IDS = [
  "dashboard",
  "environment",
  "appConfig",
  "aiConfig",
  "systemTools",
  "tools",
  "services",
  "settings",
  "caddy",
] as const satisfies readonly AppRouteId[];

type DeepLinkRouteId = (typeof DEEP_LINK_ROUTE_IDS)[number];

const LINK_PATTERN =
  /^userhome:\/\/open\/([A-Za-z]+)(?:\?([A-Za-z]+=[A-Za-z]+(?:&[A-Za-z]+=[A-Za-z]+)*))?$/;

const PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "routeId",
  "section",
  "group",
  "source",
]);

interface DeepLinkParams {
  section?: string;
  group?: string;
}

function isDeepLinkRouteId(value: string): value is DeepLinkRouteId {
  return (DEEP_LINK_ROUTE_IDS as readonly string[]).includes(value);
}

function isSettingsGroupId(value: string): value is SettingsGroupId {
  return SETTINGS_GROUPS.some((group) => group.id === value);
}

function resolveIntent(
  routeId: string,
  params: DeepLinkParams,
): NavigationIntent | undefined {
  if (!isDeepLinkRouteId(routeId)) return undefined;

  if (routeId === "settings") {
    if (params.section !== undefined) return undefined;
    if (params.group === undefined) return { routeId, source: DEEP_LINK_SOURCE };
    if (!isSettingsGroupId(params.group)) return undefined;
    return { routeId, group: params.group, source: DEEP_LINK_SOURCE };
  }

  if (params.group !== undefined) return undefined;
  if (params.section === undefined) return { routeId, source: DEEP_LINK_SOURCE };

  const section = params.section;
  if (!routeSectionsOf(routeId).some((declared) => declared.id === section)) {
    return undefined;
  }
  if (routeId === "caddy" || routeId === "environment") {
    return { routeId, section, source: DEEP_LINK_SOURCE };
  }
  return undefined;
}

function parseQuery(query: string): DeepLinkParams | undefined {
  const params: DeepLinkParams = {};
  for (const pair of query.split("&")) {
    const [key, paramValue] = pair.split("=");
    if (key === "section" && params.section === undefined) {
      params.section = paramValue;
    } else if (key === "group" && params.group === undefined) {
      params.group = paramValue;
    } else {
      return undefined;
    }
  }
  return params;
}

/** Strict whitelist parse of a userhome://open link; nothing is decoded and any deviation yields undefined. */
export function parseDeepLink(value: unknown): NavigationIntent | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > DEEP_LINK_MAX_LENGTH
  ) {
    return undefined;
  }
  const match = LINK_PATTERN.exec(value);
  if (!match) return undefined;
  const [, routeId, query] = match;
  const params = query === undefined ? {} : parseQuery(query);
  return params === undefined ? undefined : resolveIntent(routeId, params);
}

/** Re-checks a navigation payload received from the backend before it can navigate. */
export function validateDeepLinkPayload(value: unknown): NavigationIntent | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PAYLOAD_KEYS.has(key))) return undefined;
  if (record.source !== undefined && record.source !== DEEP_LINK_SOURCE) return undefined;
  const { routeId, section, group } = record;
  if (typeof routeId !== "string") return undefined;
  if (section !== undefined && typeof section !== "string") return undefined;
  if (group !== undefined && typeof group !== "string") return undefined;
  return resolveIntent(routeId, { section, group });
}

/** The userhome:// link for a page and its current section or settings group; undefined outside the whitelist. */
export function buildPageDeepLink(
  routeId: AppRouteId,
  section?: string,
  group?: SettingsGroupId,
): string | undefined {
  if (resolveIntent(routeId, { section, group }) === undefined) return undefined;
  if (routeId === "settings") {
    return group === undefined
      ? "userhome://open/settings"
      : `userhome://open/settings?group=${group}`;
  }
  return section === undefined
    ? `userhome://open/${routeId}`
    : `userhome://open/${routeId}?section=${section}`;
}
