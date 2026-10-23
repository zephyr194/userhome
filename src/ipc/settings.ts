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
export type LanguagePreference = "system" | "zh-CN" | "en";
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
  readonly language: LanguagePreference;
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
  language?: LanguagePreference;
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

export type DiagnosticRefreshState =
  | "NOT_STARTED"
  | "REFRESHING"
  | "COMPLETE";
export type DiagnosticProviderState =
  | "LOADING"
  | "HEALTHY"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "ERROR";
export type DiagnosticPreferenceState = "VALIDATED" | "SAFE_DEFAULT";

export interface DiagnosticsReport {
  readonly schemaVersion: 1;
  readonly generatedAtEpochMs: number;
  readonly application: {
    readonly name: "UserHome";
    readonly version: string;
  };
  readonly system: {
    readonly architecture: string;
    readonly macosVersion?: string;
  };
  readonly catalog: {
    readonly schemaVersion: number;
    readonly applicationCount: number;
    readonly managedDocumentCount: number;
    readonly serviceCount: number;
  };
  readonly refresh: {
    readonly state: DiagnosticRefreshState;
    readonly completedAtEpochMs?: number;
  };
  readonly providers: readonly [
    { readonly id: "system"; readonly state: DiagnosticProviderState },
    { readonly id: "homebrew"; readonly state: DiagnosticProviderState },
    { readonly id: "candidates"; readonly state: DiagnosticProviderState },
  ];
  readonly preferences: {
    readonly schemaVersion: number;
    readonly state: DiagnosticPreferenceState;
    readonly diagnosticCode?: SettingsDiagnosticCode;
    readonly providerTimeoutPreset: ProviderTimeoutPreset;
  };
  readonly reportText: string;
}

export interface DiagnosticsExport {
  readonly displayLocation: string;
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
  language: "system",
} as const satisfies UserPreferences;

const APPEARANCES: readonly string[] = ["SYSTEM", "LIGHT", "DARK"];
const LANGUAGES: readonly string[] = ["system", "zh-CN", "en"];
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
const DIAGNOSTIC_REFRESH_STATES: readonly string[] = [
  "NOT_STARTED",
  "REFRESHING",
  "COMPLETE",
];
const DIAGNOSTIC_PROVIDER_STATES: readonly string[] = [
  "LOADING",
  "HEALTHY",
  "PARTIAL",
  "UNAVAILABLE",
  "ERROR",
];
const DIAGNOSTIC_PREFERENCE_STATES: readonly string[] = [
  "VALIDATED",
  "SAFE_DEFAULT",
];
const DIAGNOSTIC_PROVIDER_IDS = [
  "system",
  "homebrew",
  "candidates",
] as const;

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
    language:
      value.language === undefined
        ? DEFAULT_USER_PREFERENCES.language
        : decodeKnownValue<LanguagePreference>(value.language, LANGUAGES),
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

function decodeSafeInteger(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalSafeInteger(
  value: unknown,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return decodeSafeInteger(value, maximum);
}

function decodeSafeSystemValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !/^[A-Za-z0-9._+-]+$/.test(value)
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeReportText(value: unknown): string {
  const hasUnsafeControlCharacter =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint < 32 && codePoint !== 10) || codePoint === 127;
    });
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 8 * 1024 ||
    !value.startsWith("UserHome Diagnostics\n") ||
    hasUnsafeControlCharacter
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeDiagnosticProvider<T extends DiagnosticsReport["providers"][number]["id"]>(
  value: unknown,
  id: T,
): { readonly id: T; readonly state: DiagnosticProviderState } {
  if (!isRecord(value) || value.id !== id) {
    throw createInternalError();
  }
  return {
    id,
    state: decodeKnownValue<DiagnosticProviderState>(
      value.state,
      DIAGNOSTIC_PROVIDER_STATES,
    ),
  };
}

const DIAGNOSTICS_REPORT_KEYS = [
  "schemaVersion",
  "generatedAtEpochMs",
  "application",
  "system",
  "catalog",
  "refresh",
  "providers",
  "preferences",
  "reportText",
] as const;

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => key in record)
  );
}

function decodeDiagnosticsReport(value: unknown): DiagnosticsReport {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DIAGNOSTICS_REPORT_KEYS) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.application) ||
    value.application.name !== "UserHome" ||
    !isRecord(value.system) ||
    !isRecord(value.catalog) ||
    !isRecord(value.refresh) ||
    !Array.isArray(value.providers) ||
    value.providers.length !== DIAGNOSTIC_PROVIDER_IDS.length ||
    !isRecord(value.preferences)
  ) {
    throw createInternalError();
  }

  const providers: DiagnosticsReport["providers"] = [
    decodeDiagnosticProvider(value.providers[0], "system"),
    decodeDiagnosticProvider(value.providers[1], "homebrew"),
    decodeDiagnosticProvider(value.providers[2], "candidates"),
  ];

  const macosVersion =
    value.system.macosVersion === undefined ||
    value.system.macosVersion === null
      ? undefined
      : decodeSafeSystemValue(value.system.macosVersion);
  const completedAtEpochMs = decodeOptionalSafeInteger(
    value.refresh.completedAtEpochMs,
    Number.MAX_SAFE_INTEGER,
  );
  const diagnosticCode =
    value.preferences.diagnosticCode === undefined ||
    value.preferences.diagnosticCode === null
      ? undefined
      : decodeKnownValue<SettingsDiagnosticCode>(
          value.preferences.diagnosticCode,
          DIAGNOSTIC_CODES,
        );

  return {
    schemaVersion: 1,
    generatedAtEpochMs: decodeSafeInteger(
      value.generatedAtEpochMs,
      Number.MAX_SAFE_INTEGER,
    ),
    application: {
      name: "UserHome",
      version: decodeSafeSystemValue(value.application.version),
    },
    system: {
      architecture: decodeSafeSystemValue(value.system.architecture),
      ...(macosVersion === undefined ? {} : { macosVersion }),
    },
    catalog: {
      schemaVersion: decodeSafeInteger(value.catalog.schemaVersion, 1_000),
      applicationCount: decodeSafeInteger(
        value.catalog.applicationCount,
        100_000,
      ),
      managedDocumentCount: decodeSafeInteger(
        value.catalog.managedDocumentCount,
        1_000_000,
      ),
      serviceCount: decodeSafeInteger(value.catalog.serviceCount, 100_000),
    },
    refresh: {
      state: decodeKnownValue<DiagnosticRefreshState>(
        value.refresh.state,
        DIAGNOSTIC_REFRESH_STATES,
      ),
      ...(completedAtEpochMs === undefined ? {} : { completedAtEpochMs }),
    },
    providers,
    preferences: {
      schemaVersion: decodeSafeInteger(
        value.preferences.schemaVersion,
        1_000,
      ),
      state: decodeKnownValue<DiagnosticPreferenceState>(
        value.preferences.state,
        DIAGNOSTIC_PREFERENCE_STATES,
      ),
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
      providerTimeoutPreset: decodeKnownValue<ProviderTimeoutPreset>(
        value.preferences.providerTimeoutPreset,
        PROVIDER_TIMEOUT_PRESETS,
      ),
    },
    reportText: decodeReportText(value.reportText),
  };
}

function decodeDiagnosticsExport(value: unknown): DiagnosticsExport {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  return {
    displayLocation: decodeSafeDisplayPath(value.displayLocation),
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

export function getDiagnosticsReport(): Promise<DiagnosticsReport> {
  return invokeCommand("get_diagnostics_report", decodeDiagnosticsReport);
}

export function exportDiagnosticsReport(): Promise<DiagnosticsExport> {
  return invokeCommand(
    "export_diagnostics_report",
    decodeDiagnosticsExport,
  );
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
