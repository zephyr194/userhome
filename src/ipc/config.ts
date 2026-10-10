import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";
import {
  decodeOperationPreview,
  decodeOperationDetails,
  type OperationDetails,
  type OperationPreview,
} from "./operations";
import { CONFIG_FORMATS, type ConfigFormat } from "./catalog";

export type ConfigSensitivity = "STANDARD" | "SENSITIVE" | "SECRET";
export type ConfigEntryKind = "FILE" | "DIRECTORY";
export type ConfigDocumentState =
  | "MISSING"
  | "READY"
  | "INVALID"
  | "REDACTED"
  | "TOO_LARGE"
  | "PERMISSION_DENIED"
  | "UNSAFE_SYMLINK"
  | "UNSUPPORTED_FORMAT"
  | "IO_ERROR";
export type ConfigNextAction =
  | "NONE"
  | "CREATE_FILE"
  | "FIX_CONTENT"
  | "VIEW_REDACTED"
  | "REDUCE_SIZE"
  | "REVIEW_PERMISSIONS"
  | "REPAIR_SYMLINK"
  | "UPDATE_CATALOG"
  | "RETRY";
export type ConfigWritePolicy =
  | "MANAGED_BLOCK"
  | "READ_ONLY"
  | "STRUCTURED_AND_RAW"
  | "RAW_VALIDATED";

export interface ConfigDiagnostic {
  appId: string;
  configId: string;
  variantId: string;
  displayPath: string;
  state: ConfigDocumentState;
  retryable: boolean;
  nextAction: ConfigNextAction;
}

export interface ConfigSummary extends ConfigDiagnostic {
  format: ConfigFormat;
  sensitivity: ConfigSensitivity;
  writePolicy: ConfigWritePolicy;
  exists: boolean;
  entryKind?: ConfigEntryKind;
  sizeBytes?: number;
  modifiedAtEpochMs?: number;
  mode?: number;
  contentHash?: string;
  symlink?: { targetDisplayPath: string };
}

export interface ConfigDocument extends ConfigSummary {
  content?: string;
  contentRedacted: boolean;
  structured?: Record<string, unknown>;
}

export interface ConfigVariantResolution extends ConfigSummary {
  selected: boolean;
}

export interface ConfigDiffLine {
  kind: "REMOVED" | "ADDED";
  text: string;
}

export interface ConfigDiff {
  lines: ConfigDiffLine[];
  redacted: boolean;
  truncated: boolean;
}

export interface ConfigWritePreview extends OperationPreview {
  currentHash: string;
  proposedHash: string;
  diff: ConfigDiff;
}

export interface BackupSummary {
  backupId: string;
  appId: string;
  configId: string;
  createdAtEpochMs: number;
  contentHash: string;
  sizeBytes: number;
  mode: number;
}

export type SchemaPresentationState = "READY" | "UNAVAILABLE" | "DISABLED";
export type SchemaDisabledCode =
  | "NO_SCHEMA"
  | "INVALID_CATALOG"
  | "VERSION_MISMATCH"
  | "CAPABILITY_MISMATCH"
  | "APPLICABILITY_MISMATCH"
  | "DOCUMENT_UNAVAILABLE"
  | "CURRENT_VALUE_MISMATCH"
  | "UNSAFE_SECRET_POLICY";
export type SchemaFieldKind =
  | "BOOLEAN"
  | "STRING"
  | "INTEGER"
  | "ENUM"
  | "STRING_LIST"
  | "SECRET";
export type ConfigPresetKind =
  | "COMPLETE_TEMPLATE"
  | "FIELD_GROUP"
  | "RECOMMENDED_VALUES";

export type SchemaValue =
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "STRING"; value: string }
  | { kind: "INTEGER"; value: number }
  | { kind: "ENUM"; value: string }
  | { kind: "STRING_LIST"; value: string[] };

export type SchemaFieldType =
  | { kind: "BOOLEAN"; defaultValue?: boolean }
  | {
      kind: "STRING";
      minimumLength: number;
      maximumLength: number;
      pattern?: string;
      defaultValue?: string;
    }
  | {
      kind: "INTEGER";
      minimum: number;
      maximum: number;
      defaultValue?: number;
    }
  | {
      kind: "ENUM";
      options: { value: string; label: string }[];
      defaultValue?: string;
    }
  | {
      kind: "STRING_LIST";
      maximumItems: number;
      maximumItemLength: number;
      defaultValue?: string[];
    }
  | { kind: "SECRET"; replacementOnly: true };

export type CurrentSchemaField =
  | { state: "UNSET" }
  | { state: "VALUE"; value: SchemaValue }
  | { state: "REPLACEMENT_ONLY" };

export interface SchemaField {
  fieldId: string;
  label: string;
  description: string;
  order: number;
  optional: boolean;
  sensitivity: ConfigSensitivity;
  readPolicy: "READABLE" | "REDACTED" | "OMITTED";
  writePolicy: "READ_WRITE" | "REPLACEMENT_ONLY";
  sourceIds: string[];
  fieldType: SchemaFieldType;
  current: CurrentSchemaField;
}

export interface ConfigSchemaDefinition {
  schemaId: string;
  schemaVersion: number;
  label: string;
  description: string;
  applicability: {
    minimumAppVersion?: string;
    maximumAppVersion?: string;
    variantIds: string[];
    platforms: "MACOS"[];
    featureFlags: string[];
  };
  sourceIds: string[];
  fields: SchemaField[];
}

export interface ConfigPresetDefinition {
  presetId: string;
  presetVersion: number;
  label: string;
  description: string;
  kind: ConfigPresetKind;
  target: "NEW_FILE_ONLY" | "EXISTING_OR_NEW";
  mergeStrategy:
    | "REPLACE_SCHEMA_PROJECTION"
    | "NO_VALUES"
    | "MERGE_DECLARED_FIELDS";
  applicability: {
    minimumAppVersion?: string;
    maximumAppVersion?: string;
    variantIds: string[];
    featureFlags: string[];
  };
  fieldIds: string[];
  values: { fieldId: string; value: SchemaValue }[];
  sourceIds: string[];
  available: boolean;
  warnings: string[];
}

export interface ConfigSchemaPresentation {
  state: SchemaPresentationState;
  appId: string;
  configId: string;
  variantId?: string;
  documentState?: ConfigDocumentState;
  expectedHash?: string;
  writable: boolean;
  disabledReason?: { code: SchemaDisabledCode; message: string };
  schema?: ConfigSchemaDefinition;
  presets: ConfigPresetDefinition[];
}

export type SchemaPatchValue =
  | { kind: "BOOLEAN"; value: boolean }
  | { kind: "STRING"; value: string }
  | { kind: "INTEGER"; value: number }
  | { kind: "ENUM"; value: string }
  | { kind: "STRING_LIST"; value: string[] }
  | { kind: "SECRET"; replacement: string };

export interface SchemaFieldPatch {
  fieldId: string;
  value: SchemaPatchValue;
}

const SENSITIVITIES: readonly string[] = ["STANDARD", "SENSITIVE", "SECRET"];
const ENTRY_KINDS: readonly string[] = ["FILE", "DIRECTORY"];
const DOCUMENT_STATES: readonly ConfigDocumentState[] = [
  "MISSING",
  "READY",
  "INVALID",
  "REDACTED",
  "TOO_LARGE",
  "PERMISSION_DENIED",
  "UNSAFE_SYMLINK",
  "UNSUPPORTED_FORMAT",
  "IO_ERROR",
];
const NEXT_ACTION_BY_STATE: Readonly<
  Record<ConfigDocumentState, ConfigNextAction>
> = {
  MISSING: "CREATE_FILE",
  READY: "NONE",
  INVALID: "FIX_CONTENT",
  REDACTED: "VIEW_REDACTED",
  TOO_LARGE: "REDUCE_SIZE",
  PERMISSION_DENIED: "REVIEW_PERMISSIONS",
  UNSAFE_SYMLINK: "REPAIR_SYMLINK",
  UNSUPPORTED_FORMAT: "UPDATE_CATALOG",
  IO_ERROR: "RETRY",
};
const WRITE_POLICIES: readonly string[] = [
  "MANAGED_BLOCK",
  "READ_ONLY",
  "STRUCTURED_AND_RAW",
  "RAW_VALIDATED",
];
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCHEMA_STATES: readonly SchemaPresentationState[] = [
  "READY",
  "UNAVAILABLE",
  "DISABLED",
];
const SCHEMA_DISABLED_CODES: readonly SchemaDisabledCode[] = [
  "NO_SCHEMA",
  "INVALID_CATALOG",
  "VERSION_MISMATCH",
  "CAPABILITY_MISMATCH",
  "APPLICABILITY_MISMATCH",
  "DOCUMENT_UNAVAILABLE",
  "CURRENT_VALUE_MISMATCH",
  "UNSAFE_SECRET_POLICY",
];
const PRESET_KINDS: readonly ConfigPresetKind[] = [
  "COMPLETE_TEMPLATE",
  "FIELD_GROUP",
  "RECOMMENDED_VALUES",
];

function decodeIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeBoundedText(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeIdentifierList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw createInternalError();
  }
  const values = value.map(decodeIdentifier);
  if (new Set(values).size !== values.length) throw createInternalError();
  return values;
}

function decodeOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return decodeBoundedText(value);
}

function decodeSchemaValue(value: unknown): SchemaValue {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw createInternalError();
  }
  switch (value.kind) {
    case "BOOLEAN":
      if (typeof value.value !== "boolean") throw createInternalError();
      return { kind: "BOOLEAN", value: value.value };
    case "STRING":
    case "ENUM":
      if (
        typeof value.value !== "string" ||
        value.value.length > 4096 ||
        value.value.includes("\0")
      ) {
        throw createInternalError();
      }
      return { kind: value.kind, value: value.value };
    case "INTEGER":
      if (
        typeof value.value !== "number" ||
        !Number.isSafeInteger(value.value)
      ) {
        throw createInternalError();
      }
      return { kind: "INTEGER", value: value.value };
    case "STRING_LIST":
      if (
        !Array.isArray(value.value) ||
        value.value.length > 256 ||
        !value.value.every(
          (entry) =>
            typeof entry === "string" &&
            entry.length <= 4096 &&
            !entry.includes("\0"),
        )
      ) {
        throw createInternalError();
      }
      return { kind: "STRING_LIST", value: [...value.value] };
    default:
      throw createInternalError();
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function schemaValueMatchesField(
  value: SchemaValue,
  fieldType: SchemaFieldType,
): boolean {
  if (value.kind !== fieldType.kind) return false;
  switch (fieldType.kind) {
    case "BOOLEAN":
      return value.kind === "BOOLEAN";
    case "STRING": {
      if (value.kind !== "STRING") return false;
      const length = utf8Length(value.value);
      if (
        length < fieldType.minimumLength ||
        length > fieldType.maximumLength
      ) {
        return false;
      }
      if (fieldType.pattern) {
        try {
          return new RegExp(fieldType.pattern).test(value.value);
        } catch {
          return false;
        }
      }
      return true;
    }
    case "INTEGER":
      return (
        value.kind === "INTEGER" &&
        value.value >= fieldType.minimum &&
        value.value <= fieldType.maximum
      );
    case "ENUM":
      return (
        value.kind === "ENUM" &&
        fieldType.options.some((option) => option.value === value.value)
      );
    case "STRING_LIST":
      return (
        value.kind === "STRING_LIST" &&
        value.value.length <= fieldType.maximumItems &&
        value.value.every(
          (entry) => utf8Length(entry) <= fieldType.maximumItemLength,
        )
      );
  }
}

function decodeSchemaFieldType(value: unknown): SchemaFieldType {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw createInternalError();
  }
  switch (value.kind) {
    case "BOOLEAN":
      if (
        value.defaultValue !== null &&
        value.defaultValue !== undefined &&
        typeof value.defaultValue !== "boolean"
      ) {
        throw createInternalError();
      }
      return {
        kind: "BOOLEAN",
        ...(typeof value.defaultValue === "boolean"
          ? { defaultValue: value.defaultValue }
          : {}),
      };
    case "STRING": {
      const minimumLength = decodeOptionalSafeInteger(value.minimumLength);
      const maximumLength = decodeOptionalSafeInteger(value.maximumLength);
      if (
        minimumLength === undefined ||
        maximumLength === undefined ||
        minimumLength > maximumLength ||
        maximumLength > 4096
      ) {
        throw createInternalError();
      }
      const defaultValue =
        value.defaultValue == null
          ? undefined
          : typeof value.defaultValue === "string"
            ? value.defaultValue
            : (() => {
                throw createInternalError();
              })();
      const pattern = decodeOptionalText(value.pattern);
      let compiledPattern: RegExp | undefined;
      if (pattern) {
        try {
          compiledPattern = new RegExp(pattern);
        } catch {
          throw createInternalError();
        }
      }
      if (
        defaultValue !== undefined &&
        (defaultValue.includes("\0") ||
          utf8Length(defaultValue) < minimumLength ||
          utf8Length(defaultValue) > maximumLength ||
          (compiledPattern !== undefined &&
            !compiledPattern.test(defaultValue)))
      ) {
        throw createInternalError();
      }
      return {
        kind: "STRING",
        minimumLength,
        maximumLength,
        ...(pattern ? { pattern } : {}),
        ...(defaultValue === undefined ? {} : { defaultValue }),
      };
    }
    case "INTEGER": {
      if (
        typeof value.minimum !== "number" ||
        !Number.isSafeInteger(value.minimum) ||
        typeof value.maximum !== "number" ||
        !Number.isSafeInteger(value.maximum) ||
        value.minimum > value.maximum
      ) {
        throw createInternalError();
      }
      const defaultValue =
        value.defaultValue == null
          ? undefined
          : typeof value.defaultValue === "number" &&
              Number.isSafeInteger(value.defaultValue)
            ? value.defaultValue
            : (() => {
                throw createInternalError();
              })();
      if (
        defaultValue !== undefined &&
        (defaultValue < value.minimum || defaultValue > value.maximum)
      ) {
        throw createInternalError();
      }
      return {
        kind: "INTEGER",
        minimum: value.minimum,
        maximum: value.maximum,
        ...(defaultValue === undefined ? {} : { defaultValue }),
      };
    }
    case "ENUM": {
      if (
        !Array.isArray(value.options) ||
        value.options.length === 0 ||
        value.options.length > 64
      ) {
        throw createInternalError();
      }
      const options = value.options.map((option) => {
        if (!isRecord(option)) throw createInternalError();
        return {
          value: decodeBoundedText(option.value),
          label: decodeBoundedText(option.label),
        };
      });
      if (new Set(options.map((option) => option.value)).size !== options.length) {
        throw createInternalError();
      }
      const defaultValue =
        value.defaultValue == null
          ? undefined
          : typeof value.defaultValue === "string"
            ? value.defaultValue
            : (() => {
                throw createInternalError();
              })();
      if (
        defaultValue !== undefined &&
        !options.some((option) => option.value === defaultValue)
      ) {
        throw createInternalError();
      }
      return {
        kind: "ENUM",
        options,
        ...(defaultValue === undefined ? {} : { defaultValue }),
      };
    }
    case "STRING_LIST": {
      const maximumItems = decodeOptionalSafeInteger(value.maximumItems);
      const maximumItemLength = decodeOptionalSafeInteger(
        value.maximumItemLength,
      );
      if (
        maximumItems === undefined ||
        maximumItems === 0 ||
        maximumItems > 256 ||
        maximumItemLength === undefined ||
        maximumItemLength === 0 ||
        maximumItemLength > 4096
      ) {
        throw createInternalError();
      }
      const defaultValue =
        value.defaultValue == null
          ? undefined
          : Array.isArray(value.defaultValue) &&
              value.defaultValue.every(
                (entry) =>
                  typeof entry === "string" &&
                  !entry.includes("\0") &&
                  utf8Length(entry) <= maximumItemLength,
              )
            ? [...value.defaultValue]
            : (() => {
                throw createInternalError();
              })();
      if (defaultValue && defaultValue.length > maximumItems) {
        throw createInternalError();
      }
      return {
        kind: "STRING_LIST",
        maximumItems,
        maximumItemLength,
        ...(defaultValue === undefined ? {} : { defaultValue }),
      };
    }
    case "SECRET":
      if (value.replacementOnly !== true || "defaultValue" in value) {
        throw createInternalError();
      }
      return { kind: "SECRET", replacementOnly: true };
    default:
      throw createInternalError();
  }
}

function decodeSchemaField(
  value: unknown,
  index: number,
  allowRequiredUnset: boolean,
): SchemaField {
  if (
    !isRecord(value) ||
    value.order !== index ||
    typeof value.optional !== "boolean" ||
    typeof value.sensitivity !== "string" ||
    !SENSITIVITIES.includes(value.sensitivity) ||
    !["READABLE", "REDACTED", "OMITTED"].includes(
      String(value.readPolicy),
    ) ||
    !["READ_WRITE", "REPLACEMENT_ONLY"].includes(
      String(value.writePolicy),
    ) ||
    !isRecord(value.current)
  ) {
    throw createInternalError();
  }
  const fieldType = decodeSchemaFieldType(value.fieldType);
  let current: CurrentSchemaField;
  if (fieldType.kind === "SECRET") {
    if (
      value.current.state !== "REPLACEMENT_ONLY" ||
      "value" in value.current ||
      value.sensitivity !== "SECRET" ||
      value.writePolicy !== "REPLACEMENT_ONLY" ||
      value.readPolicy !== "OMITTED"
    ) {
      throw createInternalError();
    }
    current = { state: "REPLACEMENT_ONLY" };
  } else if (value.current.state === "UNSET") {
    if (
      "value" in value.current ||
      (value.optional !== true && !allowRequiredUnset)
    ) {
      throw createInternalError();
    }
    current = { state: "UNSET" };
  } else if (value.current.state === "VALUE") {
    const currentValue = decodeSchemaValue(value.current.value);
    if (!schemaValueMatchesField(currentValue, fieldType)) {
      throw createInternalError();
    }
    current = { state: "VALUE", value: currentValue };
  } else {
    throw createInternalError();
  }
  return {
    fieldId: decodeIdentifier(value.fieldId),
    label: decodeBoundedText(value.label),
    description: decodeBoundedText(value.description),
    order: index,
    optional: value.optional,
    sensitivity: value.sensitivity as ConfigSensitivity,
    readPolicy: value.readPolicy as SchemaField["readPolicy"],
    writePolicy: value.writePolicy as SchemaField["writePolicy"],
    sourceIds: decodeIdentifierList(value.sourceIds, 16),
    fieldType,
    current,
  };
}

function decodeApplicability(
  value: unknown,
  includePlatforms: boolean,
): ConfigSchemaDefinition["applicability"] | ConfigPresetDefinition["applicability"] {
  if (!isRecord(value)) throw createInternalError();
  const base = {
    ...(decodeOptionalText(value.minimumAppVersion)
      ? { minimumAppVersion: decodeOptionalText(value.minimumAppVersion) }
      : {}),
    ...(decodeOptionalText(value.maximumAppVersion)
      ? { maximumAppVersion: decodeOptionalText(value.maximumAppVersion) }
      : {}),
    variantIds: decodeIdentifierList(value.variantIds, 8),
    featureFlags: decodeIdentifierList(value.featureFlags, 32),
  };
  if (!includePlatforms) return base;
  if (
    !Array.isArray(value.platforms) ||
    value.platforms.length > 1 ||
    !value.platforms.every((platform) => platform === "MACOS")
  ) {
    throw createInternalError();
  }
  return { ...base, platforms: [...value.platforms] as "MACOS"[] };
}

function decodePreset(
  value: unknown,
  schema: ConfigSchemaDefinition,
): ConfigPresetDefinition {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    !PRESET_KINDS.includes(value.kind as ConfigPresetKind) ||
    !["NEW_FILE_ONLY", "EXISTING_OR_NEW"].includes(String(value.target)) ||
    ![
      "REPLACE_SCHEMA_PROJECTION",
      "NO_VALUES",
      "MERGE_DECLARED_FIELDS",
    ].includes(String(value.mergeStrategy)) ||
    typeof value.available !== "boolean" ||
    !Array.isArray(value.values) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(
      (warning) => typeof warning === "string" && warning.length <= 512,
    )
  ) {
    throw createInternalError();
  }
  const fieldIds = decodeIdentifierList(value.fieldIds, 64);
  const fields = new Map(schema.fields.map((field) => [field.fieldId, field]));
  if (fieldIds.some((fieldId) => !fields.has(fieldId))) {
    throw createInternalError();
  }
  const values = value.values.map((entry) => {
    if (!isRecord(entry)) throw createInternalError();
    const fieldId = decodeIdentifier(entry.fieldId);
    const field = fields.get(fieldId);
    const decoded = decodeSchemaValue(entry.value);
    if (
      !field ||
      field.fieldType.kind === "SECRET" ||
      !schemaValueMatchesField(decoded, field.fieldType)
    ) {
      throw createInternalError();
    }
    return { fieldId, value: decoded };
  });
  if (
    new Set(values.map((entry) => entry.fieldId)).size !== values.length ||
    values.some((entry) => !fieldIds.includes(entry.fieldId))
  ) {
    throw createInternalError();
  }
  const kind = value.kind as ConfigPresetKind;
  if (
    (kind === "FIELD_GROUP" &&
      (values.length !== 0 || value.mergeStrategy !== "NO_VALUES")) ||
    (kind === "RECOMMENDED_VALUES" &&
      (values.length !== fieldIds.length ||
        value.mergeStrategy !== "MERGE_DECLARED_FIELDS")) ||
    (kind === "COMPLETE_TEMPLATE" &&
      (values.length !== fieldIds.length ||
        value.target !== "NEW_FILE_ONLY" ||
        value.mergeStrategy !== "REPLACE_SCHEMA_PROJECTION"))
  ) {
    throw createInternalError();
  }
  return {
    presetId: decodeIdentifier(value.presetId),
    presetVersion: decodePositiveVersion(value.presetVersion),
    label: decodeBoundedText(value.label),
    description: decodeBoundedText(value.description),
    kind,
    target: value.target as ConfigPresetDefinition["target"],
    mergeStrategy:
      value.mergeStrategy as ConfigPresetDefinition["mergeStrategy"],
    applicability: decodeApplicability(
      value.applicability,
      false,
    ) as ConfigPresetDefinition["applicability"],
    fieldIds,
    values,
    sourceIds: decodeIdentifierList(value.sourceIds, 16),
    available: value.available,
    warnings: [...value.warnings],
  };
}

function decodePositiveVersion(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 65_535
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeConfigSchemaPresentation(
  value: unknown,
): ConfigSchemaPresentation {
  if (
    !isRecord(value) ||
    typeof value.state !== "string" ||
    !SCHEMA_STATES.includes(value.state as SchemaPresentationState) ||
    typeof value.writable !== "boolean" ||
    !Array.isArray(value.presets) ||
    value.presets.length > 32
  ) {
    throw createInternalError();
  }
  const base = {
    state: value.state as SchemaPresentationState,
    appId: decodeIdentifier(value.appId),
    configId: decodeIdentifier(value.configId),
    writable: value.writable,
  };
  if (value.state !== "READY") {
    if (
      value.schema != null ||
      value.expectedHash != null ||
      value.documentState != null ||
      value.presets.length !== 0 ||
      !isRecord(value.disabledReason) ||
      !SCHEMA_DISABLED_CODES.includes(
        value.disabledReason.code as SchemaDisabledCode,
      )
    ) {
      throw createInternalError();
    }
    const code = value.disabledReason.code as SchemaDisabledCode;
    if (
      (value.state === "UNAVAILABLE" && code !== "NO_SCHEMA") ||
      (value.state === "DISABLED" && code === "NO_SCHEMA")
    ) {
      throw createInternalError();
    }
    return {
      ...base,
      state: value.state as SchemaPresentationState,
      ...(value.variantId == null
        ? {}
        : { variantId: decodeIdentifier(value.variantId) }),
      writable: false,
      disabledReason: {
        code,
        message: decodeBoundedText(value.disabledReason.message),
      },
      presets: [],
    };
  }
  if (
    !isRecord(value.schema) ||
    typeof value.variantId !== "string" ||
    typeof value.expectedHash !== "string" ||
    (value.expectedHash !== "MISSING" &&
      !/^[a-f0-9]{64}$/.test(value.expectedHash)) ||
    !DOCUMENT_STATES.includes(value.documentState as ConfigDocumentState) ||
    value.disabledReason != null ||
    !Array.isArray(value.schema.fields) ||
    value.schema.fields.length === 0 ||
    value.schema.fields.length > 64
  ) {
    throw createInternalError();
  }
  const documentState = value.documentState as ConfigDocumentState;
  const fields = value.schema.fields.map((field, index) =>
    decodeSchemaField(field, index, documentState === "MISSING"),
  );
  if (new Set(fields.map((field) => field.fieldId)).size !== fields.length) {
    throw createInternalError();
  }
  const schema: ConfigSchemaDefinition = {
    schemaId: decodeIdentifier(value.schema.schemaId),
    schemaVersion: decodePositiveVersion(value.schema.schemaVersion),
    label: decodeBoundedText(value.schema.label),
    description: decodeBoundedText(value.schema.description),
    applicability: decodeApplicability(
      value.schema.applicability,
      true,
    ) as ConfigSchemaDefinition["applicability"],
    sourceIds: decodeIdentifierList(value.schema.sourceIds, 16),
    fields,
  };
  const variantId = decodeIdentifier(value.variantId);
  if (
    schema.applicability.minimumAppVersion !== undefined ||
    schema.applicability.maximumAppVersion !== undefined ||
    schema.applicability.featureFlags.length !== 0 ||
    (schema.applicability.variantIds.length !== 0 &&
      !schema.applicability.variantIds.includes(variantId)) ||
    (schema.applicability.platforms.length !== 0 &&
      !schema.applicability.platforms.includes("MACOS"))
  ) {
    throw createInternalError();
  }
  const presets = value.presets.map((preset) => decodePreset(preset, schema));
  if (
    new Set(
      presets.map((preset) => `${preset.presetId}:${preset.presetVersion}`),
    ).size !== presets.length ||
    presets.some(
      (preset) =>
        preset.kind === "COMPLETE_TEMPLATE" &&
        preset.available !== (documentState === "MISSING"),
    ) ||
    presets.some(
      (preset) =>
        preset.applicability.minimumAppVersion !== undefined ||
        preset.applicability.maximumAppVersion !== undefined ||
        preset.applicability.featureFlags.length !== 0 ||
        (preset.applicability.variantIds.length !== 0 &&
          !preset.applicability.variantIds.includes(variantId)),
    )
  ) {
    throw createInternalError();
  }
  return {
    ...base,
    state: "READY",
    variantId,
    documentState,
    expectedHash: value.expectedHash,
    schema,
    presets,
  };
}


function decodeOptionalSafeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw createInternalError();
  }
  return value;
}

export function decodeSafeDisplayPath(value: unknown): string {
  const prefix =
    typeof value === "string"
      ? [
          "~/",
          "XDG_CONFIG_HOME/",
          "APPLICATION_SUPPORT/",
          "HOMEBREW_PREFIX/",
          "APP_SUPPORT/",
        ].find((candidate) => value.startsWith(candidate))
      : undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    !prefix
  ) {
    throw createInternalError();
  }
  const segments = value.slice(prefix.length).split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeConfigDiagnostic(value: unknown): ConfigDiagnostic {
  if (
    !isRecord(value) ||
    typeof value.appId !== "string" ||
    typeof value.configId !== "string" ||
    typeof value.variantId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.appId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.configId) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.variantId) ||
    !DOCUMENT_STATES.includes(value.state as ConfigDocumentState) ||
    typeof value.retryable !== "boolean" ||
    typeof value.nextAction !== "string"
  ) {
    throw createInternalError();
  }
  const state = value.state as ConfigDocumentState;
  if (
    value.nextAction !== NEXT_ACTION_BY_STATE[state] ||
    value.retryable !== (state === "IO_ERROR")
  ) {
    throw createInternalError();
  }
  return {
    appId: value.appId,
    configId: value.configId,
    variantId: value.variantId,
    displayPath: decodeSafeDisplayPath(value.displayPath),
    state,
    retryable: value.retryable,
    nextAction: value.nextAction as ConfigNextAction,
  };
}

function decodeConfigSummary(value: unknown): ConfigSummary {
  const diagnostic = decodeConfigDiagnostic(value);
  if (
    !isRecord(value) ||
    typeof value.format !== "string" ||
    !CONFIG_FORMATS.includes(value.format) ||
    typeof value.writePolicy !== "string" ||
    !WRITE_POLICIES.includes(value.writePolicy) ||
    typeof value.exists !== "boolean" ||
    typeof value.sensitivity !== "string" ||
    !SENSITIVITIES.includes(value.sensitivity)
  ) {
    throw createInternalError();
  }
  if (
    value.entryKind !== undefined &&
    value.entryKind !== null &&
    (typeof value.entryKind !== "string" ||
      !ENTRY_KINDS.includes(value.entryKind))
  ) {
    throw createInternalError();
  }
  if (
    value.writePolicy === "READ_ONLY" &&
    value.contentHash !== undefined &&
    value.contentHash !== null
  ) {
    throw createInternalError();
  }
  if (
    (!["READY", "REDACTED"].includes(diagnostic.state) &&
      value.contentHash != null) ||
    (["READY", "REDACTED"].includes(diagnostic.state) &&
      (!value.exists || value.entryKind == null)) ||
    (diagnostic.state === "MISSING" &&
      (value.exists ||
        value.entryKind != null ||
        value.sizeBytes != null ||
        value.modifiedAtEpochMs != null ||
        value.mode != null ||
        value.symlink != null))
  ) {
    throw createInternalError();
  }
  let symlink: ConfigSummary["symlink"];
  if (value.symlink !== undefined && value.symlink !== null) {
    if (
      !isRecord(value.symlink) ||
      typeof value.symlink.targetDisplayPath !== "string"
    ) {
      throw createInternalError();
    }
    symlink = {
      targetDisplayPath: decodeSafeDisplayPath(
        value.symlink.targetDisplayPath,
      ),
    };
  }

  return {
    ...diagnostic,
    format: value.format as ConfigFormat,
    sensitivity: value.sensitivity as ConfigSensitivity,
    writePolicy: value.writePolicy as ConfigWritePolicy,
    exists: value.exists,
    ...(value.entryKind == null
      ? {}
      : { entryKind: value.entryKind as ConfigEntryKind }),
    ...(decodeOptionalSafeInteger(value.sizeBytes) === undefined
      ? {}
      : { sizeBytes: decodeOptionalSafeInteger(value.sizeBytes) }),
    ...(decodeOptionalSafeInteger(value.modifiedAtEpochMs) === undefined
      ? {}
      : { modifiedAtEpochMs: decodeOptionalSafeInteger(value.modifiedAtEpochMs) }),
    ...(decodeOptionalSafeInteger(value.mode) === undefined
      ? {}
      : { mode: decodeOptionalSafeInteger(value.mode) }),
    ...(typeof value.contentHash === "string"
      ? { contentHash: value.contentHash }
      : {}),
    ...(symlink ? { symlink } : {}),
  };
}

function decodeConfigDocument(value: unknown): ConfigDocument {
  const summary = decodeConfigSummary(value);
  if (
    !isRecord(value) ||
    typeof value.contentRedacted !== "boolean" ||
    (value.content !== undefined &&
      value.content !== null &&
      typeof value.content !== "string") ||
    (value.structured !== undefined &&
      value.structured !== null &&
      !isRecord(value.structured))
  ) {
    throw createInternalError();
  }
  if (
    ((summary.state === "READY" || summary.state === "REDACTED") &&
      !summary.exists) ||
    (summary.state === "MISSING" && summary.exists) ||
    (summary.state === "REDACTED" && value.contentRedacted !== true) ||
    (summary.state === "READY" && value.contentRedacted !== false) ||
    (!["READY", "REDACTED"].includes(summary.state) &&
      (value.content != null ||
        value.structured != null ||
        value.contentRedacted !== false))
  ) {
    throw createInternalError();
  }
  return {
    ...summary,
    ...(typeof value.content === "string" ? { content: value.content } : {}),
    contentRedacted: value.contentRedacted,
    ...(isRecord(value.structured)
      ? { structured: { ...value.structured } }
      : {}),
  };
}

export function listConfigs(appId: string): Promise<ConfigSummary[]> {
  return invokeCommand("list_configs", (value) => {
    if (!Array.isArray(value)) throw createInternalError();
    return value.map(decodeConfigSummary);
  }, { appId });
}

export function readConfig(
  appId: string,
  configId: string,
  variantId?: string,
): Promise<ConfigDocument> {
  return invokeCommand("read_config", decodeConfigDocument, {
    key: { appId, configId, ...(variantId ? { variantId } : {}) },
  });
}

export function resolveConfigVariants(
  appId: string,
  configId: string,
): Promise<ConfigVariantResolution[]> {
  return invokeCommand("resolve_config_variants", (value) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
      throw createInternalError();
    }
    const variants = value.map((variant) => {
      const summary = decodeConfigSummary(variant);
      if (!isRecord(variant) || typeof variant.selected !== "boolean") {
        throw createInternalError();
      }
      return { ...summary, selected: variant.selected };
    });
    if (
      new Set(variants.map((variant) => variant.variantId)).size !==
        variants.length ||
      variants.filter((variant) => variant.selected).length !== 1
    ) {
      throw createInternalError();
    }
    return variants;
  }, { key: { appId, configId } });
}

export function diagnoseConfig(
  appId: string,
  configId: string,
  variantId?: string,
): Promise<ConfigDiagnostic> {
  return invokeCommand("diagnose_config", decodeConfigDiagnostic, {
    key: { appId, configId, ...(variantId ? { variantId } : {}) },
  });
}

export function getConfigSchema(
  appId: string,
  configId: string,
  variantId?: string,
): Promise<ConfigSchemaPresentation> {
  return invokeCommand("get_config_schema", decodeConfigSchemaPresentation, {
    key: { appId, configId, ...(variantId ? { variantId } : {}) },
  });
}

function decodeConfigDiff(value: unknown): ConfigDiff {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    typeof value.redacted !== "boolean" ||
    typeof value.truncated !== "boolean"
  ) {
    throw createInternalError();
  }
  const lines = value.lines.map((line) => {
    if (
      !isRecord(line) ||
      (line.kind !== "REMOVED" && line.kind !== "ADDED") ||
      typeof line.text !== "string"
    ) {
      throw createInternalError();
    }
    return { kind: line.kind, text: line.text } satisfies ConfigDiffLine;
  });
  return { lines, redacted: value.redacted, truncated: value.truncated };
}

function decodeConfigWritePreview(value: unknown): ConfigWritePreview {
  const operation = decodeOperationPreview(value);
  if (
    !isRecord(value) ||
    typeof value.currentHash !== "string" ||
    typeof value.proposedHash !== "string"
  ) {
    throw createInternalError();
  }
  return {
    ...operation,
    currentHash: value.currentHash,
    proposedHash: value.proposedHash,
    diff: decodeConfigDiff(value.diff),
  };
}

export function validateConfig(input: {
  appId: string;
  configId: string;
  content: string;
}): Promise<{ valid: true; issues: string[] }> {
  return invokeCommand("validate_config", (value) => {
    if (
      !isRecord(value) ||
      value.valid !== true ||
      !Array.isArray(value.issues) ||
      !value.issues.every((issue) => typeof issue === "string")
    ) {
      throw createInternalError();
    }
    return { valid: true, issues: [...value.issues] };
  }, { input });
}

export function previewConfigWrite(input: {
  appId: string;
  configId: string;
  expectedHash: string;
  content: string;
}): Promise<ConfigWritePreview> {
  return invokeCommand("preview_config_write", decodeConfigWritePreview, {
    input,
  });
}

export function previewStructuredConfigWrite(input: {
  appId: string;
  configId: string;
  expectedHash: string;
  fields: Record<string, unknown>;
}): Promise<ConfigWritePreview> {
  return invokeCommand(
    "preview_structured_config_write",
    decodeConfigWritePreview,
    { input },
  );
}

export function previewSchemaConfigWrite(input: {
  appId: string;
  configId: string;
  variantId: string;
  schemaId: string;
  schemaVersion: number;
  expectedHash: string;
  fields: SchemaFieldPatch[];
  completeTemplate?: { presetId: string; presetVersion: number };
}): Promise<ConfigWritePreview> {
  return invokeCommand("preview_schema_config_write", decodeConfigWritePreview, {
    input,
  });
}

export function executeConfigWrite(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_config_write", decodeOperationDetails, {
    operationId,
  });
}

function decodeBackupSummary(value: unknown): BackupSummary {
  if (
    !isRecord(value) ||
    typeof value.backupId !== "string" ||
    typeof value.appId !== "string" ||
    typeof value.configId !== "string" ||
    typeof value.contentHash !== "string"
  ) {
    throw createInternalError();
  }
  const createdAtEpochMs = decodeOptionalSafeInteger(value.createdAtEpochMs);
  const sizeBytes = decodeOptionalSafeInteger(value.sizeBytes);
  const mode = decodeOptionalSafeInteger(value.mode);
  if (
    createdAtEpochMs === undefined ||
    sizeBytes === undefined ||
    mode === undefined
  ) {
    throw createInternalError();
  }
  return {
    backupId: value.backupId,
    appId: value.appId,
    configId: value.configId,
    createdAtEpochMs,
    contentHash: value.contentHash,
    sizeBytes,
    mode,
  };
}

export function listConfigBackups(
  appId: string,
  configId: string,
): Promise<BackupSummary[]> {
  return invokeCommand("list_config_backups", (value) => {
    if (!Array.isArray(value)) throw createInternalError();
    return value.map(decodeBackupSummary);
  }, { key: { appId, configId } });
}

export function previewRestoreBackup(input: {
  appId: string;
  configId: string;
  backupId: string;
  expectedHash: string;
}): Promise<ConfigWritePreview> {
  return invokeCommand("preview_restore_backup", decodeConfigWritePreview, {
    input,
  });
}

export function executeRestoreBackup(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_restore_backup", decodeOperationDetails, {
    operationId,
  });
}
