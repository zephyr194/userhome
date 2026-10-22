import { createInternalError, hasControlCharacters, invokeCommand } from "./core";
import {
  AI_TOOL_IDS,
  requireExactKeys,
  requireHttpsUrl,
  requireOneOf,
  requireRecord,
  type AiToolId,
} from "./aiConfig";

// Mirrors commands/ai_config.rs and ai_config/reference.rs. The reference is a
// read-only projection of the versioned definitions: it never carries a user path
// or value, and every text the backend truncates is flagged so the view can say so.

export const REFERENCE_VALUE_TYPES = [
  "string",
  "boolean",
  "number",
  "stringArray",
  "object",
  "enum",
  "unknown",
] as const;
export type ReferenceValueType = (typeof REFERENCE_VALUE_TYPES)[number];

export const REFERENCE_COVERAGES = [
  "editable",
  "displayOnly",
  "notApplicable",
  "versionUnknown",
  "unsupported",
] as const;
export type ReferenceCoverage = (typeof REFERENCE_COVERAGES)[number];

export const REFERENCE_LAYERS = [
  "userLevel",
  "projectShared",
  "projectLocal",
  "managed",
] as const;
export type ReferenceLayer = (typeof REFERENCE_LAYERS)[number];

export const REFERENCE_FORMATS = ["json", "jsonc", "toml", "text"] as const;
export type ReferenceFormat = (typeof REFERENCE_FORMATS)[number];

export const REFERENCE_RISKS = [
  "executesCommand",
  "relaxesPermissions",
  "externalServer",
] as const;
export type ReferenceRisk = (typeof REFERENCE_RISKS)[number];

const MAX_DISPLAY_TEXT = 600;
const MAX_NOTICE_TEXT = 400;
const MAX_NOTICES = 8;
const MAX_RESOURCES = 64;
const MAX_SETTINGS = 1000;
const MAX_ALLOWED_VALUES = 64;
const MAX_ALLOWED_VALUE_LENGTH = 128;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_LOCATION_LENGTH = 256;
const MAX_VERSION_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 64;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const KEY_PATH_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TOOL_KEYS = [
  "toolId",
  "displayName",
  "source",
  "notices",
  "resources",
  "settings",
  "flagsCoverage",
  "envCoverage",
] as const;
const SOURCE_KEYS = ["url", "retrievedOn", "documentedVersion"] as const;
const RESOURCE_KEYS = [
  "id",
  "layer",
  "format",
  "location",
  "coverage",
  "description",
  "descriptionTruncated",
  "metadataOnly",
  "sourceUrl",
] as const;
const SETTING_KEYS = [
  "id",
  "keyPath",
  "valueType",
  "allowedValues",
  "description",
  "descriptionTruncated",
  "defaultNote",
  "defaultNoteTruncated",
  "coverage",
  "risks",
  "secret",
  "sourceUrl",
] as const;
const LISTING_KEYS = [
  "snapshotComplete",
  "coverageNote",
  "coverageNoteTruncated",
  "sourceUrl",
] as const;

export interface ReferenceSource {
  url: string;
  retrievedOn: string;
  documentedVersion: string;
}

export interface ReferenceResource {
  id: string;
  layer: ReferenceLayer;
  format: ReferenceFormat;
  location: string;
  coverage: ReferenceCoverage;
  description: string;
  descriptionTruncated: boolean;
  metadataOnly: boolean;
  sourceUrl: string;
}

export interface ReferenceSetting {
  id: string;
  keyPath: string;
  valueType: ReferenceValueType;
  allowedValues: string[];
  description: string;
  descriptionTruncated: boolean;
  defaultNote: string;
  defaultNoteTruncated: boolean;
  coverage: ReferenceCoverage;
  risks: ReferenceRisk[];
  secret: boolean;
  sourceUrl: string;
}

export interface ReferenceListing {
  snapshotComplete: boolean;
  coverageNote: string | null;
  coverageNoteTruncated: boolean;
  sourceUrl: string;
}

export interface ToolReference {
  toolId: AiToolId;
  displayName: string;
  source: ReferenceSource;
  notices: string[];
  resources: ReferenceResource[];
  settings: ReferenceSetting[];
  flagsCoverage: ReferenceListing;
  envCoverage: ReferenceListing;
}

function decodeFailure() {
  return createInternalError();
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw decodeFailure();
  return value;
}

function requireShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw decodeFailure();
  if (value.trim().length === 0 || hasControlCharacters(value)) throw decodeFailure();
  if ([...value].length > maxLength) throw decodeFailure();
  return value;
}

function requireIdentifier(value: unknown): string {
  const text = requireShortText(value, MAX_IDENTIFIER_LENGTH);
  if (!IDENTIFIER_PATTERN.test(text)) throw decodeFailure();
  return text;
}

function requireDisplayText(value: unknown, truncated: boolean): string {
  const text = requireShortText(value, MAX_DISPLAY_TEXT);
  if (truncated && [...text].length !== MAX_DISPLAY_TEXT) throw decodeFailure();
  return text;
}

function requireDate(value: unknown): string {
  const text = requireShortText(value, 10);
  if (!DATE_PATTERN.test(text)) throw decodeFailure();
  return text;
}

function requireArray(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) throw decodeFailure();
  return value;
}

function decodeSource(value: unknown): ReferenceSource {
  const record = requireRecord(value);
  requireExactKeys(record, SOURCE_KEYS);
  return {
    url: requireHttpsUrl(record.url),
    retrievedOn: requireDate(record.retrievedOn),
    documentedVersion: requireShortText(record.documentedVersion, MAX_VERSION_LENGTH),
  };
}

function decodeResource(value: unknown): ReferenceResource {
  const record = requireRecord(value);
  requireExactKeys(record, RESOURCE_KEYS);
  const descriptionTruncated = requireBoolean(record.descriptionTruncated);
  const location = requireShortText(record.location, MAX_LOCATION_LENGTH);
  if (!location.startsWith("{")) throw decodeFailure();
  return {
    id: requireIdentifier(record.id),
    layer: requireOneOf(REFERENCE_LAYERS, record.layer),
    format: requireOneOf(REFERENCE_FORMATS, record.format),
    location,
    coverage: requireOneOf(REFERENCE_COVERAGES, record.coverage),
    description: requireDisplayText(record.description, descriptionTruncated),
    descriptionTruncated,
    metadataOnly: requireBoolean(record.metadataOnly),
    sourceUrl: requireHttpsUrl(record.sourceUrl),
  };
}

function decodeSetting(value: unknown): ReferenceSetting {
  const record = requireRecord(value);
  requireExactKeys(record, SETTING_KEYS);
  const keyPath = requireShortText(record.keyPath, MAX_IDENTIFIER_LENGTH);
  if (!KEY_PATH_PATTERN.test(keyPath)) throw decodeFailure();
  const valueType = requireOneOf(REFERENCE_VALUE_TYPES, record.valueType);
  const allowedValues = requireArray(record.allowedValues, MAX_ALLOWED_VALUES).map((item) =>
    requireShortText(item, MAX_ALLOWED_VALUE_LENGTH),
  );
  if (valueType === "enum" && allowedValues.length === 0) throw decodeFailure();
  const descriptionTruncated = requireBoolean(record.descriptionTruncated);
  const defaultNoteTruncated = requireBoolean(record.defaultNoteTruncated);
  return {
    id: requireIdentifier(record.id),
    keyPath,
    valueType,
    allowedValues,
    description: requireDisplayText(record.description, descriptionTruncated),
    descriptionTruncated,
    defaultNote: requireDisplayText(record.defaultNote, defaultNoteTruncated),
    defaultNoteTruncated,
    coverage: requireOneOf(REFERENCE_COVERAGES, record.coverage),
    risks: requireArray(record.risks, REFERENCE_RISKS.length).map((risk) =>
      requireOneOf(REFERENCE_RISKS, risk),
    ),
    secret: requireBoolean(record.secret),
    sourceUrl: requireHttpsUrl(record.sourceUrl),
  };
}

function decodeListing(value: unknown): ReferenceListing {
  const record = requireRecord(value);
  requireExactKeys(record, LISTING_KEYS);
  const coverageNoteTruncated = requireBoolean(record.coverageNoteTruncated);
  if (record.coverageNote === null && coverageNoteTruncated) throw decodeFailure();
  return {
    snapshotComplete: requireBoolean(record.snapshotComplete),
    coverageNote:
      record.coverageNote === null
        ? null
        : requireDisplayText(record.coverageNote, coverageNoteTruncated),
    coverageNoteTruncated,
    sourceUrl: requireHttpsUrl(record.sourceUrl),
  };
}

export function decodeToolReference(value: unknown, expectedId: AiToolId): ToolReference {
  const record = requireRecord(value);
  requireExactKeys(record, TOOL_KEYS);
  const toolId = requireOneOf(AI_TOOL_IDS, record.toolId);
  if (toolId !== expectedId) throw decodeFailure();
  return {
    toolId,
    displayName: requireShortText(record.displayName, MAX_DISPLAY_NAME_LENGTH),
    source: decodeSource(record.source),
    notices: requireArray(record.notices, MAX_NOTICES).map((notice) => {
      const text = requireShortText(notice, MAX_NOTICE_TEXT);
      if (!text.includes("https://")) throw decodeFailure();
      return text;
    }),
    resources: requireArray(record.resources, MAX_RESOURCES).map(decodeResource),
    settings: requireArray(record.settings, MAX_SETTINGS).map(decodeSetting),
    flagsCoverage: decodeListing(record.flagsCoverage),
    envCoverage: decodeListing(record.envCoverage),
  };
}

export function getToolReference(toolId: AiToolId): Promise<ToolReference> {
  return invokeCommand(
    "ai_config_tool_reference",
    (value) => decodeToolReference(value, toolId),
    { toolId },
  );
}
