import { useState } from "react";
import {
  ActionRow,
  Button,
  SelectField,
  StatusBadge,
  SwitchField,
  TextField,
  type SelectOption,
} from "../../components/ui";
import type { CaddyTlsSiteStatus, CaddyUpstreamScheme } from "../../ipc/caddy";
import { CaddyExamplesDialog } from "./CaddyExamplesDialog";
import { useCaddyCopy } from "./caddyCopy";
import {
  ACCESS_LOG_PRIVACY_KEY,
  MAX_DRAFT_SITES,
  TLS_FILES_NOTICE_KEY,
  feedbackForField,
  newSiteDraft,
  siteFieldKey,
  siteTlsKey,
  tlsFileLine,
  upstreamFieldKey,
  type FieldFeedback,
  type IdSource,
  type MappedIssues,
  type SiteDraft,
  type TlsFileLine,
  type TlsSlot,
  type UpstreamDraft,
} from "./caddyRulesModel";
import {
  DIRECTIVES,
  addDirective,
  addableDirectives,
  canAddDirective,
  changeRowDirective,
  directiveRows,
  isRequiredRow,
  removeDirectiveRow,
  rowDirectiveOptions,
  type DirectiveId,
  type DirectiveRow,
} from "./caddyDirectiveCatalog";

const SCHEME_OPTIONS: readonly SelectOption<CaddyUpstreamScheme>[] = [
  { value: "http", label: "http" },
  { value: "https", label: "https" },
];

interface CaddyRulesEditorProps {
  sites: SiteDraft[];
  localErrors: Record<string, string>;
  mapped: MappedIssues;
  exposedSites: ReadonlySet<number>;
  tlsStatuses?: readonly CaddyTlsSiteStatus[];
  ids: IdSource;
  onChange: (next: SiteDraft[]) => void;
  onPickTlsFile?: (siteIndex: number, slot: TlsSlot) => void;
}

const NO_TLS_STATUSES: readonly CaddyTlsSiteStatus[] = [];

export function CaddyRulesEditor({
  sites,
  localErrors,
  mapped,
  exposedSites,
  tlsStatuses = NO_TLS_STATUSES,
  ids,
  onChange,
  onPickTlsFile = () => undefined,
}: CaddyRulesEditorProps) {
  const { t } = useCaddyCopy();
  const [examplesOpen, setExamplesOpen] = useState(false);
  const feedback = (key: string) => feedbackForField(key, mapped, localErrors);

  function replaceSite(index: number, next: SiteDraft) {
    onChange(sites.map((site, position) => (position === index ? next : site)));
  }

  return (
    <section aria-labelledby="caddy-rules-heading" className="grid min-w-0 gap-ui-8">
      <div className="flex flex-wrap items-center justify-between gap-ui-8">
        <h2 id="caddy-rules-heading" className="text-sm font-semibold">
          {t("caddy.rules.heading")}
        </h2>
        <div className="flex flex-wrap items-center gap-ui-8">
          <Button size="sm" variant="default" onClick={() => setExamplesOpen(true)}>
            {t("caddy.rules.examples")}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={sites.length >= MAX_DRAFT_SITES}
            onClick={() => onChange([...sites, newSiteDraft(ids)])}
          >
            {t("caddy.rules.addSite")}
          </Button>
        </div>
      </div>
      <CaddyExamplesDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} />
      {mapped.general.map((issue) => (
        <p key={`${issue.code}:${issue.message}`} role="alert" className="m-0 text-aux text-danger">
          {issue.message}
        </p>
      ))}
      {sites.length === 0 ? (
        <p className="m-0 text-body text-muted-foreground">{t("caddy.rules.noSites")}</p>
      ) : null}
      {sites.map((site, siteIndex) => {
        const upstreamList = feedback(siteFieldKey(siteIndex, "upstreams"));
        return (
          <section
            key={site.key}
            aria-labelledby={`caddy-site-${site.key}-heading`}
            className="grid min-w-0 gap-ui-12 rounded-panel bg-surface-muted p-ui-12"
          >
            <div className="flex flex-wrap items-center justify-between gap-ui-8">
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                <h3 id={`caddy-site-${site.key}-heading`} className="text-sm font-semibold">
                  {t("caddy.rules.siteHeading", { index: siteIndex + 1 })}
                </h3>
                {exposedSites.has(siteIndex) ? (
                  <StatusBadge tone="warning">{t("caddy.rules.exposedBadge")}</StatusBadge>
                ) : null}
              </div>
              <ActionRow align="end">
                <SwitchField
                  label={t("caddy.rules.enableSite")}
                  name={`site-${site.key}-enabled`}
                  checked={site.enabled}
                  onCheckedChange={(enabled) => replaceSite(siteIndex, { ...site, enabled })}
                />
              </ActionRow>
            </div>
            <ol className="m-0 grid list-none gap-ui-8 p-0">
              {directiveRows(site).map((row, rowIndex) => (
                <DirectiveRowView
                  key={row.rowKey}
                  site={site}
                  siteIndex={siteIndex}
                  row={row}
                  showLabel={rowIndex === 0}
                  ids={ids}
                  feedback={feedback}
                  tlsStatus={tlsStatuses.find((entry) => entry.site === siteIndex)}
                  onSite={(next) => replaceSite(siteIndex, next)}
                  onPickTlsFile={(slot) => onPickTlsFile(siteIndex, slot)}
                />
              ))}
            </ol>
            {upstreamList.error ? (
              <p role="alert" className="m-0 text-aux text-danger">
                {upstreamList.error}
              </p>
            ) : null}
            <AddDirectiveGroup site={site} ids={ids} onSite={(next) => replaceSite(siteIndex, next)} />
            <div className="flex justify-end border-t border-border pt-ui-8">
              <Button
                size="sm"
                variant="default"
                className="caddy-danger-outline"
                aria-label={t("caddy.rules.deleteSiteLabel", { site: siteIndex + 1 })}
                onClick={() => onChange(sites.filter((_, position) => position !== siteIndex))}
              >
                {t("caddy.rules.deleteSite")}
              </Button>
            </div>
          </section>
        );
      })}
    </section>
  );
}

interface DirectiveRowViewProps {
  site: SiteDraft;
  siteIndex: number;
  row: DirectiveRow;
  showLabel: boolean;
  ids: IdSource;
  feedback: (key: string) => FieldFeedback;
  tlsStatus: CaddyTlsSiteStatus | undefined;
  onSite: (next: SiteDraft) => void;
  onPickTlsFile: (slot: TlsSlot) => void;
}

function DirectiveRowView({
  site,
  siteIndex,
  row,
  showLabel,
  ids,
  feedback,
  tlsStatus,
  onSite,
  onPickTlsFile,
}: DirectiveRowViewProps) {
  const { t } = useCaddyCopy();
  const definition = DIRECTIVES[row.id];
  const required = isRequiredRow(site, row);
  const upstreamIndex = site.upstreams.findIndex((upstream) => upstream.key === row.upstreamKey);
  const directiveShort = t(definition.short);
  const options: SelectOption<DirectiveId>[] = rowDirectiveOptions(site, row).map((id) => ({
    value: id,
    label: t(DIRECTIVES[id].label),
  }));
  const remove = () => onSite(removeDirectiveRow(site, row));

  return (
    <li className="flex min-w-0 flex-wrap items-start gap-ui-8 rounded-control bg-surface p-ui-8">
      <div className="min-w-28">
        <SelectField
          label={
            showLabel ? (
              t("caddy.rules.directiveLabel")
            ) : (
              <span className="text-transparent">{t("caddy.rules.directiveLabel")}</span>
            )
          }
          name={`site-${site.key}-${row.rowKey}-directive`}
          options={options}
          value={row.id}
          disabled={options.length <= 1}
          onValueChange={(next) => onSite(changeRowDirective(site, row, next, ids))}
        />
      </div>
      <div className="grid min-w-0 flex-1 gap-ui-8">
        <DirectiveValue
          site={site}
          siteIndex={siteIndex}
          row={row}
          upstreamIndex={upstreamIndex}
          feedback={feedback}
          tlsStatus={tlsStatus}
          onSite={onSite}
          onPickTlsFile={onPickTlsFile}
        />
      </div>
      <div className="caddy-directive__remove flex shrink-0 items-start">
        {row.id === "upstream" ? (
          <Button
            variant="ghost"
            aria-label={t("caddy.rules.deleteUpstreamLabel", {
              upstream: upstreamIndex + 1,
              site: siteIndex + 1,
            })}
            disabled={required}
            title={required && definition.requiredReason ? t(definition.requiredReason) : undefined}
            onClick={remove}
          >
            {t("caddy.rules.deleteUpstream")}
          </Button>
        ) : required ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("caddy.rules.deleteDirectiveLabel", {
              directive: directiveShort,
              site: siteIndex + 1,
            })}
            disabled
            title={definition.requiredReason ? t(definition.requiredReason) : undefined}
          >
            <TrashIcon />
          </Button>
        ) : (
          <Button
            variant="ghost"
            aria-label={t("caddy.rules.deleteDirectiveLabel", {
              directive: directiveShort,
              site: siteIndex + 1,
            })}
            onClick={remove}
          >
            {t("caddy.rules.deleteDirective", { directive: directiveShort })}
          </Button>
        )}
      </div>
    </li>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={12}
      width={12}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 12 12"
    >
      <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5l.5-7" />
    </svg>
  );
}

interface DirectiveValueProps {
  site: SiteDraft;
  siteIndex: number;
  row: DirectiveRow;
  upstreamIndex: number;
  feedback: (key: string) => FieldFeedback;
  tlsStatus: CaddyTlsSiteStatus | undefined;
  onSite: (next: SiteDraft) => void;
  onPickTlsFile: (slot: TlsSlot) => void;
}

function DirectiveValue({
  site,
  siteIndex,
  row,
  upstreamIndex,
  feedback,
  tlsStatus,
  onSite,
  onPickTlsFile,
}: DirectiveValueProps) {
  const copy = useCaddyCopy();
  const { t } = copy;
  switch (DIRECTIVES[row.id].control) {
    case "host": {
      const listenHost = feedback(siteFieldKey(siteIndex, "listen.host"));
      return (
        <TextField
          label={t("caddy.directive.listenHost")}
          name={`site-${site.key}-host`}
          value={site.host}
          error={listenHost.error}
          description={listenHost.warning}
          onValueChange={(host) => onSite({ ...site, host })}
        />
      );
    }
    case "port": {
      const listenPort = feedback(siteFieldKey(siteIndex, "listen.port"));
      return (
        <TextField
          label={t("caddy.directive.listenPort")}
          name={`site-${site.key}-port`}
          inputMode="numeric"
          value={site.port}
          error={listenPort.error}
          description={listenPort.warning}
          onValueChange={(port) => onSite({ ...site, port })}
        />
      );
    }
    case "upstream": {
      const upstream = site.upstreams[upstreamIndex];
      if (upstream === undefined) return null;
      const upstreamHost = feedback(upstreamFieldKey(siteIndex, upstreamIndex, "host"));
      const upstreamPort = feedback(upstreamFieldKey(siteIndex, upstreamIndex, "port"));
      const replaceUpstream = (next: UpstreamDraft) =>
        onSite({
          ...site,
          upstreams: site.upstreams.map((entry, position) => (position === upstreamIndex ? next : entry)),
        });
      return (
        <div className="grid gap-ui-8 sm:grid-cols-3">
          <SelectField
            label={t("caddy.rules.upstreamScheme")}
            name={`upstream-${upstream.key}-scheme`}
            options={SCHEME_OPTIONS}
            value={upstream.scheme}
            onValueChange={(scheme) => replaceUpstream({ ...upstream, scheme })}
          />
          <TextField
            label={t("caddy.rules.upstreamHost")}
            name={`upstream-${upstream.key}-host`}
            value={upstream.host}
            error={upstreamHost.error}
            description={upstreamHost.warning}
            onValueChange={(host) => replaceUpstream({ ...upstream, host })}
          />
          <TextField
            label={t("caddy.rules.upstreamPort")}
            name={`upstream-${upstream.key}-port`}
            inputMode="numeric"
            value={upstream.port}
            error={upstreamPort.error}
            description={upstreamPort.warning}
            onValueChange={(port) => replaceUpstream({ ...upstream, port })}
          />
        </div>
      );
    }
    case "file-pair": {
      if (site.tls === null) return null;
      const tlsError = feedback(siteTlsKey(siteIndex)).error;
      return (
        <div className="grid gap-ui-8">
          <FileRow
            label={t("caddy.rules.certificateFile")}
            buttonLabel={t("caddy.rules.chooseCertificate")}
            line={tlsFileLine("certificate", site.tls.certificateGrantId, tlsStatus, copy)}
            onPick={() => onPickTlsFile("certificate")}
          />
          <FileRow
            label={t("caddy.rules.privateKeyFile")}
            buttonLabel={t("caddy.rules.choosePrivateKey")}
            line={tlsFileLine("privateKey", site.tls.privateKeyGrantId, tlsStatus, copy)}
            onPick={() => onPickTlsFile("privateKey")}
          />
          <p className="m-0 text-aux text-muted-foreground">{t(TLS_FILES_NOTICE_KEY)}</p>
          {tlsError ? (
            <p role="alert" className="m-0 text-aux text-danger">
              {tlsError}
            </p>
          ) : null}
        </div>
      );
    }
    case "switch":
      return (
        <div className="grid gap-ui-8">
          <SwitchField
            label={t(DIRECTIVES[row.id].label)}
            name={`site-${site.key}-access-log`}
            checked
            onCheckedChange={(enabled) => {
              if (!enabled) onSite(removeDirectiveRow(site, row));
            }}
          />
          <p role="note" className="m-0 text-aux text-muted-foreground">
            {t(ACCESS_LOG_PRIVACY_KEY)}
          </p>
        </div>
      );
  }
}

function AddDirectiveGroup({
  site,
  ids,
  onSite,
}: {
  site: SiteDraft;
  ids: IdSource;
  onSite: (next: SiteDraft) => void;
}) {
  const { t } = useCaddyCopy();
  return (
    <div role="group" aria-label={t("caddy.rules.addDirective")} className="grid gap-ui-8">
      <span className="text-sm font-medium">{t("caddy.rules.addDirective")}</span>
      <div className="flex flex-wrap gap-ui-8">
        {addableDirectives(site).map((id) => (
          <Button
            key={id}
            size="sm"
            variant="default"
            disabled={!canAddDirective(site, id)}
            onClick={() => onSite(addDirective(site, id, ids))}
          >
            {t(DIRECTIVES[id].label)}
          </Button>
        ))}
      </div>
      {site.accessLog ? null : (
        <p role="note" className="m-0 text-aux text-muted-foreground">
          {t(ACCESS_LOG_PRIVACY_KEY)}
        </p>
      )}
    </div>
  );
}

function FileRow({
  label,
  buttonLabel,
  line,
  onPick,
}: {
  label: string;
  buttonLabel: string;
  line: TlsFileLine;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-ui-8">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-aux text-muted-foreground">
        {line.symbol} {line.text}
      </span>
      <Button variant="default" onClick={onPick}>
        {buttonLabel}
      </Button>
    </div>
  );
}
