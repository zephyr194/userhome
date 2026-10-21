import {
  APP_ROUTES,
  type AppRouteId,
} from "./routeDefinitions";
import {
  SETTINGS_GROUPS,
  type SettingsGroupId,
} from "../features/settings/settingsGroups";

const STORAGE_KEY = "userhome.selection.v1";
const MAX_IDENTIFIER_LENGTH = 192;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;

export interface SelectionMemory {
  routeId: AppRouteId;
  settingsGroup: SettingsGroupId;
  serviceId?: string;
}

export const DEFAULT_SELECTION_MEMORY: SelectionMemory = {
  routeId: "dashboard",
  settingsGroup: "appearance",
};

function warnSelectionStorage(message: string) {
  if (import.meta.env.MODE !== "test") {
    console.warn(message);
  }
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(value)
  );
}

/**
 * Only routes that still have a navigation entry are restorable. A persisted
 * id for a retired route (registered but without a group) or an unknown id
 * falls back to the dashboard instead of failing.
 */
function safeRoute(value: unknown): value is AppRouteId {
  return APP_ROUTES.some((route) => route.id === value && route.group);
}

function safeSettingsGroup(value: unknown): value is SettingsGroupId {
  return SETTINGS_GROUPS.some((group) => group.id === value);
}

export function decodeSelectionMemory(value: unknown): SelectionMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SELECTION_MEMORY;
  }
  const stored = value as Record<string, unknown>;
  return {
    routeId: safeRoute(stored.routeId) ? stored.routeId : "dashboard",
    settingsGroup: safeSettingsGroup(stored.settingsGroup)
      ? stored.settingsGroup
      : "appearance",
    ...(safeIdentifier(stored.serviceId)
      ? { serviceId: stored.serviceId }
      : {}),
  };
}

/**
 * The exact persisted shape. Fields retired with the application and Homebrew
 * pages are dropped by the strict decoder, so they never reach `localStorage`.
 */
export function encodeSelectionMemory(selection: SelectionMemory): string {
  return JSON.stringify(decodeSelectionMemory(selection));
}

export function loadSelectionMemory(enabled: boolean): SelectionMemory {
  if (!enabled) return DEFAULT_SELECTION_MEMORY;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? decodeSelectionMemory(JSON.parse(stored)) : DEFAULT_SELECTION_MEMORY;
  } catch {
    warnSelectionStorage("Unable to restore the saved UI selection.");
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      warnSelectionStorage("Unable to remove invalid saved UI selection.");
    }
    return DEFAULT_SELECTION_MEMORY;
  }
}

export function saveSelectionMemory(
  enabled: boolean,
  selection: SelectionMemory,
): void {
  try {
    if (!enabled) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, encodeSelectionMemory(selection));
  } catch {
    warnSelectionStorage("Unable to persist the current UI selection.");
  }
}
