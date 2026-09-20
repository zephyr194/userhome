import { createInternalError, invokeCommand, isRecord } from "./core";

export const CATALOG_SCHEMA_VERSION = 1;
const MAX_MANAGED_APPS = 32;
const MAX_CAPABILITIES = 8;
const MAX_TEXT_BYTES = 512;

export type ManagedAppCapability =
  | "DETECT"
  | "READ_CONFIG"
  | "WRITE_CONFIG"
  | "MANAGE_SERVICE";

export interface ManagedAppSummary {
  id: string;
  displayName: string;
  description: string;
  iconKey: string;
  capabilities: readonly ManagedAppCapability[];
  managedDocumentCount: number;
  serviceCount: number;
}

export interface ManagedAppCatalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  applications: readonly ManagedAppSummary[];
}

const CAPABILITIES: readonly string[] = [
  "DETECT",
  "READ_CONFIG",
  "WRITE_CONFIG",
  "MANAGE_SERVICE",
];

function decodeText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).length > MAX_TEXT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeIdentifier(value: unknown): string {
  const identifier = decodeText(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) {
    throw createInternalError();
  }
  return identifier;
}

function decodeCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 32
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeCapabilities(value: unknown): readonly ManagedAppCapability[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_CAPABILITIES ||
    value.some(
      (capability) =>
        typeof capability !== "string" ||
        !CAPABILITIES.includes(capability),
    )
  ) {
    throw createInternalError();
  }

  const capabilities = value as ManagedAppCapability[];
  if (new Set(capabilities).size !== capabilities.length) {
    throw createInternalError();
  }
  return [...capabilities];
}

function decodeManagedApp(value: unknown): ManagedAppSummary {
  if (!isRecord(value)) {
    throw createInternalError();
  }

  return {
    id: decodeIdentifier(value.id),
    displayName: decodeText(value.displayName),
    description: decodeText(value.description),
    iconKey: decodeIdentifier(value.iconKey),
    capabilities: decodeCapabilities(value.capabilities),
    managedDocumentCount: decodeCount(value.managedDocumentCount),
    serviceCount: decodeCount(value.serviceCount),
  };
}

export function decodeManagedAppCatalog(value: unknown): ManagedAppCatalog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    !Array.isArray(value.applications) ||
    value.applications.length === 0 ||
    value.applications.length > MAX_MANAGED_APPS
  ) {
    throw createInternalError();
  }

  const applications = value.applications.map(decodeManagedApp);
  if (new Set(applications.map((app) => app.id)).size !== applications.length) {
    throw createInternalError();
  }

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    applications,
  };
}

export function listManagedApps(): Promise<ManagedAppCatalog> {
  return invokeCommand("list_managed_apps", decodeManagedAppCatalog);
}
