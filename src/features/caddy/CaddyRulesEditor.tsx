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
import {
  ACCESS_LOG_PRIVACY_NOTICE,
  MAX_DRAFT_SITES,
  TLS_FILES_NOTICE,
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
  const feedback = (key: string) => feedbackForField(key, mapped, localErrors);

  function replaceSite(index: number, next: SiteDraft) {
    onChange(sites.map((site, position) => (position === index ? next : site)));
  }

  return (
    <section aria-labelledby="caddy-rules-heading" className="grid min-w-0 gap-ui-8">
      <div className="flex flex-wrap items-center justify-between gap-ui-8">
        <h2 id="caddy-rules-heading" className="text-sm font-semibold">
          代理规则
        </h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={sites.length >= MAX_DRAFT_SITES}
          onClick={() => onChange([...sites, newSiteDraft(ids)])}
        >
          新增站点
        </Button>
      </div>
      {mapped.general.map((issue) => (
        <p key={`${issue.code}:${issue.message}`} role="alert" className="m-0 text-aux text-danger">
          {issue.message}
        </p>
      ))}
      {sites.length === 0 ? (
        <p className="m-0 text-body text-muted-foreground">没有站点规则。新增站点后才能生成 Caddyfile。</p>
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
              <h3 id={`caddy-site-${site.key}-heading`} className="text-sm font-semibold">
                站点 {siteIndex + 1}
              </h3>
              <ActionRow align="end">
                <SwitchField
                  label="启用此站点"
                  name={`site-${site.key}-enabled`}
                  checked={site.enabled}
                  onCheckedChange={(enabled) => replaceSite(siteIndex, { ...site, enabled })}
                />
                {exposedSites.has(siteIndex) ? (
                  <StatusBadge tone="warning">对外可见</StatusBadge>
                ) : null}
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`删除站点 ${siteIndex + 1}`}
                  onClick={() => onChange(sites.filter((_, position) => position !== siteIndex))}
                >
                  删除站点
                </Button>
              </ActionRow>
            </div>
            <ol className="m-0 grid list-none gap-ui-8 p-0">
              {directiveRows(site).map((row) => (
                <DirectiveRowView
                  key={row.rowKey}
                  site={site}
                  siteIndex={siteIndex}
                  row={row}
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
  ids,
  feedback,
  tlsStatus,
  onSite,
  onPickTlsFile,
}: DirectiveRowViewProps) {
  const definition = DIRECTIVES[row.id];
  const required = isRequiredRow(site, row);
  const upstreamIndex = site.upstreams.findIndex((upstream) => upstream.key === row.upstreamKey);
  const options: SelectOption<DirectiveId>[] = rowDirectiveOptions(site, row).map((id) => ({
    value: id,
    label: DIRECTIVES[id].label,
  }));
  const remove = () => onSite(removeDirectiveRow(site, row));

  return (
    <li className="flex min-w-0 flex-wrap items-start gap-ui-8 rounded-control bg-surface p-ui-8">
      <div className="min-w-28">
        <SelectField
          label="指令"
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
      <div className="flex flex-col items-end gap-ui-8">
        {row.id === "upstream" ? (
          <Button
            variant="ghost"
            aria-label={`删除上游 ${upstreamIndex + 1}（站点 ${siteIndex + 1}）`}
            disabled={required}
            onClick={remove}
          >
            删除上游
          </Button>
        ) : (
          <Button
            variant="ghost"
            aria-label={`删除${definition.short}（站点 ${siteIndex + 1}）`}
            disabled={required}
            onClick={remove}
          >
            {`删除${definition.short}`}
          </Button>
        )}
        {required ? (
          <span className="text-aux text-muted-foreground">{definition.requiredReason}</span>
        ) : null}
      </div>
    </li>
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
  switch (DIRECTIVES[row.id].control) {
    case "host": {
      const listenHost = feedback(siteFieldKey(siteIndex, "listen.host"));
      return (
        <TextField
          label="监听主机"
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
          label="监听端口"
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
            label="上游协议"
            name={`upstream-${upstream.key}-scheme`}
            options={SCHEME_OPTIONS}
            value={upstream.scheme}
            onValueChange={(scheme) => replaceUpstream({ ...upstream, scheme })}
          />
          <TextField
            label="上游主机"
            name={`upstream-${upstream.key}-host`}
            value={upstream.host}
            error={upstreamHost.error}
            description={upstreamHost.warning}
            onValueChange={(host) => replaceUpstream({ ...upstream, host })}
          />
          <TextField
            label="上游端口"
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
            label="证书文件"
            buttonLabel="选择证书文件"
            line={tlsFileLine("certificate", site.tls.certificateGrantId, tlsStatus)}
            onPick={() => onPickTlsFile("certificate")}
          />
          <FileRow
            label="私钥文件"
            buttonLabel="选择私钥文件"
            line={tlsFileLine("privateKey", site.tls.privateKeyGrantId, tlsStatus)}
            onPick={() => onPickTlsFile("privateKey")}
          />
          <p className="m-0 text-aux text-muted-foreground">{TLS_FILES_NOTICE}</p>
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
            label={DIRECTIVES[row.id].label}
            name={`site-${site.key}-access-log`}
            checked
            onCheckedChange={(enabled) => {
              if (!enabled) onSite(removeDirectiveRow(site, row));
            }}
          />
          <p role="note" className="m-0 text-aux text-muted-foreground">
            {ACCESS_LOG_PRIVACY_NOTICE}
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
  return (
    <div role="group" aria-label="添加指令" className="grid gap-ui-8">
      <span className="text-sm font-medium">添加指令</span>
      <div className="flex flex-wrap gap-ui-8">
        {addableDirectives(site).map((id) => (
          <Button
            key={id}
            size="sm"
            variant="secondary"
            disabled={!canAddDirective(site, id)}
            onClick={() => onSite(addDirective(site, id, ids))}
          >
            {DIRECTIVES[id].label}
          </Button>
        ))}
      </div>
      {site.accessLog ? null : (
        <p role="note" className="m-0 text-aux text-muted-foreground">
          {ACCESS_LOG_PRIVACY_NOTICE}
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
      <Button variant="secondary" onClick={onPick}>
        {buttonLabel}
      </Button>
    </div>
  );
}
