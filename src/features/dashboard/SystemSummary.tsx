import { StatusBadge } from "../../components/ui";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { formatNumber } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type {
  DetectionEvidence,
  DetectionStatus,
  SystemSummary as SystemSummaryData,
} from "../../ipc/discovery";

function evidenceLabel(evidence: DetectionEvidence, t: TranslateFunction): string {
  if (evidence.kind === "CONFIG_PRESENT") {
    return evidence.present
      ? t("dashboard.evidence.configPresent")
      : t("dashboard.evidence.configMissing");
  }
  return evidence.present
    ? t("dashboard.evidence.commandAvailable")
    : t("dashboard.evidence.commandMissing");
}

const APPLICATION_STATUS: Record<
  DetectionStatus,
  { labelKey: MessageKey; tone: "neutral" | "success" | "warning" }
> = {
  DETECTED: { labelKey: "dashboard.applicationStatus.detected", tone: "success" },
  PARTIAL: { labelKey: "dashboard.applicationStatus.partial", tone: "warning" },
  ABSENT: { labelKey: "dashboard.applicationStatus.absent", tone: "neutral" },
};

function PresenceIcon({ present }: { present: boolean }) {
  return present ? (
    <svg
      className="size-3.5 shrink-0 text-success"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8 3 3 7-7" />
    </svg>
  ) : (
    <svg
      className="size-3.5 shrink-0 text-muted-foreground"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4 4 12" />
    </svg>
  );
}

export function SystemSummary({ summary }: { summary: SystemSummaryData }) {
  const t = useT();
  const locale = useLocale();
  const unavailable = t("dashboard.value.unavailable");
  const detected = summary.applications.filter(
    (application) => application.status !== "ABSENT",
  );
  const fullyDetected = summary.applications.filter(
    (application) => application.status === "DETECTED",
  ).length;
  const partial = summary.applications.filter(
    (application) => application.status === "PARTIAL",
  ).length;

  return (
    <div className="dashboard-system-summary">
      <section aria-labelledby="machine-summary-heading">
        <header className="dashboard-subgroup-heading">
          <div className="min-w-0">
            <h4 id="machine-summary-heading">{t("dashboard.machine.heading")}</h4>
            <p>{t("dashboard.machine.caption")}</p>
          </div>
          <StatusBadge
            className="shrink-0"
            tone={summary.completeness === "COMPLETE" ? "success" : "warning"}
          >
            {summary.completeness === "COMPLETE"
              ? t("dashboard.system.complete")
              : t("dashboard.system.partial")}
          </StatusBadge>
        </header>

        <dl className="dashboard-machine-rows">
          <div>
            <dt>macOS</dt>
            <dd>{summary.osVersion ?? unavailable}</dd>
          </div>
          <div>
            <dt>{t("dashboard.system.architecture")}</dt>
            <dd>{summary.architecture ?? unavailable}</dd>
          </div>
          <div>
            <dt>{t("dashboard.machine.homeDirectory")}</dt>
            <dd>{summary.homeDirectory}</dd>
          </div>
          <div>
            <dt>{t("dashboard.system.loginShell")}</dt>
            <dd>{summary.shell ?? unavailable}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="applications-summary-heading">
        <header className="dashboard-subgroup-heading">
          <div className="min-w-0">
            <h4 id="applications-summary-heading">{t("dashboard.applications.heading")}</h4>
            <p>
              {t("dashboard.applications.identified", {
                detected: formatNumber(detected.length, locale),
                total: formatNumber(summary.applications.length, locale),
              })}
            </p>
          </div>
        </header>

        {summary.applications.length === 0 ? (
          <div
            className="flex min-w-0 items-start gap-ui-8 border-t border-border pt-ui-8"
            role="status"
          >
            <PresenceIcon present={false} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
                <strong className="min-w-0 text-xs">{t("dashboard.applications.emptyTitle")}</strong>
                <StatusBadge className="shrink-0">{t("dashboard.applications.noData")}</StatusBadge>
              </div>
              <p className="mt-ui-4 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                {t("dashboard.applications.emptyBody")}
              </p>
            </div>
          </div>
        ) : (
          <details className="dashboard-applications">
            <summary>
              <span>{t("dashboard.applications.showEvidence")}</span>
              <span className="dashboard-counts">
                {t("dashboard.applications.fullCount")} <strong>{formatNumber(fullyDetected, locale)}</strong>
                <span aria-hidden="true">·</span>
                {t("dashboard.applications.partialCount")} <strong>{formatNumber(partial, locale)}</strong>
              </span>
            </summary>
            <ul className="dashboard-application-rows">
              {summary.applications.map((application) => (
                <li key={application.appId}>
                  <div className="dashboard-application-row__heading flex-wrap">
                    <strong
                      className="min-w-0 break-words"
                      title={application.displayName}
                    >
                      {application.displayName}
                    </strong>
                    <StatusBadge
                      className="shrink-0"
                      tone={APPLICATION_STATUS[application.status].tone}
                    >
                      {t(APPLICATION_STATUS[application.status].labelKey)}
                    </StatusBadge>
                  </div>
                  {application.evidence.length === 0 ? (
                    <p className="mt-ui-4 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                      {t("dashboard.applications.noEvidence")}
                    </p>
                  ) : (
                    <ul>
                      {application.evidence.map((evidence) => (
                        <li key={`${evidence.kind}-${evidence.label}`}>
                          <PresenceIcon present={evidence.present} />
                          <span className="min-w-0 break-words">
                            <strong>{evidenceLabel(evidence, t)}</strong>
                            {t("dashboard.separator.colon")}
                            {evidence.path?.displayPath ?? evidence.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
