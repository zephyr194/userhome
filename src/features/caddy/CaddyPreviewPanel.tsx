import { CodeViewer, Panel } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import { localizeError } from "../../i18n/errors";
import type { CaddyExposure, CaddyExposureReason, CaddyIssue } from "../../ipc/caddy";
import { useCaddyCopy, type CaddyCopy } from "./caddyCopy";
import {
  diffMarker,
  externalExposures,
  type PreviewState,
} from "./caddyRulesModel";

interface CaddyPreviewPanelProps {
  localValid: boolean;
  preview: PreviewState;
  exposures: CaddyExposure[];
}

const EXPOSURE_REASON_KEY: Record<CaddyExposureReason, MessageKey> = {
  LOOPBACK: "caddy.preview.exposure.loopback",
  ALL_INTERFACES: "caddy.preview.exposure.allInterfaces",
  NON_LOOPBACK_ADDRESS: "caddy.preview.exposure.nonLoopback",
  HOST_NAME: "caddy.preview.exposure.hostName",
};

const DIFF_CLASSES = {
  ADDED: "bg-success-soft text-success",
  REMOVED: "bg-danger-soft text-danger",
  UNCHANGED: "text-muted-foreground",
} as const;

function issueLocation(issue: CaddyIssue, copy: CaddyCopy): string {
  const parts: string[] = [];
  if (issue.site !== undefined) parts.push(copy.t("caddy.preview.location.site", { site: issue.site + 1 }));
  if (issue.upstream !== undefined) {
    parts.push(copy.t("caddy.preview.location.upstream", { upstream: issue.upstream + 1 }));
  }
  return parts.length > 0 ? parts.join(" · ") : copy.t("caddy.preview.location.rules");
}

export function CaddyPreviewPanel({ localValid, preview, exposures }: CaddyPreviewPanelProps) {
  const copy = useCaddyCopy();
  return (
    <Panel aria-labelledby="caddy-preview-heading" className="grid min-w-0 gap-ui-8 p-ui-8">
      <h2 id="caddy-preview-heading" className="text-sm font-semibold">
        {copy.t("caddy.preview.heading")}
      </h2>
      <PreviewBody localValid={localValid} preview={preview} exposures={exposures} copy={copy} />
    </Panel>
  );
}

function PreviewBody({
  localValid,
  preview,
  exposures,
  copy,
}: CaddyPreviewPanelProps & { copy: CaddyCopy }) {
  const { t } = copy;
  if (!localValid) {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("caddy.preview.needsFix")}
      </p>
    );
  }
  if (preview.status === "pending") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("caddy.preview.pending")}
      </p>
    );
  }
  if (preview.status === "failed") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        {t("caddy.preview.failed", { error: localizeError(preview.error, copy.locale) })}
      </p>
    );
  }
  const result = preview.preview;
  if (!result.valid) {
    return (
      <div className="grid gap-ui-8">
        <p role="alert" className="m-0 text-body font-semibold text-danger">
          {t("caddy.preview.invalid")}
        </p>
        <ul className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
          {result.validation.issues.map((issue) => (
            <li key={`${issueLocation(issue, copy)}:${issue.code}:${issue.message}`}>
              {t("caddy.preview.locationMessage", {
                location: issueLocation(issue, copy),
                message: issue.message,
              })}
            </li>
          ))}
          {result.validation.conflicts.map((conflict) => (
            <li key={`conflict:${conflict.listen}`}>
              {t("caddy.preview.conflict", {
                listen: conflict.listen,
                sites: conflict.sites
                  .map((site) => t("caddy.preview.location.site", { site: site + 1 }))
                  .join(t("caddy.preview.listSeparator")),
              })}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const exposed = externalExposures(exposures);
  return (
    <div className="grid min-w-0 gap-ui-8">
      {exposed.length > 0 ? (
        <section
          aria-labelledby="caddy-exposure-heading"
          className="grid gap-ui-4 rounded-panel bg-warning-soft p-ui-8 text-warning"
        >
          <h3 id="caddy-exposure-heading" className="m-0 text-sm font-semibold">
            {t("caddy.preview.exposedHeading")}
          </h3>
          <p className="m-0 text-aux">{t("caddy.preview.exposedNote")}</p>
          <ul className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
            {exposed.map((exposure) => (
              <li key={`${exposure.site}:${exposure.listen}`}>
                {t("caddy.preview.exposureSiteListen", { site: exposure.site + 1 })}
                <span className="font-mono">{exposure.listen}</span>
                {t("caddy.preview.exposureReason", { reason: t(EXPOSURE_REASON_KEY[exposure.reason]) })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.validation.issues.length > 0 ? (
        <ul aria-label={t("caddy.preview.issuesLabel")} className="m-0 grid gap-ui-4 pl-ui-8 text-aux text-warning">
          {result.validation.issues.map((issue) => (
            <li key={`${issueLocation(issue, copy)}:${issue.code}`}>
              {t("caddy.preview.locationMessage", {
                location: issueLocation(issue, copy),
                message: issue.message,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        {result.hasSavedVersion ? t("caddy.preview.savedDiff") : t("caddy.preview.noSavedVersion")}
      </p>
      <ol aria-label={t("caddy.preview.diffLabel")} className="m-0 grid min-w-0 list-none gap-0 p-0 font-mono text-aux">
        {(result.diff ?? []).map((line, index) => {
          const marker = diffMarker(line.change, copy);
          return (
            <li
              key={index}
              className={`flex min-w-0 gap-ui-8 px-ui-4 ${DIFF_CLASSES[line.change]}`}
            >
              <span aria-hidden="true" className="inline-block w-4 shrink-0 select-none text-center">
                {marker.symbol}
              </span>
              <span className="sr-only">{t("caddy.preview.markerLabel", { label: marker.label })}</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">{line.text}</span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-ui-4">
        <h3 className="m-0 text-sm font-semibold">{t("caddy.preview.generatedHeading")}</h3>
        <CodeViewer
          label={t("caddy.preview.generatedHeading")}
          language="caddyfile"
          scrollClassName="max-h-72 overflow-y-auto"
          text={result.generatedText ?? ""}
          title="Caddyfile"
        />
      </div>
    </div>
  );
}
