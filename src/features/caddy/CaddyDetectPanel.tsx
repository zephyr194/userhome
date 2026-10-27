import { Button, StatusBadge } from "../../components/ui";
import type { CaddyDetectReport } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { localizeError } from "../../i18n/errors";
import { useCaddyCopy, type CaddyCopy } from "./caddyCopy";
import { candidateOutcomeText } from "./caddyRulesModel";

export type DetectState =
  | { status: "loading" }
  | { status: "ready"; report: CaddyDetectReport }
  | { status: "failed"; error: AppError };

interface CaddyDetectPanelProps {
  state: DetectState;
  onRetry: () => void;
}

export function CaddyDetectPanel({ state, onRetry }: CaddyDetectPanelProps) {
  const copy = useCaddyCopy();
  const { t } = copy;
  return (
    <section aria-labelledby="caddy-detect-heading" className="caddy-status__cell grid min-w-0 content-start gap-ui-4">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <h2 id="caddy-detect-heading" className="text-sm font-semibold">
          {t("caddy.detect.heading")}
        </h2>
        <DetectSummary state={state} />
        <Button variant="default" disabled={state.status === "loading"} onClick={onRetry}>
          {t("caddy.detect.recheck")}
        </Button>
      </div>
      <p className="caddy-status__line m-0 min-w-0 text-aux text-muted-foreground">
        <DetectLine state={state} copy={copy} />
      </p>
      <p className="m-0 text-aux text-muted-foreground">
        {t("caddy.detect.disclaimer")}
      </p>
      <details className="text-aux">
        <summary className="cursor-pointer text-muted-foreground">{t("caddy.detect.details")}</summary>
        <div className="mt-ui-4 grid gap-ui-8">
          {state.status === "ready" ? <CandidateList report={state.report} copy={copy} /> : null}
        </div>
      </details>
    </section>
  );
}

function DetectSummary({ state }: { state: DetectState }) {
  const { t } = useCaddyCopy();
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("caddy.detect.checking")}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        {t("caddy.detect.failed")}
      </p>
    );
  }
  const { report } = state;
  if (report.status === "AVAILABLE") {
    return (
      <>
        <StatusBadge tone="success">{t("caddy.detect.found")}</StatusBadge>
        <span className="min-w-0 truncate font-mono text-aux" title={report.version}>
          {report.version}
        </span>
      </>
    );
  }
  return (
    <StatusBadge tone={report.status === "MISSING" ? "warning" : "danger"}>
      {report.status === "MISSING" ? t("caddy.detect.missing") : t("caddy.detect.unavailable")}
    </StatusBadge>
  );
}

function DetectLine({ state, copy }: { state: DetectState; copy: CaddyCopy }) {
  if (state.status === "loading") return <>{copy.t("caddy.detect.pending")}</>;
  if (state.status === "failed") {
    return <>{localizeError(state.error, copy.locale)}</>;
  }
  const { report } = state;
  if (report.status === "AVAILABLE") {
    return (
      <span className="block truncate font-mono text-foreground" title={report.executablePath}>
        {report.executablePath}
      </span>
    );
  }
  return <>{report.guidance}</>;
}

function CandidateList({ report, copy }: { report: CaddyDetectReport; copy: CaddyCopy }) {
  return (
    <ul aria-label={copy.t("caddy.detect.locations")} className="m-0 grid gap-ui-4 pl-ui-8 text-aux">
      {report.candidates.map((candidate) => (
        <li key={`${candidate.source}:${candidate.displayPath}`} className="break-all">
          <span className="font-mono">{candidate.displayPath}</span>
          {copy.t("caddy.detect.separator")}
          {candidateOutcomeText(candidate.outcome, copy)}
        </li>
      ))}
    </ul>
  );
}
