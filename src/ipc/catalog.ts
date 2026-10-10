import {
  createInternalError,
  hasControlCharacters,
  invokeCommand,
  isRecord,
} from "./core";

export const CATALOG_SCHEMA_VERSION = 1;
export const CATALOG_PAGE_SIZE = 50;
const MAX_MANAGED_APPS = 1_000;
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

export type CatalogPriority = "PRIORITY_A" | "PRIORITY_B" | "PRIORITY_C";

export type DetectionEvidenceKind =
  | "BREW_CASK"
  | "BREW_FORMULA"
  | "EXECUTABLE"
  | "HOMEBREW_PATH"
  | "HOME_PATH"
  | "SERVICE";

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

export interface ManagedAppDetectionEvidence {
  kind: DetectionEvidenceKind;
  value: string;
}

export type ManagedAppSourceLicenseStatus =
  | "APPROVED"
  | "REJECTED"
  | "REVIEW_REQUIRED";

export type ManagedAppSourceReviewStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED";

export interface ManagedAppSourceEvidence {
  url: string;
  licenseStatus: ManagedAppSourceLicenseStatus;
  reviewStatus: ManagedAppSourceReviewStatus;
  contentSha256?: string;
  verifiedAt?: string;
}

export interface ManagedAppSupportPresentation {
  limitations: readonly string[];
  exclusions: readonly string[];
  requirement: string;
}

export interface ManagedAppSummary {
  id: string;
  displayName: string;
  description: string;
  iconKey: string;
  priority: CatalogPriority;
  coverageClass: ManagedAppCoverageClass;
  presentation: ManagedAppPresentation;
  detectionEvidence: readonly ManagedAppDetectionEvidence[];
  sourceEvidence?: readonly ManagedAppSourceEvidence[];
  support: ManagedAppSupportPresentation;
  capabilities: readonly ManagedAppCapability[];
  managedDocumentCount: number;
  serviceCount: number;
}

export interface CatalogCoveragePolicy {
  priorityATotal: number;
  priorityAUsable: number;
  priorityBTotal: number;
  priorityBCovered: number;
  minimumEligibleTextPercent: number;
}

export interface ManagedAppCatalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  coveragePolicy: CatalogCoveragePolicy;
  applications: readonly ManagedAppSummary[];
}

export interface ManagedAppPageQuery {
  query?: string;
  category?: string;
  coverageClass?: ManagedAppCoverageClass;
  capability?: ManagedAppCapability;
  detected?: boolean;
  detectedAppIds?: readonly string[];
  page: number;
}

export interface ManagedAppPagination {
  page: number;
  pageSize: typeof CATALOG_PAGE_SIZE;
  totalItems: number;
  totalPages: number;
}

export interface ManagedAppFacets {
  categories: readonly string[];
  coverageClasses: readonly ManagedAppCoverageClass[];
  capabilities: readonly ManagedAppCapability[];
}

export interface ManagedAppPage {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  coveragePolicy: CatalogCoveragePolicy;
  facets: ManagedAppFacets;
  pagination: ManagedAppPagination;
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
const PRIORITIES: readonly string[] = [
  "PRIORITY_A",
  "PRIORITY_B",
  "PRIORITY_C",
];
const DETECTION_EVIDENCE_KINDS: readonly string[] = [
  "BREW_CASK",
  "BREW_FORMULA",
  "EXECUTABLE",
  "HOMEBREW_PATH",
  "HOME_PATH",
  "SERVICE",
];
const SOURCE_LICENSE_STATUSES: readonly string[] = [
  "APPROVED",
  "REJECTED",
  "REVIEW_REQUIRED",
];
const SOURCE_REVIEW_STATUSES: readonly string[] = [
  "APPROVED",
  "PENDING",
  "REJECTED",
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

function decodeSourceEvidence(value: unknown): readonly ManagedAppSourceEvidence[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw createInternalError();
  }
  const evidence = value.map((entry) => {
    if (!isRecord(entry)) {
      throw createInternalError();
    }
    const url = decodeText(entry.url);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw createInternalError();
    }
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username.length > 0 ||
      parsedUrl.password.length > 0 ||
      parsedUrl.search.length > 0 ||
      parsedUrl.hash.length > 0
    ) {
      throw createInternalError();
    }
    const contentSha256 =
      entry.contentSha256 === null || entry.contentSha256 === undefined
        ? undefined
        : decodeText(entry.contentSha256);
    const verifiedAt =
      entry.verifiedAt === null || entry.verifiedAt === undefined
        ? undefined
        : decodeText(entry.verifiedAt);
    if (
      (contentSha256 === undefined) !== (verifiedAt === undefined) ||
      (contentSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(contentSha256)) ||
      (verifiedAt !== undefined &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(verifiedAt) ||
          Number.isNaN(Date.parse(verifiedAt))))
    ) {
      throw createInternalError();
    }
    return {
      url,
      licenseStatus: decodeKnownValue<ManagedAppSourceLicenseStatus>(
        entry.licenseStatus,
        SOURCE_LICENSE_STATUSES,
      ),
      reviewStatus: decodeKnownValue<ManagedAppSourceReviewStatus>(
        entry.reviewStatus,
        SOURCE_REVIEW_STATUSES,
      ),
      ...(contentSha256 === undefined ? {} : { contentSha256 }),
      ...(verifiedAt === undefined ? {} : { verifiedAt }),
    };
  });
  if (new Set(evidence.map((entry) => entry.url)).size !== evidence.length) {
    throw createInternalError();
  }
  return evidence;
}

function decodeCount(value: unknown, maximum = MAX_MANAGED_APPS): number {
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

function decodePercentage(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100
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

function decodeTextList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw createInternalError();
  }
  return value.map(decodeText);
}

function decodeDetectionEvidence(
  value: unknown,
): readonly ManagedAppDetectionEvidence[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw createInternalError();
  }
  return value.map((evidence) => {
    if (!isRecord(evidence)) {
      throw createInternalError();
    }
    return {
      kind: decodeKnownValue<DetectionEvidenceKind>(
        evidence.kind,
        DETECTION_EVIDENCE_KINDS,
      ),
      value: decodeText(evidence.value),
    };
  });
}

function decodeSupport(value: unknown): ManagedAppSupportPresentation {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  return {
    limitations: decodeTextList(value.limitations),
    exclusions: decodeTextList(value.exclusions),
    requirement: decodeText(value.requirement),
  };
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
  const managedDocumentCount = decodeCount(
    value.managedDocumentCount,
    MAX_CONFIG_DOCUMENTS_PER_APP,
  );
  return {
    id: decodeIdentifier(value.id),
    displayName: decodeText(value.displayName),
    description: decodeText(value.description),
    iconKey: decodeIdentifier(value.iconKey),
    priority: decodeKnownValue<CatalogPriority>(value.priority, PRIORITIES),
    coverageClass: decodeCoverageClass(value.coverageClass, capabilities),
    presentation: decodePresentation(value.presentation, managedDocumentCount),
    detectionEvidence: decodeDetectionEvidence(value.detectionEvidence),
    sourceEvidence: decodeSourceEvidence(value.sourceEvidence),
    support: decodeSupport(value.support),
    capabilities,
    managedDocumentCount,
    serviceCount: decodeCount(value.serviceCount, 32),
  };
}

function decodeCoveragePolicy(value: unknown): CatalogCoveragePolicy {
  if (!isRecord(value)) {
    throw createInternalError();
  }
  const priorityATotal = decodeCount(value.priorityATotal);
  const priorityAUsable = decodeCount(value.priorityAUsable);
  const priorityBTotal = decodeCount(value.priorityBTotal);
  const priorityBCovered = decodeCount(value.priorityBCovered);
  if (
    priorityAUsable > priorityATotal ||
    priorityBCovered > priorityBTotal
  ) {
    throw createInternalError();
  }
  return {
    priorityATotal,
    priorityAUsable,
    priorityBTotal,
    priorityBCovered,
    minimumEligibleTextPercent: decodePercentage(
      value.minimumEligibleTextPercent,
    ),
  };
}

export function decodeManagedAppCatalog(value: unknown): ManagedAppCatalog {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    !Array.isArray(value.applications) ||
    value.applications.length === 0 ||
    value.applications.length > CATALOG_PAGE_SIZE
  ) {
    throw createInternalError();
  }

  const applications = value.applications.map(decodeManagedApp);
  if (new Set(applications.map((app) => app.id)).size !== applications.length) {
    throw createInternalError();
  }
  const coveragePolicy = decodeCoveragePolicy(value.coveragePolicy);

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    coveragePolicy,
    applications,
  };
}

function decodeTextArray(
  value: unknown,
  maximum: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw createInternalError();
  }
  const entries = value.map(decodeText);
  if (new Set(entries).size !== entries.length) {
    throw createInternalError();
  }
  return entries;
}

function decodeManagedAppFacets(value: unknown): ManagedAppFacets {
  if (
    !isRecord(value) ||
    !Array.isArray(value.coverageClasses) ||
    value.coverageClasses.length > COVERAGE_CLASSES.length ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > CAPABILITIES.length
  ) {
    throw createInternalError();
  }
  const categories = decodeTextArray(value.categories, MAX_MANAGED_APPS);
  const coverageClasses = value.coverageClasses.map((coverageClass) =>
    decodeKnownValue<ManagedAppCoverageClass>(
      coverageClass,
      COVERAGE_CLASSES,
    ),
  );
  const capabilities = value.capabilities.map((capability) =>
    decodeKnownValue<ManagedAppCapability>(capability, CAPABILITIES),
  );
  if (
    new Set(coverageClasses).size !== coverageClasses.length ||
    new Set(capabilities).size !== capabilities.length
  ) {
    throw createInternalError();
  }
  return { categories, coverageClasses, capabilities };
}

export function decodeManagedAppPage(value: unknown): ManagedAppPage {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    !isRecord(value.pagination) ||
    !Array.isArray(value.applications) ||
    value.applications.length > CATALOG_PAGE_SIZE
  ) {
    throw createInternalError();
  }
  const page = decodeCount(value.pagination.page, MAX_MANAGED_APPS);
  const pageSize = decodeCount(
    value.pagination.pageSize,
    CATALOG_PAGE_SIZE,
  );
  const totalItems = decodeCount(
    value.pagination.totalItems,
    MAX_MANAGED_APPS,
  );
  const totalPages = decodeCount(
    value.pagination.totalPages,
    MAX_MANAGED_APPS,
  );
  if (
    page < 1 ||
    pageSize !== CATALOG_PAGE_SIZE ||
    (totalItems === 0 && (totalPages !== 0 || page !== 1)) ||
    (totalItems > 0 &&
      (totalPages !== Math.ceil(totalItems / CATALOG_PAGE_SIZE) ||
        page > totalPages))
  ) {
    throw createInternalError();
  }
  const applications = value.applications.map(decodeManagedApp);
  const expectedApplicationCount =
    totalItems === 0
    ? 0
    : Math.min(
        CATALOG_PAGE_SIZE,
        totalItems - (page - 1) * CATALOG_PAGE_SIZE,
      );
  if (
    applications.length !== expectedApplicationCount ||
    new Set(applications.map((application) => application.id)).size !==
    applications.length
  ) {
    throw createInternalError();
  }
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    coveragePolicy: decodeCoveragePolicy(value.coveragePolicy),
    facets: decodeManagedAppFacets(value.facets),
    pagination: {
      page,
      pageSize: CATALOG_PAGE_SIZE,
      totalItems,
      totalPages,
    },
    applications,
  };
}

export function listManagedApps(): Promise<ManagedAppCatalog> {
  return invokeCommand("list_managed_apps", decodeManagedAppCatalog);
}

export function queryManagedApps(
  input: ManagedAppPageQuery,
): Promise<ManagedAppPage> {
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    input.page > MAX_MANAGED_APPS
  ) {
    return Promise.reject(createInternalError());
  }
  return invokeCommand("query_managed_apps", decodeManagedAppPage, {
    input: {
      query: input.query ?? "",
      category: input.category,
      coverageClass: input.coverageClass,
      capability: input.capability,
      detected: input.detected,
      detectedAppIds: input.detectedAppIds ?? [],
      page: input.page,
    },
  });
}

export function getManagedApp(appId: string): Promise<ManagedAppSummary> {
  return invokeCommand("get_managed_app", decodeManagedApp, { appId });
}
