import type { AppError } from "../../ipc/core";
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

export const MAX_DRAFT_SITES = 32;
export const MAX_DRAFT_UPSTREAMS = 8;
export const DEFAULT_LISTEN_HOST = "127.0.0.1";
const RULES_VERSION = 1;
const PORT_PATTERN = /^\d{1,5}$/;
const PORT_MESSAGE = "端口必须是 0 到 65535 之间的整数。";
const TLS_MISSING_MESSAGE = "请选择证书文件与私钥文件，或关闭 HTTPS。";
export const ACCESS_LOG_PRIVACY_NOTICE =
  "开启后会记录请求的 URL、客户端地址等信息，可能包含个人数据或凭据。日志只保留在本应用的有界缓冲中，不会自动外发。";
export const TLS_FILES_NOTICE =
  "应用只检查文件是否存在、是否为普通文件以及私钥权限，不读取证书或私钥内容，也未检查证书有效期与域名是否匹配。不会申请证书，也不会安装信任。";

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

function tlsOf(draft: TlsDraft | null): CaddyTls | undefined {
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
export function rulesFromDraft(sites: SiteDraft[]): DraftResult {
  const errors: Record<string, string> = {};
  const built: CaddySite[] = sites.map((site, siteIndex) => {
    const listenPort = parsePort(site.port);
    if (listenPort === undefined) {
      errors[siteFieldKey(siteIndex, "listen.port")] = PORT_MESSAGE;
    }
    const tls = tlsOf(site.tls);
    if (site.tls !== null && tls === undefined) {
      errors[siteTlsKey(siteIndex)] = TLS_MISSING_MESSAGE;
    }
    return {
      enabled: site.enabled,
      listen: { host: site.host, port: listenPort ?? 0 },
      upstreams: site.upstreams.map((upstream, upstreamIndex) => {
        const upstreamPort = parsePort(upstream.port);
        if (upstreamPort === undefined) {
          errors[upstreamFieldKey(siteIndex, upstreamIndex, "port")] = PORT_MESSAGE;
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

const DIFF_MARKERS: Record<CaddyLineChange, { symbol: string; label: string }> = {
  ADDED: { symbol: "+", label: "新增" },
  REMOVED: { symbol: "-", label: "删除" },
  UNCHANGED: { symbol: " ", label: "不变" },
};

export function diffMarker(change: CaddyLineChange): { symbol: string; label: string } {
  return DIFF_MARKERS[change];
}

const CANDIDATE_OUTCOME_TEXT: Record<CaddyCandidateOutcome, string> = {
  MISSING: "该位置没有文件",
  UNREADABLE: "无法读取该位置",
  OUTSIDE_ROOT: "指向安装目录之外，已拒绝",
  NOT_REGULAR_FILE: "不是普通文件",
  NOT_EXECUTABLE: "没有可执行权限",
  GROUP_OR_WORLD_WRITABLE: "组或其他用户可写，已拒绝",
  USABLE: "结构检查通过",
};

export function candidateOutcomeText(outcome: CaddyCandidateOutcome): string {
  return CANDIDATE_OUTCOME_TEXT[outcome];
}

export type PreviewState =
  | { status: "pending" }
  | { status: "ready"; preview: CaddyPreview }
  | { status: "failed"; error: AppError };

export interface SaveGate {
  enabled: boolean;
  reason?: string;
}

export function saveGate(input: {
  localValid: boolean;
  preview: PreviewState;
  saving: boolean;
}): SaveGate {
  if (!input.localValid) return { enabled: false, reason: "请先修正表单中的错误。" };
  if (input.preview.status === "pending") return { enabled: false, reason: "正在校验，请稍候。" };
  if (input.preview.status === "failed") return { enabled: false, reason: "预览失败，无法保存。" };
  if (!input.preview.preview.valid) return { enabled: false, reason: "校验未通过，无法保存。" };
  if (input.saving) return { enabled: false, reason: "保存中……" };
  return { enabled: true };
}

export interface TlsFileLine {
  symbol: string;
  text: string;
}

const TLS_SLOT_LABEL: Record<TlsSlot, string> = {
  certificate: "证书",
  privateKey: "私钥",
};

// Names come from the backend status only; a directory never reaches this text.
export function tlsFileLine(
  slot: TlsSlot,
  grantId: string | undefined,
  status: CaddyTlsSiteStatus | undefined,
): TlsFileLine {
  if (grantId === undefined) return { symbol: "○", text: `未选择${TLS_SLOT_LABEL[slot]}文件` };
  if (status === undefined) return { symbol: "…", text: "正在检查" };
  const label = TLS_SLOT_LABEL[slot];
  if (status.state === "BLOCKED") {
    const message = status.message ?? "授权不可用，请重新选择文件。";
    return message.includes(label)
      ? { symbol: "✕", text: message }
      : { symbol: "✕", text: `未通过检查：${message}` };
  }
  const name = slot === "certificate" ? status.certificateName : status.privateKeyName;
  if (name === undefined) return { symbol: "✕", text: "授权不可用，请重新选择文件。" };
  if (slot === "privateKey" && status.warnings.includes("PRIVATE_KEY_READABLE_BY_OTHERS")) {
    return { symbol: "⚠", text: `已选择：${name}（组或其他用户可读，建议改为仅本人可读）` };
  }
  return { symbol: "✓", text: `已选择：${name}` };
}
