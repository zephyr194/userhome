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
