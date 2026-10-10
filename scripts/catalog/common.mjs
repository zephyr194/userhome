import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const CORPUS_DIR = path.join(ROOT_DIR, "catalog-corpus");
export const MANIFEST_PATH = path.join(CORPUS_DIR, "source-manifest.json");
export const OVERLAYS_PATH = path.join(
  CORPUS_DIR,
  "apps",
  "managed-overlays.json",
);
export const GENERATED_PATH = path.join(
  CORPUS_DIR,
  "generated",
  "catalog-packaged.json",
);
export const SUMMARY_PATH = path.join(
  CORPUS_DIR,
  "reports",
  "summary.json",
);
export const RUNTIME_CATALOG_PATH = path.join(
  ROOT_DIR,
  "src-tauri",
  "src",
  "catalog",
  "catalog-v2.json",
);

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const APP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9@+._-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const HOMEBREW_SOURCE_URLS = new Set([
  "https://formulae.brew.sh/api/formula.json",
  "https://formulae.brew.sh/api/cask.json",
]);
const HOMEBREW_REPOSITORY_URLS = new Set([
  "https://github.com/Homebrew/homebrew-core",
  "https://github.com/Homebrew/homebrew-cask",
]);
const COVERAGE_CLASS = "DETECTED_UNSUPPORTED";
const CAPABILITIES = ["DETECT"];

export class CorpusValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CorpusValidationError";
  }
}

function fail(message) {
  throw new CorpusValidationError(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

export function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function expectObject(value, label) {
  assert(isPlainObject(value), `${label} must be an object`);
  return value;
}

export function expectArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

export function expectString(value, label, options = {}) {
  const { maxLength = 1024, pattern, allowEmpty = false } = options;
  assert(typeof value === "string", `${label} must be a string`);
  assert(allowEmpty || value.length > 0, `${label} must not be empty`);
  assert(value.length <= maxLength, `${label} exceeds ${maxLength} characters`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), `${label} contains control characters`);
  if (pattern) {
    assert(pattern.test(value), `${label} has an invalid format`);
  }
  return value;
}

export function expectNullableString(value, label, options = {}) {
  if (value === null) {
    return null;
  }
  return expectString(value, label, options);
}

export function expectBoolean(value, label) {
  assert(typeof value === "boolean", `${label} must be a boolean`);
  return value;
}

export function expectInteger(value, label, options = {}) {
  const { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } =
    options;
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert(value >= minimum, `${label} must be at least ${minimum}`);
  assert(value <= maximum, `${label} must be at most ${maximum}`);
  return value;
}

export function expectAppId(value, label) {
  return expectString(value, label, {
    maxLength: 128,
    pattern: APP_ID_PATTERN,
  });
}

export function expectPackageToken(value, label) {
  return expectString(value, label, {
    maxLength: 128,
    pattern: PACKAGE_TOKEN_PATTERN,
  });
}

export function expectSha256(value, label) {
  return expectString(value, label, {
    maxLength: 64,
    pattern: SHA256_PATTERN,
  });
}

export function expectIsoDate(value, label) {
  const text = expectString(value, label, {
    maxLength: 32,
    pattern: ISO_DATE_PATTERN,
  });
  assert(!Number.isNaN(Date.parse(text)), `${label} is not a valid date`);
  return text;
}

export function expectHttpsUrl(value, label) {
  const text = expectString(value, label, { maxLength: 2048 });
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  assert(parsed.protocol === "https:", `${label} must use HTTPS`);
  assert(parsed.username === "" && parsed.password === "", `${label} must not contain credentials`);
  assert(parsed.hash === "", `${label} must not contain a fragment`);
  return text;
}

function assertKeys(value, label, required, optional = []) {
  const keys = Object.keys(value);
  for (const key of required) {
    assert(Object.hasOwn(value, key), `${label}.${key} is required`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) {
    assert(allowed.has(key), `${label}.${key} is not allowed`);
  }
}

function sortedUniqueStrings(values, label, options = {}) {
  const result = expectArray(values, label).map((value, index) =>
    expectString(value, `${label}[${index}]`, options),
  );
  assert(
    new Set(result).size === result.length,
    `${label} contains duplicate values`,
  );
  return result;
}

function validateLicenseReview(value, label) {
  const review = expectObject(value, label);
  assertKeys(review, label, ["status", "notes"]);
  assert(
    ["APPROVED", "REJECTED", "REVIEW_REQUIRED"].includes(review.status),
    `${label}.status is invalid`,
  );
  expectString(review.notes, `${label}.notes`, { maxLength: 1000 });
}

function validateMaintainerApproval(value, label) {
  const approval = expectObject(value, label);
  assertKeys(approval, label, ["status", "approvedBy", "approvedAt"]);
  assert(
    ["APPROVED", "PENDING", "REJECTED"].includes(approval.status),
    `${label}.status is invalid`,
  );
  const approvedBy = expectNullableString(
    approval.approvedBy,
    `${label}.approvedBy`,
    { maxLength: 200 },
  );
  const approvedAt =
    approval.approvedAt === null
      ? null
      : expectIsoDate(approval.approvedAt, `${label}.approvedAt`);
  if (approval.status === "APPROVED") {
    assert(approvedBy !== null, `${label}.approvedBy is required when approved`);
    assert(approvedAt !== null, `${label}.approvedAt is required when approved`);
  } else {
    assert(approvedBy === null, `${label}.approvedBy must be null unless approved`);
    assert(approvedAt === null, `${label}.approvedAt must be null unless approved`);
  }
}

function validatePolicy(value) {
  const policy = expectObject(value, "manifest.policy");
  assertKeys(policy, "manifest.policy", [
    "staleAfterDays",
    "minimumFormulaRecords",
    "minimumCaskRecords",
    "maximumPackagedApplications",
    "minimumPackagedApplications",
    "defaultCoverageClass",
    "defaultCapabilities",
    "defaultWritePermissions",
  ]);
  expectInteger(policy.staleAfterDays, "manifest.policy.staleAfterDays", {
    minimum: 1,
    maximum: 365,
  });
  expectInteger(
    policy.minimumFormulaRecords,
    "manifest.policy.minimumFormulaRecords",
    { minimum: 250, maximum: 1000 },
  );
  expectInteger(
    policy.minimumCaskRecords,
    "manifest.policy.minimumCaskRecords",
    { minimum: 250, maximum: 1000 },
  );
  expectInteger(
    policy.minimumPackagedApplications,
    "manifest.policy.minimumPackagedApplications",
    { minimum: 500, maximum: 1000 },
  );
  expectInteger(
    policy.maximumPackagedApplications,
    "manifest.policy.maximumPackagedApplications",
    { minimum: 500, maximum: 1000 },
  );
  assert(
    policy.minimumPackagedApplications <= policy.maximumPackagedApplications,
    "manifest packaged application bounds are invalid",
  );
  assert(
    policy.defaultCoverageClass === COVERAGE_CLASS,
    `manifest.policy.defaultCoverageClass must be ${COVERAGE_CLASS}`,
  );
  assert(
    JSON.stringify(policy.defaultCapabilities) === JSON.stringify(CAPABILITIES),
    "manifest.policy.defaultCapabilities must contain only DETECT",
  );
  assert(
    Array.isArray(policy.defaultWritePermissions) &&
      policy.defaultWritePermissions.length === 0,
    "manifest.policy.defaultWritePermissions must be empty",
  );
}

function validateSource(
  value,
  index,
  staleAfterDays,
  now,
  requireSnapshots,
  enforceFreshness,
) {
  const label = `manifest.sources[${index}]`;
  const source = expectObject(value, label);
  assertKeys(source, label, [
    "id",
    "kind",
    "url",
    "repositoryUrl",
    "owner",
    "project",
    "rawPath",
    "recordLimit",
    "staleAfterDays",
    "sha256",
    "normalizedSha256",
    "retrievedAt",
    "verifiedAt",
    "licenseReview",
    "maintainerApproval",
  ]);
  expectAppId(source.id, `${label}.id`);
  assert(
    ["HOMEBREW_FORMULA_API", "HOMEBREW_CASK_API"].includes(source.kind),
    `${label}.kind is invalid`,
  );
  expectHttpsUrl(source.url, `${label}.url`);
  expectHttpsUrl(source.repositoryUrl, `${label}.repositoryUrl`);
  assert(
    HOMEBREW_SOURCE_URLS.has(source.url),
    `${label}.url is not an approved Homebrew API`,
  );
  assert(
    HOMEBREW_REPOSITORY_URLS.has(source.repositoryUrl),
    `${label}.repositoryUrl is not an approved Homebrew repository`,
  );
  expectString(source.owner, `${label}.owner`, { maxLength: 200 });
  expectString(source.project, `${label}.project`, { maxLength: 200 });
  const rawPath = expectString(source.rawPath, `${label}.rawPath`, {
    maxLength: 300,
  });
  assert(
    rawPath.startsWith("raw/") && rawPath.endsWith(".json"),
    `${label}.rawPath must be a JSON file under raw/`,
  );
  assert(!rawPath.includes(".."), `${label}.rawPath must not traverse directories`);
  expectInteger(source.recordLimit, `${label}.recordLimit`, {
    minimum: 250,
    maximum: 500,
  });
  expectInteger(source.staleAfterDays, `${label}.staleAfterDays`, {
    minimum: 1,
    maximum: 365,
  });
  assert(
    source.staleAfterDays === staleAfterDays,
    `${label}.staleAfterDays must match manifest policy`,
  );
  validateLicenseReview(source.licenseReview, `${label}.licenseReview`);
  validateMaintainerApproval(
    source.maintainerApproval,
    `${label}.maintainerApproval`,
  );

  const snapshotFields = [
    "sha256",
    "normalizedSha256",
    "retrievedAt",
    "verifiedAt",
  ];
  if (!requireSnapshots && snapshotFields.every((key) => source[key] === null)) {
    return;
  }
  for (const key of snapshotFields) {
    assert(source[key] !== null, `${label}.${key} is required after refresh`);
  }
  expectSha256(source.sha256, `${label}.sha256`);
  expectSha256(source.normalizedSha256, `${label}.normalizedSha256`);
  expectIsoDate(source.retrievedAt, `${label}.retrievedAt`);
  const verifiedAt = expectIsoDate(source.verifiedAt, `${label}.verifiedAt`);
  const ageMilliseconds = now.getTime() - Date.parse(verifiedAt);
  assert(ageMilliseconds >= 0, `${label}.verifiedAt must not be in the future`);
  if (enforceFreshness) {
    assert(
      ageMilliseconds <= staleAfterDays * 24 * 60 * 60 * 1000,
      `${label} is stale; refresh data verified more than ${staleAfterDays} days ago`,
    );
  }
}

function validateAllowlistedProjectSource(value, index) {
  const label = `manifest.allowlistedProjectSources[${index}]`;
  const source = expectObject(value, label);
  assertKeys(source, label, [
    "url",
    "owner",
    "project",
    "licenseReview",
    "maintainerApproval",
  ]);
  expectHttpsUrl(source.url, `${label}.url`);
  expectString(source.owner, `${label}.owner`, { maxLength: 200 });
  expectString(source.project, `${label}.project`, { maxLength: 200 });
  validateLicenseReview(source.licenseReview, `${label}.licenseReview`);
  validateMaintainerApproval(
    source.maintainerApproval,
    `${label}.maintainerApproval`,
  );
}

export function validateManifest(
  value,
  {
    requireSnapshots = true,
    enforceFreshness = true,
    now = new Date(),
  } = {},
) {
  const manifest = expectObject(value, "manifest");
  assertKeys(manifest, "manifest", [
    "schemaVersion",
    "policy",
    "sources",
    "allowlistedProjectSources",
    "managedOverlayIds",
  ]);
  assert(manifest.schemaVersion === 1, "manifest.schemaVersion must be 1");
  validatePolicy(manifest.policy);
  const sources = expectArray(manifest.sources, "manifest.sources");
  assert(sources.length === 2, "manifest.sources must contain exactly two sources");
  sources.forEach((source, index) =>
    validateSource(
      source,
      index,
      manifest.policy.staleAfterDays,
      now,
      requireSnapshots,
      enforceFreshness,
    ),
  );
  assert(
    new Set(sources.map((source) => source.id)).size === sources.length,
    "manifest.sources contains duplicate ids",
  );
  assert(
    sources.filter((source) => source.kind === "HOMEBREW_FORMULA_API").length ===
      1,
    "manifest must contain one formula source",
  );
  assert(
    sources.filter((source) => source.kind === "HOMEBREW_CASK_API").length === 1,
    "manifest must contain one cask source",
  );

  const allowlisted = expectArray(
    manifest.allowlistedProjectSources,
    "manifest.allowlistedProjectSources",
  );
  allowlisted.forEach(validateAllowlistedProjectSource);
  assert(
    new Set(allowlisted.map((source) => source.url)).size === allowlisted.length,
    "manifest.allowlistedProjectSources contains duplicate URLs",
  );
  const managedIds = sortedUniqueStrings(
    manifest.managedOverlayIds,
    "manifest.managedOverlayIds",
    { maxLength: 128, pattern: APP_ID_PATTERN },
  );
  assert(managedIds.length === 26, "manifest.managedOverlayIds must contain 26 ids");
  assert(
    JSON.stringify([...managedIds].sort()) === JSON.stringify(managedIds),
    "manifest.managedOverlayIds must be sorted",
  );
  return manifest;
}

function validateSupport(value, label) {
  const support = expectObject(value, label);
  assertKeys(support, label, [
    "coverageClass",
    "capabilities",
    "writePermissions",
    "reason",
  ]);
  assert(
    support.coverageClass === COVERAGE_CLASS,
    `${label}.coverageClass must be ${COVERAGE_CLASS}`,
  );
  assert(
    JSON.stringify(support.capabilities) === JSON.stringify(CAPABILITIES),
    `${label}.capabilities must contain only DETECT`,
  );
  assert(
    Array.isArray(support.writePermissions) &&
      support.writePermissions.length === 0,
    `${label}.writePermissions must be empty`,
  );
  expectString(support.reason, `${label}.reason`, { maxLength: 1000 });
}

function validatePackage(value, label, expectedKind) {
  const resource = expectObject(value, label);
  const required =
    expectedKind === "formula"
      ? ["type", "token", "stableVersion", "license"]
      : ["type", "token", "stableVersion"];
  assertKeys(resource, label, required);
  assert(resource.type === expectedKind, `${label}.type must be ${expectedKind}`);
  expectPackageToken(resource.token, `${label}.token`);
  expectString(resource.stableVersion, `${label}.stableVersion`, {
    maxLength: 200,
  });
  if (expectedKind === "formula") {
    expectNullableString(resource.license, `${label}.license`, {
      maxLength: 4096,
    });
  }
}

export function validateNormalizedSource(value, expectedSource) {
  const label = `raw source ${expectedSource.id}`;
  const raw = expectObject(value, label);
  assertKeys(raw, label, [
    "schemaVersion",
    "source",
    "recordKind",
    "records",
  ]);
  assert(raw.schemaVersion === 1, `${label}.schemaVersion must be 1`);
  const source = expectObject(raw.source, `${label}.source`);
  assertKeys(source, `${label}.source`, [
    "id",
    "url",
    "repositoryUrl",
    "owner",
    "project",
    "sha256",
    "retrievedAt",
    "verifiedAt",
    "staleAfterDays",
  ]);
  assert(source.id === expectedSource.id, `${label}.source.id does not match`);
  assert(source.url === expectedSource.url, `${label}.source.url does not match`);
  assert(
    source.repositoryUrl === expectedSource.repositoryUrl,
    `${label}.source.repositoryUrl does not match`,
  );
  assert(
    source.owner === expectedSource.owner,
    `${label}.source.owner does not match`,
  );
  assert(
    source.project === expectedSource.project,
    `${label}.source.project does not match`,
  );
  assert(
    source.sha256 === expectedSource.sha256,
    `${label}.source.sha256 does not match`,
  );
  assert(
    source.retrievedAt === expectedSource.retrievedAt,
    `${label}.source.retrievedAt does not match`,
  );
  assert(
    source.verifiedAt === expectedSource.verifiedAt,
    `${label}.source.verifiedAt does not match`,
  );
  assert(
    source.staleAfterDays === expectedSource.staleAfterDays,
    `${label}.source.staleAfterDays does not match`,
  );

  const expectedKind =
    expectedSource.kind === "HOMEBREW_FORMULA_API" ? "formula" : "cask";
  assert(raw.recordKind === expectedKind, `${label}.recordKind does not match`);
  const records = expectArray(raw.records, `${label}.records`);
  assert(
    records.length === expectedSource.recordLimit,
    `${label}.records must contain exactly ${expectedSource.recordLimit} records`,
  );
  const ids = [];
  for (const [index, value] of records.entries()) {
    const recordLabel = `${label}.records[${index}]`;
    const record = expectObject(value, recordLabel);
    assertKeys(record, recordLabel, [
      "id",
      "displayName",
      "summary",
      "category",
      "package",
      "support",
    ]);
    const id = expectAppId(record.id, `${recordLabel}.id`);
    ids.push(id);
    expectString(record.displayName, `${recordLabel}.displayName`, {
      maxLength: 300,
    });
    expectString(record.summary, `${recordLabel}.summary`, {
      maxLength: 1000,
    });
    expectString(record.category, `${recordLabel}.category`, {
      maxLength: 100,
    });
    validatePackage(record.package, `${recordLabel}.package`, expectedKind);
    validateSupport(record.support, `${recordLabel}.support`);
  }
  assert(new Set(ids).size === ids.length, `${label}.records contains duplicate ids`);
  assert(
    JSON.stringify([...ids].sort()) === JSON.stringify(ids),
    `${label}.records must be sorted by id`,
  );
  return raw;
}

export function validateOverlays(value, manifest) {
  const overlays = expectObject(value, "managed overlays");
  assertKeys(overlays, "managed overlays", ["schemaVersion", "applications"]);
  assert(overlays.schemaVersion === 1, "managed overlays schemaVersion must be 1");
  const applications = expectArray(
    overlays.applications,
    "managed overlays.applications",
  );
  assert(applications.length === 26, "managed overlays must contain 26 applications");
  const allowlistedUrls = new Set(
    manifest.allowlistedProjectSources.map((source) => source.url),
  );
  const ids = [];
  for (const [index, value] of applications.entries()) {
    const label = `managed overlays.applications[${index}]`;
    const overlay = expectObject(value, label);
    assertKeys(overlay, label, [
      "id",
      "displayName",
      "category",
      "officialSources",
      "reviewRequired",
      "reviewNotes",
      "licenseReview",
      "maintainerApproval",
    ]);
    ids.push(expectAppId(overlay.id, `${label}.id`));
    expectString(overlay.displayName, `${label}.displayName`, { maxLength: 300 });
    expectString(overlay.category, `${label}.category`, { maxLength: 100 });
    const officialSources = sortedUniqueStrings(
      overlay.officialSources,
      `${label}.officialSources`,
      { maxLength: 2048 },
    );
    for (const sourceUrl of officialSources) {
      expectHttpsUrl(sourceUrl, `${label}.officialSources`);
      assert(
        allowlistedUrls.has(sourceUrl),
        `${label} uses a URL absent from the source-manifest allowlist`,
      );
    }
    expectBoolean(overlay.reviewRequired, `${label}.reviewRequired`);
    expectString(overlay.reviewNotes, `${label}.reviewNotes`, { maxLength: 1000 });
    validateLicenseReview(overlay.licenseReview, `${label}.licenseReview`);
    validateMaintainerApproval(
      overlay.maintainerApproval,
      `${label}.maintainerApproval`,
    );
    if (officialSources.length === 0) {
      assert(
        overlay.reviewRequired,
        `${label} without an official source must require review`,
      );
    }
  }
  assert(new Set(ids).size === ids.length, "managed overlays contains duplicate ids");
  assert(
    JSON.stringify([...ids].sort()) ===
      JSON.stringify(manifest.managedOverlayIds),
    "managed overlay ids do not match manifest.managedOverlayIds",
  );
  return overlays;
}

function containsForbiddenGeneratedKey(value) {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenGeneratedKey);
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (Object.hasOwn(value, "retrievedAt") || Object.hasOwn(value, "verifiedAt")) {
    return true;
  }
  return Object.values(value).some(containsForbiddenGeneratedKey);
}

export function validateGenerated(value, manifest) {
  const generated = expectObject(value, "generated catalog");
  assertKeys(generated, "generated catalog", [
    "schemaVersion",
    "sourceSnapshots",
    "defaults",
    "applications",
  ]);
  assert(generated.schemaVersion === 1, "generated catalog schemaVersion must be 1");
  assert(
    !containsForbiddenGeneratedKey(generated),
    "generated catalog must not contain retrievedAt or verifiedAt",
  );
  const snapshots = expectArray(
    generated.sourceSnapshots,
    "generated catalog.sourceSnapshots",
  );
  assert(
    snapshots.length === manifest.sources.length,
    "generated catalog source snapshot count does not match manifest",
  );
  for (const [index, value] of snapshots.entries()) {
    const label = `generated catalog.sourceSnapshots[${index}]`;
    const snapshot = expectObject(value, label);
    assertKeys(snapshot, label, [
      "id",
      "url",
      "repositoryUrl",
      "owner",
      "project",
      "sha256",
      "normalizedSha256",
      "licenseReview",
      "maintainerApproval",
    ]);
    const source = manifest.sources[index];
    assert(snapshot.id === source.id, `${label}.id does not match manifest`);
    assert(snapshot.url === source.url, `${label}.url does not match manifest`);
    assert(
      snapshot.repositoryUrl === source.repositoryUrl,
      `${label}.repositoryUrl does not match manifest`,
    );
    assert(snapshot.owner === source.owner, `${label}.owner does not match manifest`);
    assert(
      snapshot.project === source.project,
      `${label}.project does not match manifest`,
    );
    assert(
      snapshot.sha256 === source.sha256,
      `${label}.sha256 does not match manifest`,
    );
    assert(
      snapshot.normalizedSha256 === source.normalizedSha256,
      `${label}.normalizedSha256 does not match manifest`,
    );
    validateLicenseReview(snapshot.licenseReview, `${label}.licenseReview`);
    validateMaintainerApproval(
      snapshot.maintainerApproval,
      `${label}.maintainerApproval`,
    );
  }
  validateSupport(
    {
      ...generated.defaults,
      reason: "Unreviewed corpus entries are detection-only.",
    },
    "generated catalog.defaults",
  );

  const applications = expectArray(
    generated.applications,
    "generated catalog.applications",
  );
  const allowedOfficialSources = new Set([
    ...manifest.sources.flatMap((source) => [source.url, source.repositoryUrl]),
    ...manifest.allowlistedProjectSources.map((source) => source.url),
  ]);
  assert(
    applications.length >= manifest.policy.minimumPackagedApplications,
    `generated catalog must contain at least ${manifest.policy.minimumPackagedApplications} applications`,
  );
  assert(
    applications.length <= manifest.policy.maximumPackagedApplications,
    `generated catalog must contain at most ${manifest.policy.maximumPackagedApplications} applications`,
  );
  const ids = [];
  for (const [index, value] of applications.entries()) {
    const label = `generated catalog.applications[${index}]`;
    const application = expectObject(value, label);
    assertKeys(application, label, [
      "id",
      "displayName",
      "summary",
      "category",
      "packageSources",
      "officialSources",
      "support",
      "reviewRequired",
      "reviewNotes",
      "licenseReview",
      "maintainerApproval",
    ]);
    ids.push(expectAppId(application.id, `${label}.id`));
    expectString(application.displayName, `${label}.displayName`, {
      maxLength: 300,
    });
    expectString(application.summary, `${label}.summary`, { maxLength: 1000 });
    expectString(application.category, `${label}.category`, { maxLength: 100 });
    const packageSources = expectArray(
      application.packageSources,
      `${label}.packageSources`,
    );
    assert(packageSources.length <= 2, `${label}.packageSources has too many entries`);
    const packageTypes = [];
    for (const [packageIndex, packageSource] of packageSources.entries()) {
      const packageLabel = `${label}.packageSources[${packageIndex}]`;
      const packageObject = expectObject(packageSource, packageLabel);
      const type = expectString(packageObject.type, `${packageLabel}.type`, {
        maxLength: 20,
      });
      assert(["cask", "formula"].includes(type), `${packageLabel}.type is invalid`);
      packageTypes.push(type);
      validatePackage(packageObject, packageLabel, type);
    }
    assert(
      new Set(packageTypes).size === packageTypes.length,
      `${label}.packageSources contains duplicate types`,
    );
    const officialSources = sortedUniqueStrings(
      application.officialSources,
      `${label}.officialSources`,
      { maxLength: 2048 },
    );
    officialSources.forEach((sourceUrl, sourceIndex) => {
      expectHttpsUrl(sourceUrl, `${label}.officialSources[${sourceIndex}]`);
      assert(
        allowedOfficialSources.has(sourceUrl),
        `${label}.officialSources[${sourceIndex}] is not allowlisted`,
      );
    });
    validateSupport(application.support, `${label}.support`);
    expectBoolean(application.reviewRequired, `${label}.reviewRequired`);
    expectString(application.reviewNotes, `${label}.reviewNotes`, {
      maxLength: 1000,
    });
    validateLicenseReview(application.licenseReview, `${label}.licenseReview`);
    validateMaintainerApproval(
      application.maintainerApproval,
      `${label}.maintainerApproval`,
    );
  }
  assert(
    new Set(ids).size === ids.length,
    "generated catalog applications contains duplicate ids",
  );
  assert(
    JSON.stringify([...ids].sort()) === JSON.stringify(ids),
    "generated catalog applications must be sorted by id",
  );
  return generated;
}

export function validateSummary(value, generated, artifactSha256) {
  const summary = expectObject(value, "summary report");
  assertKeys(summary, "summary report", [
    "schemaVersion",
    "artifact",
    "counts",
    "categories",
    "supportClasses",
    "sourceRecords",
    "review",
    "reproducibility",
  ]);
  assert(summary.schemaVersion === 1, "summary report schemaVersion must be 1");
  const artifact = expectObject(summary.artifact, "summary report.artifact");
  assertKeys(artifact, "summary report.artifact", ["path", "sha256"]);
  assert(
    artifact.path === "generated/catalog-packaged.json",
    "summary report artifact path is invalid",
  );
  assert(
    artifact.sha256 === artifactSha256,
    "summary report artifact digest does not match generated catalog",
  );
  const counts = expectObject(summary.counts, "summary report.counts");
  assertKeys(counts, "summary report.counts", [
    "uniqueApplications",
    "formulaRecords",
    "caskRecords",
    "managedOverlays",
  ]);
  assert(
    counts.uniqueApplications === generated.applications.length,
    "summary unique application count does not match generated catalog",
  );
  const sourceRecords = expectObject(
    summary.sourceRecords,
    "summary report.sourceRecords",
  );
  assertKeys(sourceRecords, "summary report.sourceRecords", [
    "homebrew-formula-api",
    "homebrew-cask-api",
  ]);
  assert(
    counts.formulaRecords === sourceRecords["homebrew-formula-api"],
    "summary formula count does not match sourceRecords",
  );
  assert(
    counts.caskRecords === sourceRecords["homebrew-cask-api"],
    "summary cask count does not match sourceRecords",
  );
  assert(counts.managedOverlays === 26, "summary managed overlay count must be 26");
  expectObject(summary.categories, "summary report.categories");
  expectObject(summary.supportClasses, "summary report.supportClasses");
  const review = expectObject(summary.review, "summary report.review");
  assertKeys(review, "summary report.review", [
    "required",
    "missingOfficialSource",
    "maintainerApprovalPending",
  ]);
  const reproducibility = expectObject(
    summary.reproducibility,
    "summary report.reproducibility",
  );
  assertKeys(reproducibility, "summary report.reproducibility", [
    "byteIdenticalBuild",
    "timestampsExcludedFromArtifact",
  ]);
  assert(
    reproducibility.byteIdenticalBuild === true &&
      reproducibility.timestampsExcludedFromArtifact === true,
    "summary reproducibility flags must be true",
  );
}

export function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readJson(filePath, label = filePath) {
  const fileStat = await stat(filePath);
  assert(fileStat.isFile(), `${label} must be a file`);
  assert(fileStat.size <= MAX_JSON_BYTES, `${label} exceeds the JSON size limit`);
  const text = await readFile(filePath, "utf8");
  try {
    return { value: JSON.parse(text), text };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function writeJson(filePath, value) {
  await writeFile(filePath, canonicalJson(value), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
}

export function resolveCorpusPath(relativePath) {
  const resolved = path.resolve(CORPUS_DIR, relativePath);
  const prefix = `${path.resolve(CORPUS_DIR)}${path.sep}`;
  assert(resolved.startsWith(prefix), `${relativePath} escapes catalog-corpus`);
  return resolved;
}

export async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, canonicalJson(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function acquireCorpusMaintenanceLock(operation) {
  const lockPath = path.join(CORPUS_DIR, ".maintenance.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({ operation, pid: process.pid })}\n`,
      "utf8",
    );
  } catch (error) {
    if (handle) {
      await handle.close();
      await rm(lockPath, { force: true });
    }
    if (error.code === "EEXIST") {
      throw new CorpusValidationError(
        "Another corpus maintenance command is already running",
      );
    }
    throw error;
  }
  return async () => {
    try {
      await handle.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  };
}

export async function atomicWriteJsonGroup(entries, operation) {
  const transactionId = `${process.pid}-${randomUUID()}`;
  const stagingDir = path.join(
    CORPUS_DIR,
    `.${operation}-staging-${transactionId}`,
  );
  const backupDir = path.join(
    CORPUS_DIR,
    `.${operation}-backup-${transactionId}`,
  );
  const staged = [];
  const backups = [];
  const installedWithoutBackup = [];
  await mkdir(stagingDir, { recursive: false });
  await mkdir(backupDir, { recursive: false });
  try {
    for (const [index, entry] of entries.entries()) {
      const stagedPath = path.join(stagingDir, `${index}.json`);
      await writeFile(stagedPath, canonicalJson(entry.value), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
      staged.push({ stagedPath, targetPath: entry.filePath });
      const backupPath = path.join(backupDir, `${index}.json`);
      try {
        await copyFile(entry.filePath, backupPath);
        backups.push({ backupPath, targetPath: entry.filePath });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        installedWithoutBackup.push(entry.filePath);
      }
    }
    for (const entry of staged) {
      await rename(entry.stagedPath, entry.targetPath);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const backup of backups) {
      try {
        await copyFile(backup.backupPath, backup.targetPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const targetPath of installedWithoutBackup) {
      try {
        await rm(targetPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `${operation} failed and rollback was incomplete`,
      );
    }
    throw error;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
  }
}

export async function loadAndValidateInputs({
  manifestPath = MANIFEST_PATH,
  overlaysPath = OVERLAYS_PATH,
  requireSnapshots = true,
  enforceFreshness = true,
  now = new Date(),
} = {}) {
  const { value: manifestValue } = await readJson(
    manifestPath,
    "source manifest",
  );
  const manifest = validateManifest(manifestValue, {
    requireSnapshots,
    enforceFreshness,
    now,
  });
  const { value: overlaysValue } = await readJson(
    overlaysPath,
    "managed overlays",
  );
  const overlays = validateOverlays(overlaysValue, manifest);
  const rawSources = [];
  for (const source of manifest.sources) {
    const rawPath = resolveCorpusPath(source.rawPath);
    const { value: rawValue, text } = await readJson(
      rawPath,
      `normalized source ${source.id}`,
    );
    assert(
      sha256(text) === source.normalizedSha256,
      `normalized source ${source.id} digest does not match manifest`,
    );
    rawSources.push(validateNormalizedSource(rawValue, source));
  }
  return { manifest, overlays, rawSources };
}

export function countBy(values, getKey) {
  const counts = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
}
