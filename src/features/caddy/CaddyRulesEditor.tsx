import {
  Button,
  SelectField,
  StatusBadge,
  SwitchField,
  TextField,
  type SelectOption,
} from "../../components/ui";
import type { CaddyUpstreamScheme } from "../../ipc/caddy";
import {
  MAX_DRAFT_SITES,
  MAX_DRAFT_UPSTREAMS,
  feedbackForField,
  newSiteDraft,
  newUpstreamDraft,
  siteFieldKey,
  upstreamFieldKey,
  type IdSource,
  type MappedIssues,
  type SiteDraft,
  type UpstreamDraft,
} from "./caddyRulesModel";

const SCHEME_OPTIONS: readonly SelectOption<CaddyUpstreamScheme>[] = [
  { value: "http", label: "http" },
  { value: "https", label: "https" },
];

interface CaddyRulesEditorProps {
  sites: SiteDraft[];
  localErrors: Record<string, string>;
  mapped: MappedIssues;
  exposedSites: ReadonlySet<number>;
  ids: IdSource;
  onChange: (next: SiteDraft[]) => void;
}

export function CaddyRulesEditor({
  sites,
  localErrors,
  mapped,
  exposedSites,
  ids,
  onChange,
}: CaddyRulesEditorProps) {
  const feedback = (key: string) => feedbackForField(key, mapped, localErrors);

  function replaceSite(index: number, next: SiteDraft) {
    onChange(sites.map((site, position) => (position === index ? next : site)));
  }

  return (
    <section aria-labelledby="caddy-rules-heading" className="grid min-w-0 gap-ui-md">
      <div className="flex flex-wrap items-center justify-between gap-ui-sm">
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
        const listenHost = feedback(siteFieldKey(siteIndex, "listen.host"));
        const listenPort = feedback(siteFieldKey(siteIndex, "listen.port"));
        const upstreamList = feedback(siteFieldKey(siteIndex, "upstreams"));
        return (
          <fieldset
            key={site.key}
            className="grid min-w-0 gap-ui-md rounded-panel bg-surface-muted p-ui-lg"
          >
            <legend className="px-ui-xs text-sm font-semibold">站点 {siteIndex + 1}</legend>
            <div className="flex flex-wrap items-center gap-ui-md">
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
            </div>
            <div className="grid gap-ui-md sm:grid-cols-2">
              <TextField
                label="监听主机"
                name={`site-${site.key}-host`}
                value={site.host}
                error={listenHost.error}
                description={listenHost.warning}
                onValueChange={(host) => replaceSite(siteIndex, { ...site, host })}
              />
              <TextField
                label="监听端口"
                name={`site-${site.key}-port`}
                inputMode="numeric"
                value={site.port}
                error={listenPort.error}
                description={listenPort.warning}
                onValueChange={(port) => replaceSite(siteIndex, { ...site, port })}
              />
            </div>
            <div className="grid gap-ui-sm">
              <h3 className="m-0 text-sm font-semibold">上游（反向代理目标）</h3>
              <ol className="m-0 grid list-none gap-ui-md p-0">
                {site.upstreams.map((upstream, upstreamIndex) => {
                  const upstreamHost = feedback(upstreamFieldKey(siteIndex, upstreamIndex, "host"));
                  const upstreamPort = feedback(upstreamFieldKey(siteIndex, upstreamIndex, "port"));
                  return (
                    <li
                      key={upstream.key}
                      className="grid min-w-0 gap-ui-sm rounded-control bg-surface p-ui-md"
                    >
                      <div className="grid gap-ui-md sm:grid-cols-3">
                        <SelectField
                          label="上游协议"
                          name={`upstream-${upstream.key}-scheme`}
                          options={SCHEME_OPTIONS}
                          value={upstream.scheme}
                          onValueChange={(scheme) =>
                            replaceUpstream(siteIndex, site, upstreamIndex, { ...upstream, scheme }, replaceSite)
                          }
                        />
                        <TextField
                          label="上游主机"
                          name={`upstream-${upstream.key}-host`}
                          value={upstream.host}
                          error={upstreamHost.error}
                          description={upstreamHost.warning}
                          onValueChange={(host) =>
                            replaceUpstream(siteIndex, site, upstreamIndex, { ...upstream, host }, replaceSite)
                          }
                        />
                        <TextField
                          label="上游端口"
                          name={`upstream-${upstream.key}-port`}
                          inputMode="numeric"
                          value={upstream.port}
                          error={upstreamPort.error}
                          description={upstreamPort.warning}
                          onValueChange={(port) =>
                            replaceUpstream(siteIndex, site, upstreamIndex, { ...upstream, port }, replaceSite)
                          }
                        />
                      </div>
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`删除上游 ${upstreamIndex + 1}（站点 ${siteIndex + 1}）`}
                          disabled={site.upstreams.length <= 1}
                          onClick={() =>
                            replaceSite(siteIndex, {
                              ...site,
                              upstreams: site.upstreams.filter((_, position) => position !== upstreamIndex),
                            })
                          }
                        >
                          删除上游
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {upstreamList.error ? (
                <p role="alert" className="m-0 text-aux text-danger">
                  {upstreamList.error}
                </p>
              ) : null}
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={site.upstreams.length >= MAX_DRAFT_UPSTREAMS}
                  onClick={() =>
                    replaceSite(siteIndex, {
                      ...site,
                      upstreams: [...site.upstreams, newUpstreamDraft(ids)],
                    })
                  }
                >
                  添加上游
                </Button>
              </div>
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}

function replaceUpstream(
  siteIndex: number,
  site: SiteDraft,
  upstreamIndex: number,
  next: UpstreamDraft,
  replaceSite: (index: number, site: SiteDraft) => void,
) {
  replaceSite(siteIndex, {
    ...site,
    upstreams: site.upstreams.map((upstream, position) =>
      position === upstreamIndex ? next : upstream,
    ),
  });
}
