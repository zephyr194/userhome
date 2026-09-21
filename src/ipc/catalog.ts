import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";

export const CATALOG_SCHEMA_VERSION = 1;
const MAX_MANAGED_APPS = 32;
const MAX_CONFIG_DOCUMENTS_PER_APP = 16;
const MAX_PATH_VARIANTS_PER_DOCUMENT = 8;
const MAX_CONFIG_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_CAPABILITIES = 8;
const MAX_TEXT_BYTES = 512;

export type ManagedAppCapability =
  | "DETECT"
  | "READ_CONFIG"
  | "WRITE_CONFIG"
  | "MANAGE_SERVICE";

export type ManagedAppCoverageClass =
  | "MANAGED_WRITABLE"
  | "MANAGED_READ_ONLY"
  | "DETECTED_UNSUPPORTED"
  | "EXCLUDED";

export type ConfigPathRoot =
  | "HOME"
  | "XDG_CONFIG_HOME"
  | "APPLICATION_SUPPORT"
  | "HOMEBREW_PREFIX"
  | "APP_SUPPORT";

export type ConfigPathExistenceRule =
  | "FILE"
  | "DIRECTORY"
  | "FILE_OR_DIRECTORY";

export type ConfigFormat =
  | "CADDYFILE"
  | "GIT_CONFIG"
  | "INI"
  | "JSON"
  | "JSONC"
  | "KEY_VALUE"
  | "MARKDOWN"
  | "MARKDOWN_DIRECTORY"
  | "PLIST"
  | "SHELL"
  | "SSH_CONFIG"
  | "TEXT"
  | "TOML"
  | "YAML";

export type ConfigFormatFamily =
  | "JSON"
  | "JSONC"
  | "TOML"
  | "YAML"
  | "INI"
  | "GIT_CONFIG"
  | "KEY_VALUE"
  | "PLIST"
  | "COMMAND"
  | "PLAIN_TEXT";

export type ConfigSensitivity = "STANDARD" | "SENSITIVE" | "SECRET";

export type ConfigAccessMode =
  | "READ_WRITE"
  | "READ_ONLY"
  | "METADATA_ONLY"
  | "EXCLUDED";

export interface ManagedConfigPathVariantPresentation {
  variantId: string;
  root: ConfigPathRoot;
  relativePath: string;
  existenceRule: ConfigPathExistenceRule;
  precedence: number;
}

export interface ManagedConfigDocumentPresentation {
  configId: string;
  purpose: string;
  pathVariants: readonly ManagedConfigPathVariantPresentation[];
  format: ConfigFormat;
  formatFamily: ConfigFormatFamily;
  sensitivity: ConfigSensitivity;
  accessMode: ConfigAccessMode;
  editorKey: string;
  maxSizeBytes: number;
}

export interface ManagedAppPresentation {
  category: string;
  configDocuments: readonly ManagedConfigDocumentPresentation[];
}

export interface ManagedAppSummary {
  id: string;
  displayName: string;
  description: string;
  iconKey: string;
  coverageClass: ManagedAppCoverageClass;
  presentation: ManagedAppPresentation;
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
const COVERAGE_CLASSES: readonly string[] = [
  "MANAGED_WRITABLE",
  "MANAGED_READ_ONLY",
  "DETECTED_UNSUPPORTED",
  "EXCLUDED",
];
const PATH_ROOTS: readonly string[] = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPLICATION_SUPPORT",
  "HOMEBREW_PREFIX",
  "APP_SUPPORT",
];
const EXISTENCE_RULES: readonly string[] = [
  "FILE",
  "DIRECTORY",
  "FILE_OR_DIRECTORY",
];
export const CONFIG_FORMATS: readonly string[] = [
  "CADDYFILE",
  "GIT_CONFIG",
  "INI",
  "JSON",
  "JSONC",
  "KEY_VALUE",
  "MARKDOWN",
  "MARKDOWN_DIRECTORY",
  "PLIST",
  "SHELL",
  "SSH_CONFIG",
  "TEXT",
  "TOML",
  "YAML",
];
const FORMAT_FAMILIES: readonly string[] = [
  "JSON",
  "JSONC",
  "TOML",
  "YAML",
  "INI",
  "GIT_CONFIG",
  "KEY_VALUE",
  "PLIST",
  "COMMAND",
  "PLAIN_TEXT",
];
const SENSITIVITIES: readonly string[] = [
  "STANDARD",
  "SENSITIVE",
  "SECRET",
];
const ACCESS_MODES: readonly string[] = [
  "READ_WRITE",
  "READ_ONLY",
  "METADATA_ONLY",
  "EXCLUDED",
];
const FORMAT_FAMILY_BY_FORMAT: Readonly<Record<ConfigFormat, ConfigFormatFamily>> = {
  CADDYFILE: "COMMAND",
  GIT_CONFIG: "GIT_CONFIG",
  INI: "INI",
  JSON: "JSON",
  JSONC: "JSONC",
  KEY_VALUE: "KEY_VALUE",
  MARKDOWN: "PLAIN_TEXT",
  MARKDOWN_DIRECTORY: "PLAIN_TEXT",
  PLIST: "PLIST",
  SHELL: "COMMAND",
  SSH_CONFIG: "COMMAND",
  TEXT: "PLAIN_TEXT",
  TOML: "TOML",
  YAML: "YAML",
};

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

function decodeBoundedSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CONFIG_DOCUMENT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeKnownValue<T extends string>(
  value: unknown,
  allowed: readonly string[],
): T {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

function decodeRelativePath(value: unknown): string {
  const relativePath = decodeText(value);
  const parts = relativePath.split("/");
  if (
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    hasControlCharacters(relativePath) ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw createInternalError();
  }
  return relativePath;
}

function decodePathVariants(
  value: unknown,
): readonly ManagedConfigPathVariantPresentation[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PATH_VARIANTS_PER_DOCUMENT
  ) {
    throw createInternalError();
  }

  const variants = value.map((variant, index) => {
    if (!isRecord(variant) || variant.precedence !== index) {
      throw createInternalError();
    }
    return {
      variantId: decodeIdentifier(variant.variantId),
      root: decodeKnownValue<ConfigPathRoot>(variant.root, PATH_ROOTS),
      relativePath: decodeRelativePath(variant.relativePath),
      existenceRule: decodeKnownValue<ConfigPathExistenceRule>(
        variant.existenceRule,
        EXISTENCE_RULES,
      ),
      precedence: index,
    };
  });
  if (
    new Set(variants.map((variant) => variant.variantId)).size !==
    variants.length
  ) {
    throw createInternalError();
  }
  return variants;
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

function decodeCoverageClass(
  value: unknown,
  capabilities: readonly ManagedAppCapability[],
): ManagedAppCoverageClass {
  const inferred = capabilities.includes("WRITE_CONFIG")
    ? "MANAGED_WRITABLE"
    : capabilities.includes("READ_CONFIG")
      ? "MANAGED_READ_ONLY"
      : "DETECTED_UNSUPPORTED";
  const coverageClass = value === undefined ? inferred : value;
  if (
    typeof coverageClass !== "string" ||
    !COVERAGE_CLASSES.includes(coverageClass)
  ) {
    throw createInternalError();
  }

  const canRead = capabilities.includes("READ_CONFIG");
  const canWrite = capabilities.includes("WRITE_CONFIG");
  if (
    (coverageClass === "MANAGED_WRITABLE" && (!canRead || !canWrite)) ||
    (coverageClass === "MANAGED_READ_ONLY" && (!canRead || canWrite)) ||
    ((coverageClass === "DETECTED_UNSUPPORTED" ||
      coverageClass === "EXCLUDED") &&
      (canRead || canWrite))
  ) {
    throw createInternalError();
  }
  return coverageClass as ManagedAppCoverageClass;
}

function decodePresentation(
  value: unknown,
  managedDocumentCount: number,
): ManagedAppPresentation {
  if (value === undefined) {
    return { category: "Other", configDocuments: [] };
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value.configDocuments) ||
    value.configDocuments.length > MAX_CONFIG_DOCUMENTS_PER_APP
  ) {
    throw createInternalError();
  }

  const configDocuments = value.configDocuments.map((document) => {
    if (!isRecord(document)) {
      throw createInternalError();
    }
    const format = decodeKnownValue<ConfigFormat>(
      document.format,
      CONFIG_FORMATS,
    );
    const formatFamily = decodeKnownValue<ConfigFormatFamily>(
      document.formatFamily,
      FORMAT_FAMILIES,
    );
    if (FORMAT_FAMILY_BY_FORMAT[format] !== formatFamily) {
      throw createInternalError();
    }
    return {
      configId: decodeIdentifier(document.configId),
      purpose: decodeText(document.purpose),
      pathVariants: decodePathVariants(document.pathVariants),
      format,
      formatFamily,
      sensitivity: decodeKnownValue<ConfigSensitivity>(
        document.sensitivity,
        SENSITIVITIES,
      ),
      accessMode: decodeKnownValue<ConfigAccessMode>(
        document.accessMode,
        ACCESS_MODES,
      ),
      editorKey: decodeIdentifier(document.editorKey),
      maxSizeBytes: decodeBoundedSize(document.maxSizeBytes),
    };
  });
  if (
    new Set(configDocuments.map((document) => document.configId)).size !==
      configDocuments.length ||
    configDocuments.length !== managedDocumentCount
  ) {
    throw createInternalError();
  }

  return {
    category: decodeText(value.category),
    configDocuments,
  };
}

function decodeManagedApp(value: unknown): ManagedAppSummary {
  if (!isRecord(value)) {
    throw createInternalError();
  }

  const capabilities = decodeCapabilities(value.capabilities);
  const managedDocumentCount = decodeCount(value.managedDocumentCount);
  return {
    id: decodeIdentifier(value.id),
    displayName: decodeText(value.displayName),
    description: decodeText(value.description),
    iconKey: decodeIdentifier(value.iconKey),
    coverageClass: decodeCoverageClass(value.coverageClass, capabilities),
    presentation: decodePresentation(value.presentation, managedDocumentCount),
    capabilities,
    managedDocumentCount,
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
