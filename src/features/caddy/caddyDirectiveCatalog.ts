import type { MessageKey } from "../../i18n";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";
import {
  MAX_DRAFT_UPSTREAMS,
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
  label: MessageKey;
  short: MessageKey;
  control: DirectiveControl;
  required: boolean;
  requiredReason?: MessageKey;
  repeatable: boolean;
  validate: (site: SiteDraft, siteIndex: number, copy?: CaddyCopy) => Record<string, string>;
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
    label: "caddy.directive.listenHost",
    short: "caddy.directive.listenHostShort",
    control: "host",
    required: true,
    requiredReason: "caddy.directive.requiredRow",
    repeatable: false,
    // Host syntax and range are judged by the backend, so the editor adds no local message.
    validate: NO_LOCAL_ERRORS,
  },
  "listen.port": {
    label: "caddy.directive.listenPort",
    short: "caddy.directive.listenPortShort",
    control: "port",
    required: true,
    requiredReason: "caddy.directive.requiredRow",
    repeatable: false,
    validate: (site, siteIndex, copy = ZH_COPY) =>
      parsePort(site.port) === undefined
        ? { [siteFieldKey(siteIndex, "listen.port")]: copy.t("caddy.rules.portInvalid") }
        : {},
  },
  upstream: {
    label: "caddy.directive.upstream",
    short: "caddy.directive.upstreamShort",
    control: "upstream",
    required: true,
    requiredReason: "caddy.directive.requiredUpstream",
    repeatable: true,
    validate: (site, siteIndex, copy = ZH_COPY) => {
      const errors: Record<string, string> = {};
      site.upstreams.forEach((upstream, upstreamIndex) => {
        if (parsePort(upstream.port) === undefined) {
          errors[upstreamFieldKey(siteIndex, upstreamIndex, "port")] = copy.t("caddy.rules.portInvalid");
        }
      });
      return errors;
    },
  },
  tls: {
    label: "caddy.directive.tls",
    short: "caddy.directive.tlsShort",
    control: "file-pair",
    required: false,
    repeatable: false,
    validate: (site, siteIndex, copy = ZH_COPY) =>
      site.tls !== null && tlsOf(site.tls) === undefined
        ? { [siteTlsKey(siteIndex)]: copy.t("caddy.rules.tlsMissing") }
        : {},
  },
  accessLog: {
    label: "caddy.directive.accessLog",
    short: "caddy.directive.accessLogShort",
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
