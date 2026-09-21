import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";
import { decodeSafeDisplayPath } from "./config";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

export const SETTINGS_SCHEMA_VERSION = 1 as const;

export type Appearance = "SYSTEM" | "LIGHT" | "DARK";
export type CloseBehavior = "KEEP_RUNNING_IN_TRAY" | "QUIT_APPLICATION";
export type ProviderTimeoutPreset = "SHORT" | "STANDARD" | "EXTENDED";
export type PreferredEditorMode = "STRUCTURED" | "RAW";
export type BackupRetention = 5 | 10 | 20;
export type OptionalDiscoveryRoot =
  | "HOME"
  | "XDG_CONFIG_HOME"
  | "APPLICATION_SUPPORT"
  | "HOMEBREW_PREFIX";

export interface UserPreferences {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly appearance: Appearance;
  readonly openWindowOnLaunch: boolean;
  readonly closeBehavior: CloseBehavior;
  readonly restoreSelection: boolean;
  readonly refreshOnLaunch: boolean;
  readonly refreshOnReopen: boolean;
  readonly providerTimeoutPreset: ProviderTimeoutPreset;
  readonly preferredEditorMode: PreferredEditorMode;
  readonly backupRetention: BackupRetention;
  readonly optionalDiscoveryRoots: readonly OptionalDiscoveryRoot[];
}

export interface UpdatePreferencesRequest {
  appearance?: Appearance;
  openWindowOnLaunch?: boolean;
  closeBehavior?: CloseBehavior;
  restoreSelection?: boolean;
  refreshOnLaunch?: boolean;
  refreshOnReopen?: boolean;
  providerTimeoutPreset?: ProviderTimeoutPreset;
  preferredEditorMode?: PreferredEditorMode;
  backupRetention?: BackupRetention;
  optionalDiscoveryRoots?: readonly OptionalDiscoveryRoot[];
}

export type SettingsDiagnosticCode =
  | "READ_FAILED"
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_VERSION";

export interface SettingsDiagnostic {
  code: SettingsDiagnosticCode;
  message: string;
}

export interface LoadedPreferences {
  preferences: UserPreferences;
  diagnostic?: SettingsDiagnostic;
}

export interface BackupStorageSummary {
  displayLocation: string;
  backupCount: number;
  sizeBytes: number;
}

export const DEFAULT_USER_PREFERENCES = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  appearance: "SYSTEM",
  openWindowOnLaunch: true,
  closeBehavior: "KEEP_RUNNING_IN_TRAY",
  restoreSelection: true,
  refreshOnLaunch: true,
  refreshOnReopen: true,
  providerTimeoutPreset: "STANDARD",
  preferredEditorMode: "STRUCTURED",
  backupRetention: 20,
  optionalDiscoveryRoots: [
    "HOME",
    "XDG_CONFIG_HOME",
    "APPLICATION_SUPPORT",
    "HOMEBREW_PREFIX",
  ],
} as const satisfies UserPreferences;

const APPEARANCES: readonly string[] = ["SYSTEM", "LIGHT", "DARK"];
const CLOSE_BEHAVIORS: readonly string[] = [
  "KEEP_RUNNING_IN_TRAY",
  "QUIT_APPLICATION",
];
const PROVIDER_TIMEOUT_PRESETS: readonly string[] = [
  "SHORT",
  "STANDARD",
  "EXTENDED",
];
const PREFERRED_EDITOR_MODES: readonly string[] = ["STRUCTURED", "RAW"];
const BACKUP_RETENTION_PRESETS: readonly number[] = [5, 10, 20];
const OPTIONAL_DISCOVERY_ROOTS: readonly string[] = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPLICATION_SUPPORT",
  "HOMEBREW_PREFIX",
];
const DIAGNOSTIC_CODES: readonly string[] = [
  "READ_FAILED",
  "INVALID_DOCUMENT",
  "UNSUPPORTED_VERSION",
];

function decodeKnownValue<T extends string>(
  value: unknown,
  allowed: readonly string[],
): T {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

function decodeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw createInternalError();
  }
  return value;
}

function decodeBackupRetention(value: unknown): BackupRetention {
  if (
    typeof value !== "number" ||
    !BACKUP_RETENTION_PRESETS.includes(value)
  ) {
    throw createInternalError();
  }
  return value as BackupRetention;
}

function decodeOptionalDiscoveryRoots(
  value: unknown,
): readonly OptionalDiscoveryRoot[] {
  if (!Array.isArray(value) || value.length > OPTIONAL_DISCOVERY_ROOTS.length) {
    throw createInternalError();
  }
  const roots = value.map((root) =>
    decodeKnownValue<OptionalDiscoveryRoot>(root, OPTIONAL_DISCOVERY_ROOTS),
  );
  if (new Set(roots).size !== roots.length) {
    throw createInternalError();
  }
  return roots;
}

function decodePreferences(value: unknown): UserPreferences {
  if (!isRecord(value) || value.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw createInternalError();
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    appearance: decodeKnownValue<Appearance>(value.appearance, APPEARANCES),
    openWindowOnLaunch: decodeBoolean(value.openWindowOnLaunch),
    closeBehavior: decodeKnownValue<CloseBehavior>(
      value.closeBehavior,
      CLOSE_BEHAVIORS,
    ),
    restoreSelection: decodeBoolean(value.restoreSelection),
    refreshOnLaunch: decodeBoolean(value.refreshOnLaunch),
    refreshOnReopen: decodeBoolean(value.refreshOnReopen),
    providerTimeoutPreset: decodeKnownValue<ProviderTimeoutPreset>(
      value.providerTimeoutPreset,
      PROVIDER_TIMEOUT_PRESETS,
    ),
    preferredEditorMode: decodeKnownValue<PreferredEditorMode>(
      value.preferredEditorMode,
      PREFERRED_EDITOR_MODES,
    ),
    backupRetention: decodeBackupRetention(value.backupRetention),
    optionalDiscoveryRoots: decodeOptionalDiscoveryRoots(
      value.optionalDiscoveryRoots,
    ),
  };
}

function decodeDiagnostic(value: unknown): SettingsDiagnostic | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > 512 ||
    hasControlCharacters(value.message)
  ) {
    throw createInternalError();
  }
  return {
    code: decodeKnownValue<SettingsDiagnosticCode>(
      value.code,
      DIAGNOSTIC_CODES,
    ),
    message: value.message,
  };
}

function decodeLoadedPreferences(value: unknown): LoadedPreferences {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  const diagnostic = decodeDiagnostic(value.diagnostic);
  return {
    preferences: decodePreferences(value.preferences),
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

function decodeBackupStorageSummary(value: unknown): BackupStorageSummary {
  if (
    !isRecord(value) ||
    typeof value.backupCount !== "number" ||
    !Number.isSafeInteger(value.backupCount) ||
    value.backupCount < 0 ||
    typeof value.sizeBytes !== "number" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    throw createInternalError();
  }
  return {
    displayLocation: decodeSafeDisplayPath(value.displayLocation),
    backupCount: value.backupCount,
    sizeBytes: value.sizeBytes,
  };
}

export function getPreferences(): Promise<LoadedPreferences> {
  return invokeCommand("get_preferences", decodeLoadedPreferences);
}

export function updatePreferences(
  patch: UpdatePreferencesRequest,
): Promise<LoadedPreferences> {
  return invokeCommand("update_preferences", decodeLoadedPreferences, {
    patch,
  });
}

export function resetPreferences(): Promise<LoadedPreferences> {
  return invokeCommand("reset_preferences", decodeLoadedPreferences);
}

export function getBackupStorage(): Promise<BackupStorageSummary> {
  return invokeCommand("get_backup_storage", decodeBackupStorageSummary);
}

export function previewClearBackups(): Promise<OperationPreview> {
  return invokeCommand("preview_clear_backups", decodeOperationPreview);
}

export function executeClearBackups(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_clear_backups", decodeOperationDetails, {
    operationId,
  });
}
