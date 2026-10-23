import type {
  CaddyCandidateOutcome,
  CaddyExposure,
  CaddyIssue,
  CaddyLineChange,
  CaddyPreview,
  CaddyRules,
  CaddySite,
  CaddyTls,
  CaddyTlsSiteStatus,
  CaddyUpstreamScheme,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { MessageKey } from "../../i18n";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

export const MAX_DRAFT_SITES = 32;
export const MAX_DRAFT_UPSTREAMS = 8;
export const DEFAULT_LISTEN_HOST = "127.0.0.1";
const RULES_VERSION = 1;
const PORT_PATTERN = /^\d{1,5}$/;
export const ACCESS_LOG_PRIVACY_KEY = "caddy.rules.accessLogPrivacy";
export const TLS_FILES_NOTICE_KEY = "caddy.rules.tlsFilesNotice";
export const ACCESS_LOG_PRIVACY_NOTICE = ZH_COPY.t(ACCESS_LOG_PRIVACY_KEY);
export const TLS_FILES_NOTICE = ZH_COPY.t(TLS_FILES_NOTICE_KEY);

export interface UpstreamDraft {
  key: number;
  scheme: CaddyUpstreamScheme;
  host: string;
  port: string;
}

export type TlsSlot = "certificate" | "privateKey";

export interface TlsDraft {
  certificateGrantId?: string;
  privateKeyGrantId?: string;
}

export interface SiteDraft {
  key: number;
  enabled: boolean;
  host: string;
  port: string;
  upstreams: UpstreamDraft[];
  tls: TlsDraft | null;
  accessLog: boolean;
}

export interface IdSource {
  next(): number;
}

export function createIdSource(): IdSource {
  let last = 0;
  return {
    next() {
      last += 1;
      return last;
    },
  };
}

export function newUpstreamDraft(ids: IdSource): UpstreamDraft {
  return { key: ids.next(), scheme: "http", host: DEFAULT_LISTEN_HOST, port: "" };
}

export function newSiteDraft(ids: IdSource): SiteDraft {
  return {
    key: ids.next(),
    enabled: true,
    host: DEFAULT_LISTEN_HOST,
    port: "",
    upstreams: [newUpstreamDraft(ids)],
    tls: null,
    accessLog: false,
  };
}

export function siteDraftsFromRules(rules: CaddyRules, ids: IdSource): SiteDraft[] {
  return rules.sites.map((site) => ({
    key: ids.next(),
    enabled: site.enabled,
    host: site.listen.host,
    port: String(site.listen.port),
    upstreams: site.upstreams.map((upstream) => ({
      key: ids.next(),
      scheme: upstream.scheme,
      host: upstream.host,
      port: String(upstream.port),
    })),
    tls:
      site.tls === undefined
        ? null
        : {
            certificateGrantId: site.tls.certificateGrantId,
            privateKeyGrantId: site.tls.privateKeyGrantId,
          },
    accessLog: site.accessLog === true,
  }));
}

export function siteTlsKey(site: number): string {
  return `site.${site}.tls`;
}

export function tlsOf(draft: TlsDraft | null): CaddyTls | undefined {
  if (draft === null || draft.certificateGrantId === undefined || draft.privateKeyGrantId === undefined) {
    return undefined;
  }
  return { certificateGrantId: draft.certificateGrantId, privateKeyGrantId: draft.privateKeyGrantId };
}

export function withTlsGrant(
  sites: SiteDraft[],
  siteIndex: number,
  slot: TlsSlot,
  grantId: string,
): SiteDraft[] {
  return sites.map((site, position) => {
    if (position !== siteIndex) return site;
    const current = site.tls ?? {};
    return {
      ...site,
      tls:
        slot === "certificate"
          ? { ...current, certificateGrantId: grantId }
          : { ...current, privateKeyGrantId: grantId },
    };
  });
}

export function parsePort(text: string): number | undefined {
  if (!PORT_PATTERN.test(text)) return undefined;
  const value = Number(text);
  return value <= 65535 ? value : undefined;
}

export function siteFieldKey(site: number, part: "listen.host" | "listen.port" | "upstreams"): string {
  return `site.${site}.${part}`;
}

export function upstreamFieldKey(site: number, upstream: number, part: "host" | "port"): string {
  return `site.${site}.upstream.${upstream}.${part}`;
}

export type DraftResult =
  | { ok: true; rules: CaddyRules }
  | { ok: false; errors: Record<string, string> };

// Local checks cover only what the rule model cannot express (a port that is not
// a number). Host, range and conflict checks stay with the backend.
export function rulesFromDraft(sites: SiteDraft[], copy: CaddyCopy = ZH_COPY): DraftResult {
  const errors: Record<string, string> = {};
  const built: CaddySite[] = sites.map((site, siteIndex) => {
    const listenPort = parsePort(site.port);
    if (listenPort === undefined) {
      errors[siteFieldKey(siteIndex, "listen.port")] = copy.t("caddy.rules.portInvalid");
    }
    const tls = tlsOf(site.tls);
    if (site.tls !== null && tls === undefined) {
      errors[siteTlsKey(siteIndex)] = copy.t("caddy.rules.tlsMissing");
    }
    return {
      enabled: site.enabled,
      listen: { host: site.host, port: listenPort ?? 0 },
      upstreams: site.upstreams.map((upstream, upstreamIndex) => {
        const upstreamPort = parsePort(upstream.port);
        if (upstreamPort === undefined) {
          errors[upstreamFieldKey(siteIndex, upstreamIndex, "port")] = copy.t("caddy.rules.portInvalid");
        }
        return {
          scheme: upstream.scheme,
          host: upstream.host,
          port: upstreamPort ?? 0,
        };
      }),
      ...(tls === undefined ? {} : { tls }),
      ...(site.accessLog ? { accessLog: true } : {}),
    };
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, rules: { version: RULES_VERSION, sites: built } };
}

const ISSUE_PART_BY_FIELD: Record<string, "listen.host" | "listen.port" | "upstreams"> = {
  "listen.host": "listen.host",
  "listen.port": "listen.port",
  upstreams: "upstreams",
};

export function issueFieldKey(issue: CaddyIssue): string | undefined {
  if (issue.site === undefined || issue.field === undefined) return undefined;
  if (issue.field === "upstreams.host" || issue.field === "upstreams.port") {
    if (issue.upstream === undefined) return undefined;
    return upstreamFieldKey(issue.site, issue.upstream, issue.field === "upstreams.host" ? "host" : "port");
  }
  const part = ISSUE_PART_BY_FIELD[issue.field];
  return part === undefined ? undefined : siteFieldKey(issue.site, part);
}

export interface MappedIssues {
  byField: Record<string, CaddyIssue[]>;
  general: CaddyIssue[];
}

export function mapIssuesToFields(issues: CaddyIssue[]): MappedIssues {
  const byField: Record<string, CaddyIssue[]> = {};
  const general: CaddyIssue[] = [];
  for (const issue of issues) {
    const key = issueFieldKey(issue);
    if (key === undefined) {
      general.push(issue);
    } else {
      byField[key] = [...(byField[key] ?? []), issue];
    }
  }
  return { byField, general };
}

export interface FieldFeedback {
  error?: string;
  warning?: string;
}

export function feedbackForField(
  key: string,
  mapped: MappedIssues,
  localErrors: Record<string, string>,
): FieldFeedback {
  const issues = mapped.byField[key] ?? [];
  const error = localErrors[key] ?? issues.find((issue) => issue.severity === "ERROR")?.message;
  const warning = issues.find((issue) => issue.severity === "WARNING")?.message;
  return {
    ...(error === undefined ? {} : { error }),
    ...(warning === undefined ? {} : { warning }),
  };
}

export function externalExposures(exposures: CaddyExposure[]): CaddyExposure[] {
  return exposures.filter((exposure) => exposure.visibleExternally);
}

const DIFF_MARKERS: Record<CaddyLineChange, { symbol: string; labelKey: MessageKey }> = {
  ADDED: { symbol: "+", labelKey: "caddy.diff.added" },
  REMOVED: { symbol: "-", labelKey: "caddy.diff.removed" },
  UNCHANGED: { symbol: " ", labelKey: "caddy.diff.unchanged" },
};

export function diffMarker(
  change: CaddyLineChange,
  copy: CaddyCopy = ZH_COPY,
): { symbol: string; label: string } {
  const marker = DIFF_MARKERS[change];
  return { symbol: marker.symbol, label: copy.t(marker.labelKey) };
}

const CANDIDATE_OUTCOME_KEY: Record<CaddyCandidateOutcome, MessageKey> = {
  MISSING: "caddy.candidate.missing",
  UNREADABLE: "caddy.candidate.unreadable",
  OUTSIDE_ROOT: "caddy.candidate.outsideRoot",
  NOT_REGULAR_FILE: "caddy.candidate.notRegularFile",
  NOT_EXECUTABLE: "caddy.candidate.notExecutable",
  GROUP_OR_WORLD_WRITABLE: "caddy.candidate.groupOrWorldWritable",
  USABLE: "caddy.candidate.usable",
};

export function candidateOutcomeText(
  outcome: CaddyCandidateOutcome,
  copy: CaddyCopy = ZH_COPY,
): string {
  return copy.t(CANDIDATE_OUTCOME_KEY[outcome]);
}

export type PreviewState =
  | { status: "pending" }
  | { status: "ready"; preview: CaddyPreview }
  | { status: "failed"; error: AppError };

export interface SaveGate {
  enabled: boolean;
  reason?: string;
}

export function saveGate(
  input: {
    localValid: boolean;
    preview: PreviewState;
    saving: boolean;
  },
  copy: CaddyCopy = ZH_COPY,
): SaveGate {
  const { t } = copy;
  if (!input.localValid) return { enabled: false, reason: t("caddy.gate.fixForm") };
  if (input.preview.status === "pending") return { enabled: false, reason: t("caddy.gate.validating") };
  if (input.preview.status === "failed") return { enabled: false, reason: t("caddy.gate.previewFailed") };
  if (!input.preview.preview.valid) return { enabled: false, reason: t("caddy.gate.invalid") };
  if (input.saving) return { enabled: false, reason: t("caddy.gate.saving") };
  return { enabled: true };
}

export interface TlsFileLine {
  symbol: string;
  text: string;
}

const TLS_SLOT_KEY: Record<TlsSlot, MessageKey> = {
  certificate: "caddy.tls.slot.certificate",
  privateKey: "caddy.tls.slot.privateKey",
};

// Names come from the backend status only; a directory never reaches this text.
export function tlsFileLine(
  slot: TlsSlot,
  grantId: string | undefined,
  status: CaddyTlsSiteStatus | undefined,
  copy: CaddyCopy = ZH_COPY,
): TlsFileLine {
  const { t } = copy;
  const slotLabel = t(TLS_SLOT_KEY[slot]);
  if (grantId === undefined) {
    return { symbol: "○", text: t("caddy.tls.notChosen", { slot: slotLabel }) };
  }
  if (status === undefined) return { symbol: "…", text: t("caddy.tls.checking") };
  if (status.state === "BLOCKED") {
    const message = status.message ?? t("caddy.tls.unavailable");
    // Backend messages are Chinese and name the slot in Chinese, so the match uses the zh label.
    return message.includes(ZH_COPY.t(TLS_SLOT_KEY[slot]))
      ? { symbol: "✕", text: message }
      : { symbol: "✕", text: t("caddy.tls.failedCheck", { message }) };
  }
  const name = slot === "certificate" ? status.certificateName : status.privateKeyName;
  if (name === undefined) return { symbol: "✕", text: t("caddy.tls.unavailable") };
  if (slot === "privateKey" && status.warnings.includes("PRIVATE_KEY_READABLE_BY_OTHERS")) {
    return { symbol: "⚠", text: t("caddy.tls.selectedWeakPermission", { name }) };
  }
  return { symbol: "✓", text: t("caddy.tls.selected", { name }) };
}
