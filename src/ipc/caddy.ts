import { createInternalError, invokeCommand, isRecord } from "./core";

// Wire shapes mirror src-tauri/src/caddy/{config,detect,diff,store}.rs and
// commands/caddy.rs. The frontend sends structured rules only; it never sends a
// path or Caddyfile text, and it decodes every response strictly.

export const CADDY_UPSTREAM_SCHEMES = ["http", "https"] as const;
export type CaddyUpstreamScheme = (typeof CADDY_UPSTREAM_SCHEMES)[number];

export const CADDY_ISSUE_CODES = [
  "UNSUPPORTED_VERSION",
  "TOO_MANY_SITES",
  "NO_UPSTREAM",
  "TOO_MANY_UPSTREAMS",
  "INVALID_HOST",
  "FORBIDDEN_CHARACTER",
  "INVALID_PORT",
  "PRIVILEGED_PORT",
] as const;
export type CaddyIssueCode = (typeof CADDY_ISSUE_CODES)[number];

export const CADDY_SEVERITIES = ["ERROR", "WARNING"] as const;
export type CaddySeverity = (typeof CADDY_SEVERITIES)[number];

export const CADDY_ISSUE_FIELDS = [
  "version",
  "sites",
  "listen.host",
  "listen.port",
  "upstreams",
  "upstreams.host",
  "upstreams.port",
] as const;
export type CaddyIssueField = (typeof CADDY_ISSUE_FIELDS)[number];

export const CADDY_EXPOSURE_REASONS = [
  "LOOPBACK",
  "ALL_INTERFACES",
  "NON_LOOPBACK_ADDRESS",
  "HOST_NAME",
] as const;
export type CaddyExposureReason = (typeof CADDY_EXPOSURE_REASONS)[number];

export const CADDY_LINE_CHANGES = ["UNCHANGED", "ADDED", "REMOVED"] as const;
export type CaddyLineChange = (typeof CADDY_LINE_CHANGES)[number];

export const CADDY_RULES_SOURCES = ["SAVED", "DEFAULT"] as const;
export type CaddyRulesSource = (typeof CADDY_RULES_SOURCES)[number];

export const CADDY_DETECT_STATUSES = ["AVAILABLE", "MISSING", "INVALID"] as const;
export type CaddyDetectStatus = (typeof CADDY_DETECT_STATUSES)[number];

export const CADDY_CANDIDATE_SOURCES = ["FIXED", "USER_SELECTED"] as const;
export type CaddyCandidateSource = (typeof CADDY_CANDIDATE_SOURCES)[number];

export const CADDY_CANDIDATE_OUTCOMES = [
  "MISSING",
  "UNREADABLE",
  "OUTSIDE_ROOT",
  "NOT_REGULAR_FILE",
  "NOT_EXECUTABLE",
  "GROUP_OR_WORLD_WRITABLE",
  "USABLE",
] as const;
export type CaddyCandidateOutcome = (typeof CADDY_CANDIDATE_OUTCOMES)[number];

const MAX_SITES = 32;
const MAX_UPSTREAMS = 8;
const MAX_REPORT_ITEMS = 4096;
const MAX_CANDIDATES = 16;

export interface CaddyListen {
  host: string;
  port: number;
}

export interface CaddyUpstream {
  scheme: CaddyUpstreamScheme;
  host: string;
  port: number;
}

export interface CaddySite {
  enabled: boolean;
  listen: CaddyListen;
  upstreams: CaddyUpstream[];
}

export interface CaddyRules {
  version: number;
  sites: CaddySite[];
}

export interface LoadedCaddyRules {
  rules: CaddyRules;
  source: CaddyRulesSource;
}

export interface CaddyIssue {
  code: CaddyIssueCode;
  severity: CaddySeverity;
  site?: number;
  upstream?: number;
  field?: CaddyIssueField;
  message: string;
}

export interface CaddyConflict {
  listen: string;
  sites: number[];
}

export interface CaddyExposure {
  site: number;
  listen: string;
  visibleExternally: boolean;
  reason: CaddyExposureReason;
}

export interface CaddyValidation {
  issues: CaddyIssue[];
  conflicts: CaddyConflict[];
  exposures: CaddyExposure[];
}

export interface CaddyDiffLine {
  change: CaddyLineChange;
  text: string;
}

export interface CaddyPreview {
  valid: boolean;
  validation: CaddyValidation;
  generatedText?: string;
  diff?: CaddyDiffLine[];
  hasSavedVersion: boolean;
}

export interface CaddyCandidateCheck {
  source: CaddyCandidateSource;
  displayPath: string;
  outcome: CaddyCandidateOutcome;
}

export interface CaddyDetectReport {
  status: CaddyDetectStatus;
  executablePath?: string;
  version?: string;
  guidance?: string;
  candidates: CaddyCandidateCheck[];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw createInternalError();
  }
  return value as T;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw createInternalError();
  }
  for (const key of required) {
    if (value[key] === undefined) throw createInternalError();
  }
}

function text(value: unknown): string {
  if (typeof value !== "string") throw createInternalError();
  return value;
}

function nonEmptyText(value: unknown): string {
  const decoded = text(value);
  if (decoded.length === 0) throw createInternalError();
  return decoded;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInternalError();
  return value;
}

function port(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    throw createInternalError();
  }
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw createInternalError();
  }
  return value;
}

function list<T>(
  value: unknown,
  limit: number,
  decodeItem: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw createInternalError();
  }
  return value.map((item) => decodeItem(item));
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw createInternalError();
  return value;
}

function decodeListen(value: unknown): CaddyListen {
  const wire = record(value);
  exactKeys(wire, ["host", "port"]);
  return { host: nonEmptyText(wire.host), port: port(wire.port) };
}

function decodeUpstream(value: unknown): CaddyUpstream {
  const wire = record(value);
  exactKeys(wire, ["scheme", "host", "port"]);
  return {
    scheme: oneOf(wire.scheme, CADDY_UPSTREAM_SCHEMES),
    host: nonEmptyText(wire.host),
    port: port(wire.port),
  };
}

function decodeSite(value: unknown): CaddySite {
  const wire = record(value);
  exactKeys(wire, ["enabled", "listen", "upstreams"]);
  return {
    enabled: boolean(wire.enabled),
    listen: decodeListen(wire.listen),
    upstreams: list(wire.upstreams, MAX_UPSTREAMS, decodeUpstream),
  };
}

export function decodeCaddyRules(value: unknown): CaddyRules {
  const wire = record(value);
  exactKeys(wire, ["version", "sites"]);
  return {
    version: nonNegativeInteger(wire.version),
    sites: list(wire.sites, MAX_SITES, decodeSite),
  };
}

export function decodeLoadedRules(value: unknown): LoadedCaddyRules {
  const wire = record(value);
  exactKeys(wire, ["rules", "source"]);
  return {
    rules: decodeCaddyRules(wire.rules),
    source: oneOf(wire.source, CADDY_RULES_SOURCES),
  };
}

function decodeIssue(value: unknown): CaddyIssue {
  const wire = record(value);
  exactKeys(wire, ["code", "severity", "message"], ["site", "upstream", "field"]);
  const issue: CaddyIssue = {
    code: oneOf(wire.code, CADDY_ISSUE_CODES),
    severity: oneOf(wire.severity, CADDY_SEVERITIES),
    message: nonEmptyText(wire.message),
  };
  if (wire.site !== undefined) issue.site = nonNegativeInteger(wire.site);
  if (wire.upstream !== undefined) issue.upstream = nonNegativeInteger(wire.upstream);
  if (wire.field !== undefined) issue.field = oneOf(wire.field, CADDY_ISSUE_FIELDS);
  return issue;
}

function decodeConflict(value: unknown): CaddyConflict {
  const wire = record(value);
  exactKeys(wire, ["listen", "sites"]);
  return {
    listen: nonEmptyText(wire.listen),
    sites: list(wire.sites, MAX_REPORT_ITEMS, nonNegativeInteger),
  };
}

function decodeExposure(value: unknown): CaddyExposure {
  const wire = record(value);
  exactKeys(wire, ["site", "listen", "visibleExternally", "reason"]);
  return {
    site: nonNegativeInteger(wire.site),
    listen: nonEmptyText(wire.listen),
    visibleExternally: boolean(wire.visibleExternally),
    reason: oneOf(wire.reason, CADDY_EXPOSURE_REASONS),
  };
}

function decodeValidation(value: unknown): CaddyValidation {
  const wire = record(value);
  exactKeys(wire, ["issues", "conflicts", "exposures"]);
  return {
    issues: list(wire.issues, MAX_REPORT_ITEMS, decodeIssue),
    conflicts: list(wire.conflicts, MAX_REPORT_ITEMS, decodeConflict),
    exposures: list(wire.exposures, MAX_REPORT_ITEMS, decodeExposure),
  };
}

function decodeDiffLine(value: unknown): CaddyDiffLine {
  const wire = record(value);
  exactKeys(wire, ["change", "text"]);
  return {
    change: oneOf(wire.change, CADDY_LINE_CHANGES),
    text: text(wire.text),
  };
}

// The backend withholds text and diff exactly when the rules are blocked. The
// decoder re-derives that rule so a contradictory payload fails closed.
export function decodePreview(value: unknown): CaddyPreview {
  const wire = record(value);
  exactKeys(
    wire,
    ["valid", "validation", "hasSavedVersion"],
    ["generatedText", "diff"],
  );
  const validation = decodeValidation(wire.validation);
  const blocking =
    validation.conflicts.length > 0 ||
    validation.issues.some((issue) => issue.severity === "ERROR");
  const valid = boolean(wire.valid);
  if (valid === blocking) throw createInternalError();
  const hasSavedVersion = boolean(wire.hasSavedVersion);

  if (!valid) {
    if (wire.generatedText !== undefined || wire.diff !== undefined) {
      throw createInternalError();
    }
    return { valid, validation, hasSavedVersion };
  }
  if (wire.generatedText === undefined || wire.diff === undefined) {
    throw createInternalError();
  }
  return {
    valid,
    validation,
    generatedText: text(wire.generatedText),
    diff: list(wire.diff, MAX_REPORT_ITEMS, decodeDiffLine),
    hasSavedVersion,
  };
}

function decodeCandidate(value: unknown): CaddyCandidateCheck {
  const wire = record(value);
  exactKeys(wire, ["source", "displayPath", "outcome"]);
  return {
    source: oneOf(wire.source, CADDY_CANDIDATE_SOURCES),
    displayPath: nonEmptyText(wire.displayPath),
    outcome: oneOf(wire.outcome, CADDY_CANDIDATE_OUTCOMES),
  };
}

export function decodeDetectReport(value: unknown): CaddyDetectReport {
  const wire = record(value);
  exactKeys(
    wire,
    ["status", "candidates"],
    ["executablePath", "version", "guidance"],
  );
  const status = oneOf(wire.status, CADDY_DETECT_STATUSES);
  const candidates = list(wire.candidates, MAX_CANDIDATES, decodeCandidate);

  if (status === "AVAILABLE") {
    if (wire.guidance !== undefined) throw createInternalError();
    return {
      status,
      executablePath: nonEmptyText(wire.executablePath),
      version: nonEmptyText(wire.version),
      candidates,
    };
  }
  if (wire.executablePath !== undefined || wire.version !== undefined) {
    throw createInternalError();
  }
  return { status, guidance: nonEmptyText(wire.guidance), candidates };
}

function decodeNothing(value: unknown): void {
  if (value !== null && value !== undefined) throw createInternalError();
}

// Copies only the structured fields. A caller's extra properties never reach IPC.
export function toRulesRequest(rules: CaddyRules): CaddyRules {
  return {
    version: rules.version,
    sites: rules.sites.map((site) => ({
      enabled: site.enabled,
      listen: { host: site.listen.host, port: site.listen.port },
      upstreams: site.upstreams.map((upstream) => ({
        scheme: upstream.scheme,
        host: upstream.host,
        port: upstream.port,
      })),
    })),
  };
}

export function caddyLoadRules(): Promise<LoadedCaddyRules> {
  return invokeCommand("caddy_load_rules", decodeLoadedRules);
}

export function caddyPreview(rules: CaddyRules): Promise<CaddyPreview> {
  return invokeCommand("caddy_preview", decodePreview, {
    input: toRulesRequest(rules),
  });
}

export function caddySave(rules: CaddyRules): Promise<void> {
  return invokeCommand("caddy_save", decodeNothing, {
    input: toRulesRequest(rules),
  });
}

// Only a grant id chosen through the grant picker may be sent; no path is accepted.
export function caddyDetect(executableGrantId?: string): Promise<CaddyDetectReport> {
  return invokeCommand("caddy_detect", decodeDetectReport, {
    input: executableGrantId === undefined ? {} : { executableGrantId },
  });
}

export const CADDY_RAW_ORIGINS = ["SAVED", "EMPTY", "EXTERNAL"] as const;
export type CaddyRawOrigin = (typeof CADDY_RAW_ORIGINS)[number];

export const CADDY_VALIDATION_STATUSES = [
  "VALID",
  "INVALID",
  "EXTERNAL_REFERENCES",
  "TIMEOUT",
  "CANCELLED",
  "OUTPUT_TOO_LARGE",
  "UNAVAILABLE",
] as const;
export type CaddyValidationStatus = (typeof CADDY_VALIDATION_STATUSES)[number];

export const CADDY_CHECK_STAGES = ["ADAPT", "VALIDATE"] as const;
export type CaddyCheckStage = (typeof CADDY_CHECK_STAGES)[number];

export const CADDY_REFERENCE_KINDS = [
  "IMPORT",
  "FILE_PLACEHOLDER",
  "ENV_PLACEHOLDER",
  "TLS_ARGUMENTS",
] as const;
export type CaddyReferenceKind = (typeof CADDY_REFERENCE_KINDS)[number];

export const CADDY_WRITE_KINDS = ["REPLACE", "CREATE"] as const;
export type CaddyWriteKind = (typeof CADDY_WRITE_KINDS)[number];

export interface CaddyRawDocument {
  origin: CaddyRawOrigin;
  text: string;
  sha256?: string;
}

export interface CaddyExternalReference {
  kind: CaddyReferenceKind;
  line: number;
}

export interface CaddyDiagnostic {
  line?: number;
  message: string;
}

export interface CaddyValidationReport {
  status: CaddyValidationStatus;
  stage?: CaddyCheckStage;
  externalReferences: CaddyExternalReference[];
  diagnostics: CaddyDiagnostic[];
  limitation: string;
}

export interface CaddyExternalSavePreview {
  batchId: string;
  operationId: string;
  summary: string;
  expiresAt: string;
  kind: CaddyWriteKind;
  target: string;
  proposedHash: string;
  currentHash?: string;
}

export interface CaddyExternalSaveResult {
  operationId: string;
  summary: string;
  status: string;
  writeStatus: string;
  fileState: string;
}

const MAX_REFERENCES = 1024;
const MAX_DIAGNOSTICS_RESPONSE = 20;

export function decodeRawDocument(value: unknown): CaddyRawDocument {
  const wire = record(value);
  exactKeys(wire, ["origin", "text"], ["sha256"]);
  const document: CaddyRawDocument = {
    origin: oneOf(wire.origin, CADDY_RAW_ORIGINS),
    text: text(wire.text),
  };
  if (wire.sha256 !== undefined) document.sha256 = nonEmptyText(wire.sha256);
  return document;
}

function decodeReference(value: unknown): CaddyExternalReference {
  const wire = record(value);
  exactKeys(wire, ["kind", "line"]);
  return {
    kind: oneOf(wire.kind, CADDY_REFERENCE_KINDS),
    line: nonNegativeInteger(wire.line),
  };
}

function decodeDiagnostic(value: unknown): CaddyDiagnostic {
  const wire = record(value);
  exactKeys(wire, ["message"], ["line"]);
  const diagnostic: CaddyDiagnostic = { message: text(wire.message) };
  if (wire.line !== undefined) diagnostic.line = nonNegativeInteger(wire.line);
  return diagnostic;
}

export function decodeValidationReport(value: unknown): CaddyValidationReport {
  const wire = record(value);
  exactKeys(
    wire,
    ["status", "externalReferences", "diagnostics", "limitation"],
    ["stage"],
  );
  const report: CaddyValidationReport = {
    status: oneOf(wire.status, CADDY_VALIDATION_STATUSES),
    externalReferences: list(wire.externalReferences, MAX_REFERENCES, decodeReference),
    diagnostics: list(wire.diagnostics, MAX_DIAGNOSTICS_RESPONSE, decodeDiagnostic),
    limitation: nonEmptyText(wire.limitation),
  };
  if (wire.stage !== undefined) report.stage = oneOf(wire.stage, CADDY_CHECK_STAGES);
  return report;
}

// Decodes the fields the UI uses from the first step of a single-file batch.
// The full operation record is not mirrored here; unknown keys are ignored.
export function decodeExternalSavePreview(value: unknown): CaddyExternalSavePreview {
  const wire = record(value);
  const steps = list(wire.steps, 1, record);
  if (steps.length !== 1) throw createInternalError();
  const step = steps[0];
  const preview: CaddyExternalSavePreview = {
    batchId: nonEmptyText(wire.batchId),
    operationId: nonEmptyText(step.operationId),
    summary: text(step.summary),
    expiresAt: nonEmptyText(step.expiresAt),
    kind: oneOf(step.kind, CADDY_WRITE_KINDS),
    target: nonEmptyText(step.target),
    proposedHash: nonEmptyText(step.proposedHash),
  };
  if (step.currentHash !== undefined) preview.currentHash = nonEmptyText(step.currentHash);
  return preview;
}

export function decodeExternalSaveResult(value: unknown): CaddyExternalSaveResult {
  const wire = record(value);
  const outcome = record(wire.outcome);
  return {
    operationId: nonEmptyText(wire.operationId),
    summary: text(wire.summary),
    status: nonEmptyText(wire.status),
    writeStatus: nonEmptyText(outcome.status),
    fileState: nonEmptyText(outcome.fileState),
  };
}

export interface CaddyValidateRequest {
  text: string;
  runId: string;
  allowExternalReferences: boolean;
}

// Only the text and the run id cross IPC from this entry; never a path.
export function caddyLoadRaw(): Promise<CaddyRawDocument> {
  return invokeCommand("caddy_load_raw", decodeRawDocument, { input: {} });
}

export function caddySaveRaw(rawText: string): Promise<void> {
  return invokeCommand("caddy_save_raw", decodeNothing, { input: { text: rawText } });
}

export function caddyValidate(request: CaddyValidateRequest): Promise<CaddyValidationReport> {
  return invokeCommand("caddy_validate", decodeValidationReport, {
    input: {
      source: { kind: "raw", text: request.text },
      runId: request.runId,
      allowExternalReferences: request.allowExternalReferences,
    },
  });
}

export function caddyCancelValidate(runId: string): Promise<boolean> {
  return invokeCommand("caddy_cancel_validate", boolean, { input: { runId } });
}

// Only a grant id chosen through the grant picker may be sent; no path is accepted.
export function caddyPreviewExternalRawSave(
  grantId: string,
  rawText: string,
  expectedSha256?: string,
): Promise<CaddyExternalSavePreview> {
  return invokeCommand("caddy_preview_external_raw_save", decodeExternalSavePreview, {
    input: { grantId, text: rawText, expectedSha256 },
  });
}

export function caddyConfirmExternalRawSave(
  grantId: string,
  operationId: string,
): Promise<CaddyExternalSaveResult> {
  return invokeCommand("caddy_confirm_external_raw_save", decodeExternalSaveResult, {
    input: { grantId, operationId },
  });
}

// Run-state wire shapes mirror src-tauri/src/caddy/session.rs. Only the source
// kind and the confirmed plan id cross IPC; no path or Caddyfile text is sent.
export const CADDY_CONFIG_SOURCES = ["RULES", "RAW"] as const;
export type CaddyConfigSource = (typeof CADDY_CONFIG_SOURCES)[number];

export const CADDY_RUN_STATES = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "FAILED",
  "UNKNOWN",
] as const;
export type CaddyRunState = (typeof CADDY_RUN_STATES)[number];

export const CADDY_FAILURE_KINDS = [
  "EXECUTABLE_UNAVAILABLE",
  "INVALID_SETUP",
  "CONFIG_REJECTED",
  "SPAWN_FAILED",
  "EXITED_BEFORE_READY",
  "READINESS_TIMEOUT",
  "CRASHED_AFTER_READY",
] as const;
export type CaddyFailureKind = (typeof CADDY_FAILURE_KINDS)[number];

const MAX_NOTES = 32;

export const CADDY_CONFLICT_VERDICTS = ["CLEAR", "UNCONFIRMED", "BLOCKED"] as const;
export type CaddyConflictVerdict = (typeof CADDY_CONFLICT_VERDICTS)[number];

export const CADDY_BLOCK_REASONS = ["EXTERNAL_RUNNING", "PORT_OCCUPIED"] as const;
export type CaddyBlockReason = (typeof CADDY_BLOCK_REASONS)[number];

export const CADDY_SNAPSHOT_STATUSES = ["COMPLETE", "INCOMPLETE", "UNREADABLE"] as const;
export type CaddySnapshotStatus = (typeof CADDY_SNAPSHOT_STATUSES)[number];

export const CADDY_EXTERNAL_DOMAINS = ["GUI", "SYSTEM"] as const;
export type CaddyExternalDomain = (typeof CADDY_EXTERNAL_DOMAINS)[number];

export const CADDY_EXTERNAL_RUN_STATES = [
  "RUNNING",
  "NOT_RUNNING",
  "UNKNOWN",
  "INACCESSIBLE",
] as const;
export type CaddyExternalRunState = (typeof CADDY_EXTERNAL_RUN_STATES)[number];

export const CADDY_PORT_STATES = ["FREE", "OCCUPIED", "UNCHECKED"] as const;
export type CaddyPortState = (typeof CADDY_PORT_STATES)[number];

export const CADDY_UPSTREAM_STATES = ["REACHABLE", "UNREACHABLE", "UNCHECKED"] as const;
export type CaddyUpstreamState = (typeof CADDY_UPSTREAM_STATES)[number];

export interface CaddyOccupant {
  name: string;
  pid: number;
}

export interface CaddyExternalInstance {
  label: string;
  domain: CaddyExternalDomain;
  runState: CaddyExternalRunState;
  pid?: number;
  explanation: string;
}

export interface CaddyExternalReport {
  snapshot: CaddySnapshotStatus;
  explanation: string;
  instances: CaddyExternalInstance[];
}

export interface CaddyPortFinding {
  host: string;
  port: number;
  state: CaddyPortState;
  occupant?: CaddyOccupant;
  explanation: string;
}

export interface CaddyUpstreamFinding {
  host: string;
  port: number;
  state: CaddyUpstreamState;
  explanation: string;
}

export interface CaddyConflictReport {
  verdict: CaddyConflictVerdict;
  headline: string;
  blocks: CaddyBlockReason[];
  external: CaddyExternalReport;
  ports: CaddyPortFinding[];
  upstreams: CaddyUpstreamFinding[];
  notes: string[];
}

export interface CaddyStartSummary {
  planId?: string;
  source: CaddyConfigSource;
  executablePath?: string;
  version?: string;
  workingDirectory: string;
  configFingerprint: string;
  listen: string[];
  upstreams: string[];
  adminEndpoint: string;
  notes: string[];
  blocked?: string;
  conflicts?: CaddyConflictReport;
}

export interface CaddyRunStatus {
  state: CaddyRunState;
  failure?: CaddyFailureKind;
  message: string;
  diagnostics: CaddyDiagnostic[];
  sessionId?: string;
  source?: CaddyConfigSource;
  exitCode?: number;
  exitSignal?: number;
}

export interface CaddyLogPage {
  sessionId: string;
  stdout: string;
  stderr: string;
  stdoutOffset: number;
  stderrOffset: number;
  hasMore: boolean;
}

function signedInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw createInternalError();
  }
  return value;
}

export function decodeRunStatus(value: unknown): CaddyRunStatus {
  const wire = record(value);
  exactKeys(
    wire,
    ["state", "message", "diagnostics"],
    ["failure", "sessionId", "source", "exitCode", "exitSignal"],
  );
  const state = oneOf(wire.state, CADDY_RUN_STATES);
  const failure =
    wire.failure === undefined ? undefined : oneOf(wire.failure, CADDY_FAILURE_KINDS);
  if ((state === "FAILED") !== (failure !== undefined)) throw createInternalError();

  const status: CaddyRunStatus = {
    state,
    message: nonEmptyText(wire.message),
    diagnostics: list(wire.diagnostics, MAX_DIAGNOSTICS_RESPONSE, decodeDiagnostic),
  };
  if (failure !== undefined) status.failure = failure;
  if (wire.sessionId !== undefined) status.sessionId = nonEmptyText(wire.sessionId);
  if (wire.source !== undefined) status.source = oneOf(wire.source, CADDY_CONFIG_SOURCES);
  if (wire.exitCode !== undefined) status.exitCode = signedInteger(wire.exitCode);
  if (wire.exitSignal !== undefined) status.exitSignal = signedInteger(wire.exitSignal);
  return status;
}

export const CADDY_APPLIED_STATES = ["APPLIED", "PENDING", "UNKNOWN"] as const;
export type CaddyAppliedState = (typeof CADDY_APPLIED_STATES)[number];

const CADDY_APPLY_OUTCOMES = ["SUCCEEDED", "FAILED"] as const;

export const CADDY_APPLY_FAILURES = [
  "VALIDATION_FAILED",
  "PREPARATION_FAILED",
  "COMMAND_FAILED",
  "TIMEOUT",
  "REVIEW_FAILED",
] as const;
export type CaddyApplyFailure = (typeof CADDY_APPLY_FAILURES)[number];

export const CADDY_SERVING_CONFIGS = ["PREVIOUS", "CANDIDATE", "UNKNOWN"] as const;
export type CaddyServingConfig = (typeof CADDY_SERVING_CONFIGS)[number];

export interface CaddyInstanceReview {
  alive: boolean;
  adminReachable: boolean;
  config: CaddyServingConfig;
}

export interface CaddyApplyReport {
  sessionId: string;
  outcome: (typeof CADDY_APPLY_OUTCOMES)[number];
  failure?: CaddyApplyFailure;
  message: string;
  review?: CaddyInstanceReview;
  diagnostics: CaddyDiagnostic[];
}

export interface CaddyStatus extends CaddyRunStatus {
  applied: CaddyAppliedState;
  applying: boolean;
  lastApply?: CaddyApplyReport;
}

function decodeInstanceReview(value: unknown): CaddyInstanceReview {
  const wire = record(value);
  exactKeys(wire, ["alive", "adminReachable", "config"]);
  return {
    alive: boolean(wire.alive),
    adminReachable: boolean(wire.adminReachable),
    config: oneOf(wire.config, CADDY_SERVING_CONFIGS),
  };
}

export function decodeApplyReport(value: unknown): CaddyApplyReport {
  const wire = record(value);
  exactKeys(wire, ["sessionId", "outcome", "message", "diagnostics"], ["failure", "review"]);
  const outcome = oneOf(wire.outcome, CADDY_APPLY_OUTCOMES);
  const failure =
    wire.failure === undefined ? undefined : oneOf(wire.failure, CADDY_APPLY_FAILURES);
  if ((outcome === "FAILED") !== (failure !== undefined)) throw createInternalError();

  const report: CaddyApplyReport = {
    sessionId: nonEmptyText(wire.sessionId),
    outcome,
    message: nonEmptyText(wire.message),
    diagnostics: list(wire.diagnostics, MAX_DIAGNOSTICS_RESPONSE, decodeDiagnostic),
  };
  if (failure !== undefined) report.failure = failure;
  if (wire.review !== undefined) report.review = decodeInstanceReview(wire.review);
  return report;
}

export function decodeCaddyStatus(value: unknown): CaddyStatus {
  const { applied, applying, lastApply, ...run } = record(value);
  const status: CaddyStatus = {
    ...decodeRunStatus(run),
    applied: oneOf(applied, CADDY_APPLIED_STATES),
    applying: boolean(applying),
  };
  if (lastApply !== undefined) status.lastApply = decodeApplyReport(lastApply);
  return status;
}

const MAX_CONFLICT_ITEMS = 256;

function optionalOccupant(value: unknown): CaddyOccupant | undefined {
  if (value === null) return undefined;
  const wire = record(value);
  exactKeys(wire, ["name", "pid"]);
  return { name: nonEmptyText(wire.name), pid: nonNegativeInteger(wire.pid) };
}

function decodeExternalInstance(value: unknown): CaddyExternalInstance {
  const wire = record(value);
  exactKeys(wire, ["label", "domain", "runState", "pid", "explanation"]);
  const instance: CaddyExternalInstance = {
    label: nonEmptyText(wire.label),
    domain: oneOf(wire.domain, CADDY_EXTERNAL_DOMAINS),
    runState: oneOf(wire.runState, CADDY_EXTERNAL_RUN_STATES),
    explanation: nonEmptyText(wire.explanation),
  };
  if (wire.pid !== null) instance.pid = nonNegativeInteger(wire.pid);
  return instance;
}

function decodeExternalReport(value: unknown): CaddyExternalReport {
  const wire = record(value);
  exactKeys(wire, ["snapshot", "explanation", "instances"]);
  return {
    snapshot: oneOf(wire.snapshot, CADDY_SNAPSHOT_STATUSES),
    explanation: nonEmptyText(wire.explanation),
    instances: list(wire.instances, MAX_CONFLICT_ITEMS, decodeExternalInstance),
  };
}

function decodePortFinding(value: unknown): CaddyPortFinding {
  const wire = record(value);
  exactKeys(wire, ["host", "port", "state", "occupant", "explanation"]);
  const finding: CaddyPortFinding = {
    host: nonEmptyText(wire.host),
    port: port(wire.port),
    state: oneOf(wire.state, CADDY_PORT_STATES),
    explanation: nonEmptyText(wire.explanation),
  };
  const occupant = optionalOccupant(wire.occupant);
  if (occupant !== undefined) finding.occupant = occupant;
  return finding;
}

function decodeUpstreamFinding(value: unknown): CaddyUpstreamFinding {
  const wire = record(value);
  exactKeys(wire, ["host", "port", "state", "explanation"]);
  return {
    host: nonEmptyText(wire.host),
    port: port(wire.port),
    state: oneOf(wire.state, CADDY_UPSTREAM_STATES),
    explanation: nonEmptyText(wire.explanation),
  };
}

// The verdict and the blocking reasons must agree, and only a complete picture
// with every port checked may be called clear.
export function decodeConflictReport(value: unknown): CaddyConflictReport {
  const wire = record(value);
  exactKeys(wire, ["verdict", "headline", "blocks", "external", "ports", "upstreams", "notes"]);
  const verdict = oneOf(wire.verdict, CADDY_CONFLICT_VERDICTS);
  const blocks = list(wire.blocks, CADDY_BLOCK_REASONS.length, (item) =>
    oneOf(item, CADDY_BLOCK_REASONS),
  );
  const external = decodeExternalReport(wire.external);
  const ports = list(wire.ports, MAX_CONFLICT_ITEMS, decodePortFinding);
  if ((verdict === "BLOCKED") !== (blocks.length > 0)) throw createInternalError();
  if (
    verdict === "CLEAR" &&
    (external.snapshot !== "COMPLETE" || ports.some((port) => port.state === "UNCHECKED"))
  ) {
    throw createInternalError();
  }
  return {
    verdict,
    headline: nonEmptyText(wire.headline),
    blocks,
    external,
    ports,
    upstreams: list(wire.upstreams, MAX_CONFLICT_ITEMS, decodeUpstreamFinding),
    notes: list(wire.notes, MAX_NOTES, nonEmptyText),
  };
}

// A summary carries exactly one of a plan (ready to start) or a block reason.
export function decodeStartSummary(value: unknown): CaddyStartSummary {
  const wire = record(value);
  exactKeys(
    wire,
    ["source", "workingDirectory", "configFingerprint", "listen", "upstreams", "adminEndpoint", "notes"],
    ["planId", "executablePath", "version", "blocked", "conflicts"],
  );
  const planId = wire.planId === undefined ? undefined : nonEmptyText(wire.planId);
  const blocked = wire.blocked === undefined ? undefined : nonEmptyText(wire.blocked);
  if ((planId === undefined) === (blocked === undefined)) throw createInternalError();
  if (planId !== undefined && (wire.executablePath === undefined || wire.version === undefined)) {
    throw createInternalError();
  }

  const summary: CaddyStartSummary = {
    source: oneOf(wire.source, CADDY_CONFIG_SOURCES),
    workingDirectory: nonEmptyText(wire.workingDirectory),
    configFingerprint: nonEmptyText(wire.configFingerprint),
    listen: list(wire.listen, MAX_REPORT_ITEMS, nonEmptyText),
    upstreams: list(wire.upstreams, MAX_REPORT_ITEMS, nonEmptyText),
    adminEndpoint: nonEmptyText(wire.adminEndpoint),
    notes: list(wire.notes, MAX_NOTES, nonEmptyText),
  };
  if (planId !== undefined) summary.planId = planId;
  if (wire.executablePath !== undefined) summary.executablePath = nonEmptyText(wire.executablePath);
  if (wire.version !== undefined) summary.version = nonEmptyText(wire.version);
  if (blocked !== undefined) summary.blocked = blocked;
  if (wire.conflicts !== undefined) summary.conflicts = decodeConflictReport(wire.conflicts);
  return summary;
}

export function decodeLogPage(value: unknown): CaddyLogPage {
  const wire = record(value);
  exactKeys(wire, ["sessionId", "stdout", "stderr", "stdoutOffset", "stderrOffset", "hasMore"]);
  return {
    sessionId: nonEmptyText(wire.sessionId),
    stdout: text(wire.stdout),
    stderr: text(wire.stderr),
    stdoutOffset: nonNegativeInteger(wire.stdoutOffset),
    stderrOffset: nonNegativeInteger(wire.stderrOffset),
    hasMore: boolean(wire.hasMore),
  };
}

// The source kind is the only choice sent; the backend reads the saved text itself.
export function caddyPrepareStart(source: CaddyConfigSource): Promise<CaddyStartSummary> {
  return invokeCommand("caddy_prepare_start", decodeStartSummary, { input: { source } });
}

export interface CaddyStartOptions {
  // Only an unconfirmed external state can be accepted; a conflict is refused by the backend regardless.
  acceptUnconfirmed?: boolean;
}

// Starting is only ever called with the plan a preview returned, after the user confirmed it.
export function caddyStart(
  planId: string,
  source: CaddyConfigSource,
  options: CaddyStartOptions = {},
): Promise<CaddyRunStatus> {
  return invokeCommand("caddy_start", decodeRunStatus, {
    input: {
      planId,
      source,
      confirmed: true,
      ...(options.acceptUnconfirmed === true ? { acceptUnconfirmed: true } : {}),
    },
  });
}

export function caddyStop(): Promise<CaddyRunStatus> {
  return invokeCommand("caddy_stop", decodeRunStatus);
}

export function caddyStatus(): Promise<CaddyStatus> {
  return invokeCommand("caddy_status", decodeCaddyStatus);
}

// Reloads the own running instance with the saved config. Only call after the user confirmed the reload risk.
export function caddyApply(sessionId: string, source: CaddyConfigSource): Promise<CaddyApplyReport> {
  return invokeCommand("caddy_apply", decodeApplyReport, {
    input: { sessionId, source, confirmed: true },
  });
}

export function caddyLogs(
  sessionId: string,
  stdoutOffset: number,
  stderrOffset: number,
): Promise<CaddyLogPage> {
  return invokeCommand("caddy_logs", decodeLogPage, {
    input: { sessionId, stdoutOffset, stderrOffset },
  });
}
