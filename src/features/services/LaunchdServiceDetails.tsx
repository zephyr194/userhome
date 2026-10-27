import type { ReactNode } from "react";
import { Panel, StatusBadge } from "../../components/ui";
import type { MessageKey, TranslateFunction } from "../../i18n";
import { useT } from "../../i18n/useLocale";
import type {
  LaunchdConfigFile,
  LaunchdService,
  LaunchdSourceReport,
} from "../../ipc/services";
import { isHomebrewLabel } from "./launchdModel";
import {
  correlationText,
  domainLabel,
  evidenceFor,
  exitText,
  fileKindText,
  issueText,
  keepAliveText,
  linkStateText,
  ownershipSummary,
  parseStatusText,
  scopeLabel,
  sourceLabel,
  sourceProblems,
  sourceReasonText,
  sourceStatusLabel,
  statusPresentation,
  type EvidenceState,
} from "./launchdModel";

const WRAP = "break-words [overflow-wrap:anywhere]";

const LABEL_SOURCE_KEYS: Record<LaunchdService["labelSource"], MessageKey> = {
  LAUNCHCTL: "services.labelSource.launchctl",
  PLIST: "services.labelSource.plist",
  FILE_NAME: "services.labelSource.fileName",
};

function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0 bg-surface-muted px-ui-12 py-ui-8">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-ui-4 text-sm font-medium ${WRAP}`}>{children}</dd>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="border-b border-border px-ui-16 py-ui-12 last:border-b-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-ui-8 grid min-w-0 gap-ui-8">{children}</div>
    </section>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className={`font-mono text-xs ${WRAP}`}>{children}</span>;
}

function yesNo(value: boolean | undefined, t: TranslateFunction): string {
  if (value === undefined) return t("services.details.notSet");
  return value ? t("services.details.yes") : t("services.details.no");
}

function ConfigFileSection({ file }: { file: LaunchdConfigFile }) {
  const t = useT();
  const plist = file.details;
  const [first, ...rest] = plist?.programArguments ?? [];
  return (
    <div className="min-w-0 rounded-control bg-surface-muted px-ui-8 py-ui-8">
      <p className={`text-sm font-medium ${WRAP}`}>
        <Mono>{file.path}</Mono>
      </p>
      <dl className="mt-ui-8 grid min-w-0 gap-ui-8 text-xs">
        <Row label={t("services.details.directory")}>{sourceLabel(file.directory, t)}</Row>
        <Row label={t("services.details.scopeByDirectory")}>
          {scopeLabel(file.scope, t)}
          {file.isApplePath ? t("services.details.applePathSuffix") : ""}
        </Row>
        <Row label={t("services.details.fileType")}>
          {fileKindText(file.kind, t)}
          {file.ownerUid === undefined
            ? ""
            : t("services.details.ownerUid", { uid: file.ownerUid })}
        </Row>
        {file.linkTarget ? (
          <Row label={t("services.details.linkTarget")}>
            {linkStateText(file.linkTarget.state, t)}
            {file.linkTarget.display ? (
              <>
                {t("services.details.linkTargetSeparator")}
                <Mono>{file.linkTarget.display}</Mono>
              </>
            ) : null}
          </Row>
        ) : null}
        <Row label={t("services.details.contentRead")}>{parseStatusText(file.parseStatus, t)}</Row>
        {plist ? (
          <>
            <Row label={t("services.details.executable")}>
              {plist.program ?? first ? (
                <Mono>{plist.program ?? first}</Mono>
              ) : (
                t("services.details.notSet")
              )}
            </Row>
            <Row label={t("services.details.arguments")}>
              {plist.programArguments.length === 0 ? (
                t("services.details.notSet")
              ) : (
                <ol className="grid min-w-0 gap-ui-4">
                  {(plist.program === undefined ? rest : plist.programArguments).map(
                    (argument, index) => (
                      <li key={`${index}-${argument}`}>
                        <Mono>{argument}</Mono>
                      </li>
                    ),
                  )}
                </ol>
              )}
              <span className="mt-ui-4 block text-xs font-normal text-muted-foreground">
                {t("services.details.maskedArguments")}
                {plist.argumentsTruncated ? t("services.details.argumentsTruncated") : ""}
              </span>
            </Row>
            <Row label={t("services.details.environment")}>
              {plist.environmentKeys.length === 0 ? (
                t("services.details.none")
              ) : (
                <span className="flex min-w-0 flex-wrap gap-ui-8">
                  {plist.environmentKeys.map((key) => (
                    <StatusBadge key={key}>
                      <Mono>{key}</Mono>
                    </StatusBadge>
                  ))}
                </span>
              )}
              <span className="mt-ui-4 block text-xs font-normal text-muted-foreground">
                {t("services.details.environmentNamesOnly")}
              </span>
            </Row>
            <Row label="RunAtLoad">{yesNo(plist.runAtLoad, t)}</Row>
            <Row label="KeepAlive">
              {plist.keepAlive ? (
                <>
                  {keepAliveText(plist.keepAlive.mode, t)}
                  {plist.keepAlive.conditions.length > 0 ? (
                    <span className="mt-ui-4 block font-mono text-xs font-normal">
                      {t("services.details.conditions")}
                      {plist.keepAlive.conditions.join(t("services.details.listJoiner"))}
                    </span>
                  ) : null}
                </>
              ) : (
                t("services.details.notSet")
              )}
            </Row>
            <Row label={t("services.details.stdout")}>
              {plist.standardOutPath ? (
                <Mono>{plist.standardOutPath}</Mono>
              ) : (
                t("services.details.notSet")
              )}
            </Row>
            <Row label={t("services.details.stderr")}>
              {plist.standardErrorPath ? (
                <Mono>{plist.standardErrorPath}</Mono>
              ) : (
                t("services.details.notSet")
              )}
            </Row>
            <Row label="Disabled">{yesNo(plist.disabled, t)}</Row>
            <Row label="UserName">{plist.userName ?? t("services.details.notSet")}</Row>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function SourcesSection({
  sources,
}: {
  sources: readonly LaunchdSourceReport[];
}) {
  const t = useT();
  return (
    <ul className="grid min-w-0 gap-ui-8" aria-label={t("services.details.sourcesList")}>
      {sources.map((report) => {
        const failed =
          report.status !== "COMPLETE" || report.failedFiles > 0;
        return (
          <li
            className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs"
            key={report.source}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <Mono>{sourceLabel(report.source, t)}</Mono>
              <StatusBadge tone={failed ? "warning" : "success"}>
                {sourceStatusLabel(report.status, t)}
              </StatusBadge>
              <span className="text-muted-foreground">
                {t("services.details.itemCount", { count: report.items })}
              </span>
            </span>
            {report.reason ? (
              <span className={`mt-ui-4 block text-muted-foreground ${WRAP}`}>
                {sourceReasonText(report.reason, t)}
              </span>
            ) : null}
            {report.failedFiles > 0 ? (
              <span className="mt-ui-4 block text-warning">
                {t("services.problem.failedFiles", { count: report.failedFiles })}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function LaunchdServiceDetails({
  evidence,
  service,
  sources,
}: {
  evidence: EvidenceState;
  service: LaunchdService;
  sources: readonly LaunchdSourceReport[];
}) {
  const t = useT();
  const status = statusPresentation(service, t);
  const ownership = ownershipSummary(service, t);
  const problems = sourceProblems(sources, t);
  const brew =
    evidence.status === "ready"
      ? evidenceFor(service, evidence.summaries)
      : undefined;

  return (
    <Panel className="min-w-0" aria-labelledby="service-details-heading">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12 border-b border-border px-ui-16 py-ui-12">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">
            {t("services.details.eyebrow")}
          </p>
          <h3
            className={`mt-ui-4 text-lg font-semibold ${WRAP}`}
            id="service-details-heading"
          >
            {service.label}
          </h3>
          <p className="mt-ui-4 break-all font-mono text-xs text-muted-foreground">
            {service.id}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-ui-8">
          <StatusBadge>{scopeLabel(service.scope, t)}</StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge>{ownership.label}</StatusBadge>
          <StatusBadge tone={ownership.modifiable ? "success" : "warning"}>
            {ownership.badge}
          </StatusBadge>
        </div>
      </header>

      <Section title={t("services.details.loadAndRun")}>
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label={t("services.details.state")}>{status.label}</Row>
          <Row label="PID">
            {service.pid === undefined ? t("services.details.none") : String(service.pid)}
          </Row>
          <Row label={t("services.details.lastExit")}>{exitText(service.lastExit, t)}</Row>
          <Row label={t("services.details.domain")}>
            {domainLabel(service.domain, t)}
            <span className="mt-ui-4 block">
              <Mono>{service.domainTarget}</Mono>
            </span>
          </Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {status.detail}
          {service.lastExit && service.lastExit.value !== 0
            ? t("services.details.nonZeroExitNote")
            : ""}
        </p>
      </Section>

      <Section title={t("services.details.ownershipSection")}>
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label={t("services.details.ownership")}>{ownership.label}</Row>
          <Row label={t("services.details.modifiability")}>{ownership.badge}</Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {ownership.description}
        </p>
        {ownership.reasons.length > 0 ? (
          <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
            <p className="font-semibold">{t("services.details.readOnlyReasons")}</p>
            <ul className="mt-ui-4 grid gap-ui-4" aria-label={t("services.details.readOnlyReasons")}>
              {ownership.reasons.map((reason) => (
                <li className={WRAP} key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
          <p className="font-semibold">{t("services.details.evidence")}</p>
          <ul className="mt-ui-4 grid gap-ui-4" aria-label={t("services.details.evidence")}>
            {ownership.evidence.map((item) => (
              <li className={WRAP} key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {ownership.note}
        </p>
      </Section>

      <Section title={t("services.details.sourcesSection")}>
        <dl className="grid min-w-0 gap-px overflow-hidden rounded-control bg-border sm:grid-cols-2">
          <Row label={t("services.details.scopeByDirectory")}>{scopeLabel(service.scope, t)}</Row>
          <Row label={t("services.details.labelSource")}>{t(LABEL_SOURCE_KEYS[service.labelSource])}</Row>
          <Row label={t("services.details.configState")}>{correlationText(service, t)}</Row>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("services.details.sourceNote")}
        </p>
        {service.issues.length > 0 ? (
          <ul
            className="grid gap-ui-4 rounded-control border border-warning-border bg-warning-soft px-ui-12 py-ui-8 text-xs text-warning"
            aria-label={t("services.details.issues")}
          >
            {service.issues.map((issue) => (
              <li key={issue}>{issueText(issue, t)}</li>
            ))}
          </ul>
        ) : null}
        {isHomebrewLabel(service.label) ? (
          <div className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs">
            <p className="font-semibold">{t("services.details.homebrewEvidence")}</p>
            {evidence.status === "loading" ? (
              <p className="mt-ui-4 text-muted-foreground">
                {t("services.details.homebrewLoading")}
              </p>
            ) : evidence.status === "unavailable" ? (
              <p className="mt-ui-4 text-warning" role="status">
                {t("services.details.homebrewUnavailable")}
              </p>
            ) : brew ? (
              <p className={`mt-ui-4 text-muted-foreground ${WRAP}`}>
                {t("services.details.homebrewFound", {
                  name: brew.displayName,
                  status: brew.status,
                  user: brew.user
                    ? t("services.details.homebrewUser", { user: brew.user })
                    : "",
                })}
              </p>
            ) : (
              <p className="mt-ui-4 text-muted-foreground">
                {t("services.details.homebrewMissing")}
              </p>
            )}
          </div>
        ) : null}
      </Section>

      <Section title={t("services.details.configSection", { count: service.configFiles.length })}>
        {service.configFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("services.details.noConfigFile")}
            {service.configPresence === "UNKNOWN"
              ? t("services.details.noConfigFileUnknown")
              : t("services.details.noConfigFileKnown")}
          </p>
        ) : (
          service.configFiles.map((file) => (
            <ConfigFileSection file={file} key={file.path} />
          ))
        )}
      </Section>

      <Section title={t("services.details.discoverySection")}>
        {problems.length > 0 ? (
          <p
            className="rounded-control border border-warning-border bg-warning-soft px-ui-12 py-ui-8 text-xs leading-relaxed text-warning"
            role="status"
          >
            {t("services.details.partialSources")}
          </p>
        ) : null}
        <SourcesSection sources={sources} />
      </Section>
    </Panel>
  );
}
