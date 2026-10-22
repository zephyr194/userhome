import {
  MAX_DRAFT_UPSTREAMS,
  PORT_MESSAGE,
  TLS_MISSING_MESSAGE,
  newUpstreamDraft,
  parsePort,
  siteFieldKey,
  siteTlsKey,
  tlsOf,
  upstreamFieldKey,
  type IdSource,
  type SiteDraft,
} from "./caddyRulesModel";

export type DirectiveId = "listen.host" | "listen.port" | "upstream" | "tls" | "accessLog";

export type DirectiveControl = "host" | "port" | "upstream" | "file-pair" | "switch";

export interface DirectiveDefinition {
  label: string;
  short: string;
  control: DirectiveControl;
  required: boolean;
  requiredReason?: string;
  repeatable: boolean;
  validate: (site: SiteDraft, siteIndex: number) => Record<string, string>;
}

const NO_LOCAL_ERRORS = (): Record<string, string> => ({});

export const DIRECTIVE_IDS: readonly DirectiveId[] = [
  "listen.host",
  "listen.port",
  "upstream",
  "tls",
  "accessLog",
];

export const DIRECTIVES: Record<DirectiveId, DirectiveDefinition> = {
  "listen.host": {
    label: "监听主机",
    short: "监听主机",
    control: "host",
    required: true,
    requiredReason: "必填指令，不能删除。",
    repeatable: false,
    // Host syntax and range are judged by the backend, so the editor adds no local message.
    validate: NO_LOCAL_ERRORS,
  },
  "listen.port": {
    label: "监听端口",
    short: "监听端口",
    control: "port",
    required: true,
    requiredReason: "必填指令，不能删除。",
    repeatable: false,
    validate: (site, siteIndex) =>
      parsePort(site.port) === undefined ? { [siteFieldKey(siteIndex, "listen.port")]: PORT_MESSAGE } : {},
  },
  upstream: {
    label: "上游（反向代理目标）",
    short: "上游",
    control: "upstream",
    required: true,
    requiredReason: "至少保留一个上游。",
    repeatable: true,
    validate: (site, siteIndex) => {
      const errors: Record<string, string> = {};
      site.upstreams.forEach((upstream, upstreamIndex) => {
        if (parsePort(upstream.port) === undefined) {
          errors[upstreamFieldKey(siteIndex, upstreamIndex, "port")] = PORT_MESSAGE;
        }
      });
      return errors;
    },
  },
  tls: {
    label: "使用 HTTPS（已有证书与私钥）",
    short: "HTTPS",
    control: "file-pair",
    required: false,
    repeatable: false,
    validate: (site, siteIndex) =>
      site.tls !== null && tlsOf(site.tls) === undefined
        ? { [siteTlsKey(siteIndex)]: TLS_MISSING_MESSAGE }
        : {},
  },
  accessLog: {
    label: "记录访问日志",
    short: "访问日志",
    control: "switch",
    required: false,
    repeatable: false,
    validate: NO_LOCAL_ERRORS,
  },
};

export interface DirectiveRow {
  rowKey: string;
  id: DirectiveId;
  upstreamKey?: number;
}

export function directiveRows(site: SiteDraft): DirectiveRow[] {
  return [
    { rowKey: "listen.host", id: "listen.host" },
    { rowKey: "listen.port", id: "listen.port" },
    ...site.upstreams.map((upstream) => ({
      rowKey: `upstream-${upstream.key}`,
      id: "upstream" as const,
      upstreamKey: upstream.key,
    })),
    ...(site.tls === null ? [] : [{ rowKey: "tls", id: "tls" as const }]),
    ...(site.accessLog ? [{ rowKey: "accessLog", id: "accessLog" as const }] : []),
  ];
}

export function isRequiredRow(site: SiteDraft, row: DirectiveRow): boolean {
  if (row.id === "upstream") return site.upstreams.length <= 1;
  return DIRECTIVES[row.id].required;
}

export function canAddDirective(site: SiteDraft, id: DirectiveId): boolean {
  switch (id) {
    case "upstream":
      return site.upstreams.length < MAX_DRAFT_UPSTREAMS;
    case "tls":
      return site.tls === null;
    case "accessLog":
      return !site.accessLog;
    default:
      return false;
  }
}

// Upstream is always listed (it is repeatable); the editor disables it at the limit.
export function addableDirectives(site: SiteDraft): DirectiveId[] {
  return DIRECTIVE_IDS.filter((id) => id === "upstream" || canAddDirective(site, id));
}

export function removeDirectiveRow(site: SiteDraft, row: DirectiveRow): SiteDraft {
  switch (row.id) {
    case "upstream":
      return { ...site, upstreams: site.upstreams.filter((upstream) => upstream.key !== row.upstreamKey) };
    case "tls":
      return { ...site, tls: null };
    case "accessLog":
      return { ...site, accessLog: false };
    default:
      return site;
  }
}

export function addDirective(site: SiteDraft, id: DirectiveId, ids: IdSource): SiteDraft {
  switch (id) {
    case "upstream":
      return { ...site, upstreams: [...site.upstreams, newUpstreamDraft(ids)] };
    case "tls":
      return { ...site, tls: site.tls ?? {} };
    case "accessLog":
      return { ...site, accessLog: true };
    default:
      return site;
  }
}

export function rowDirectiveOptions(site: SiteDraft, row: DirectiveRow): DirectiveId[] {
  if (isRequiredRow(site, row)) return [row.id];
  const without = removeDirectiveRow(site, row);
  return DIRECTIVE_IDS.filter((id) => id === row.id || canAddDirective(without, id));
}

export function changeRowDirective(
  site: SiteDraft,
  row: DirectiveRow,
  next: DirectiveId,
  ids: IdSource,
): SiteDraft {
  if (next === row.id) return site;
  return addDirective(removeDirectiveRow(site, row), next, ids);
}
