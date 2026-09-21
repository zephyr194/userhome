import type { BrewSearchResult } from "../ipc/brew";
import { APP_ROUTES, type AppRouteId } from "./routeDefinitions";
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
  applicationKey?: string;
  applicationConfigIds: Record<string, string>;
  brewSelection?: BrewSearchResult;
  serviceId?: string;
}

export const DEFAULT_SELECTION_MEMORY: SelectionMemory = {
  routeId: "dashboard",
  settingsGroup: "appearance",
  applicationConfigIds: {},
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

function safeRoute(value: unknown): value is AppRouteId {
  return APP_ROUTES.some((route) => route.id === value);
}

function safeSettingsGroup(value: unknown): value is SettingsGroupId {
  return SETTINGS_GROUPS.some((group) => group.id === value);
}

function decodeConfigSelections(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([applicationId, configId]) =>
          safeIdentifier(applicationId) && safeIdentifier(configId),
      )
      .slice(0, 64),
  );
}

function decodeSelection(value: unknown): SelectionMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SELECTION_MEMORY;
  }
  const stored = value as Record<string, unknown>;
  const applicationKey =
    typeof stored.applicationKey === "string" &&
    stored.applicationKey.startsWith("catalog:") &&
    safeIdentifier(stored.applicationKey.slice("catalog:".length))
      ? stored.applicationKey
      : undefined;
  const brew =
    stored.brewSelection &&
    typeof stored.brewSelection === "object" &&
    !Array.isArray(stored.brewSelection)
      ? (stored.brewSelection as Record<string, unknown>)
      : undefined;
  let brewSelection: BrewSearchResult | undefined;
  if (
    brew &&
    (brew.kind === "FORMULA" || brew.kind === "CASK") &&
    safeIdentifier(brew.identifier)
  ) {
    brewSelection = { kind: brew.kind, identifier: brew.identifier };
  }

  return {
    routeId: safeRoute(stored.routeId) ? stored.routeId : "dashboard",
    settingsGroup: safeSettingsGroup(stored.settingsGroup)
      ? stored.settingsGroup
      : "appearance",
    applicationConfigIds: decodeConfigSelections(
      stored.applicationConfigIds,
    ),
    ...(applicationKey ? { applicationKey } : {}),
    ...(brewSelection ? { brewSelection } : {}),
    ...(safeIdentifier(stored.serviceId)
      ? { serviceId: stored.serviceId }
      : {}),
  };
}

export function loadSelectionMemory(enabled: boolean): SelectionMemory {
  if (!enabled) return DEFAULT_SELECTION_MEMORY;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? decodeSelection(JSON.parse(stored)) : DEFAULT_SELECTION_MEMORY;
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
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(decodeSelection(selection)),
    );
  } catch {
    warnSelectionStorage("Unable to persist the current UI selection.");
  }
}
