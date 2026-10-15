import type { BrewSearchResult } from "../ipc/brew";
import type {
  ManagedAppCapability,
  ManagedAppCoverageClass,
} from "../ipc/catalog";
import {
  APP_ROUTES,
  type AppRouteId,
  type ApplicationsScope,
} from "./routeDefinitions";
import {
  decodeApplicationsScope,
  DEFAULT_APPLICATIONS_SCOPE,
} from "./applicationNavigation";
import {
  SETTINGS_GROUPS,
  type SettingsGroupId,
} from "../features/settings/settingsGroups";

const STORAGE_KEY = "userhome.selection.v1";
const MAX_IDENTIFIER_LENGTH = 192;
const MAX_QUERY_LENGTH = 256;
const MAX_APPLICATION_PAGE = 1_000;
const MAX_SCROLL_TOP = 10_000_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
const APPLICATION_COVERAGE_CLASSES: readonly ManagedAppCoverageClass[] = [
  "MANAGED_WRITABLE",
  "MANAGED_READ_ONLY",
  "DETECTED_UNSUPPORTED",
  "EXCLUDED",
];
const APPLICATION_CAPABILITIES: readonly ManagedAppCapability[] = [
  "DETECT",
  "READ_CONFIG",
  "WRITE_CONFIG",
  "MANAGE_SERVICE",
];

export interface SelectionMemory {
  routeId: AppRouteId;
  settingsGroup: SettingsGroupId;
  applicationsScope: ApplicationsScope;
  applicationKey?: string;
  applicationConfigIds: Record<string, string>;
  applicationQuery: string;
  applicationCategory?: string;
  applicationCoverage?: ManagedAppCoverageClass;
  applicationCapability?: ManagedAppCapability;
  applicationDetected?: boolean;
  applicationPage: number;
  applicationScrollTop: number;
  brewSelection?: BrewSearchResult;
  serviceId?: string;
}

export const DEFAULT_SELECTION_MEMORY: SelectionMemory = {
  routeId: "dashboard",
  settingsGroup: "appearance",
  applicationsScope: DEFAULT_APPLICATIONS_SCOPE,
  applicationConfigIds: {},
  applicationQuery: "",
  applicationPage: 1,
  applicationScrollTop: 0,
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

function safeText(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_QUERY_LENGTH) {
    return false;
  }
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
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

export function decodeSelectionMemory(value: unknown): SelectionMemory {
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
    applicationsScope: decodeApplicationsScope(stored.applicationsScope),
    applicationConfigIds: decodeConfigSelections(
      stored.applicationConfigIds,
    ),
    applicationQuery: safeText(stored.applicationQuery)
      ? stored.applicationQuery
      : "",
    applicationPage: safeInteger(
      stored.applicationPage,
      1,
      MAX_APPLICATION_PAGE,
    )
      ? stored.applicationPage
      : 1,
    applicationScrollTop: safeInteger(
      stored.applicationScrollTop,
      0,
      MAX_SCROLL_TOP,
    )
      ? stored.applicationScrollTop
      : 0,
    ...(applicationKey ? { applicationKey } : {}),
    ...(safeText(stored.applicationCategory) &&
    stored.applicationCategory.length > 0
      ? { applicationCategory: stored.applicationCategory }
      : {}),
    ...(APPLICATION_COVERAGE_CLASSES.includes(
      stored.applicationCoverage as ManagedAppCoverageClass,
    )
      ? {
          applicationCoverage:
            stored.applicationCoverage as ManagedAppCoverageClass,
        }
      : {}),
    ...(APPLICATION_CAPABILITIES.includes(
      stored.applicationCapability as ManagedAppCapability,
    )
      ? {
          applicationCapability:
            stored.applicationCapability as ManagedAppCapability,
        }
      : {}),
    ...(typeof stored.applicationDetected === "boolean"
      ? { applicationDetected: stored.applicationDetected }
      : {}),
    ...(brewSelection ? { brewSelection } : {}),
    ...(safeIdentifier(stored.serviceId)
      ? { serviceId: stored.serviceId }
      : {}),
  };
}

/**
 * The exact persisted shape. Unknown or transient fields (such as a
 * `candidateId`/`sourceRefreshId` that a caller might attach) are stripped by
 * the strict decoder, so they can never reach `localStorage`.
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
