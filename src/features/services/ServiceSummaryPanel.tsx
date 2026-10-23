import { useState, type ReactNode } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { copyText } from "../../components/ui/clipboard";
import { useT } from "../../i18n/useLocale";
import type { LaunchdService } from "../../ipc/services";
import { LaunchdActionPanel } from "./LaunchdActionPanel";
import { isActionable } from "./launchdActionModel";
import { executionOf, primaryConfigFile, statusPresentation } from "./launchdModel";
import {
  INJECTOR_TITLE_KEYS,
  displayNameOf,
  injectorBasisOf,
  injectorOf,
  purposeOf,
  triggerOf,
} from "./serviceProfile";

const WRAP = "break-words [overflow-wrap:anywhere]";

export interface ServiceSummaryPanelProps {
  service: LaunchdService;
  /** Called after an action, so the list is read again. */
  onChanged?: () => void;
  /** Read-only log block for the job, supplied by the page. Absent means no log view. */
  renderLogs?: (service: LaunchdService) => ReactNode;
  /** Adoption and edit entries for the job, supplied by the page. */
  renderManagement?: (service: LaunchdService) => ReactNode;
}

interface CopyResult {
  path: string;
  ok: boolean;
}

export function ServiceSummaryPanel({
  service,
  onChanged,
  renderLogs,
  renderManagement,
}: ServiceSummaryPanelProps) {
  const t = useT();
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const execution = executionOf(service);
  const executable = execution?.executable;
  const trigger = triggerOf(service, t);
  const status = statusPresentation(service, t);
  const purpose = purposeOf(service, t);
  const logDetails = primaryConfigFile(service)?.details;
  const stdoutPath = logDetails?.standardOutPath;
  const stderrPath = logDetails?.standardErrorPath;
  const hasLogPaths = stdoutPath !== undefined || stderrPath !== undefined;

  async function copyPath(path: string) {
    setCopyResult({ path, ok: await copyText(path) });
  }

  return (
    <div className="grid min-w-0 gap-ui-16">
      <SummarySection id="services-summary-what" title={t("services.summary.what")}>
        <dl className="grid min-w-0 gap-ui-8">
          <Fact label={t("services.summary.name")}>{displayNameOf(service)}</Fact>
          <Fact label={t("services.summary.purpose")}>
            {purpose ?? (
              <span className="grid min-w-0 gap-ui-4">
                <span className="text-muted-foreground">{t("services.purposeUnknown")}</span>
                <span className={`font-mono text-xs text-muted-foreground ${WRAP}`}>
                  {executable ?? t("services.noProgramPath")}
                </span>
              </span>
            )}
          </Fact>
          <Fact label={t("services.summary.injector")}>
            <span className="grid min-w-0 gap-ui-4">
              <span>{t(INJECTOR_TITLE_KEYS[injectorOf(service)])}</span>
              <span className="text-xs text-muted-foreground">
                {injectorBasisOf(service, t)}
              </span>
            </span>
          </Fact>
        </dl>
      </SummarySection>

      <SummarySection id="services-summary-when" title={t("services.summary.when")}>
        <p className="text-sm leading-relaxed">{trigger.sentence}</p>
        <dl className="grid min-w-0 gap-ui-8">
          <Fact label={t("services.summary.runState")}>
            <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </span>
            <span className="mt-ui-4 block text-xs leading-relaxed text-muted-foreground">
              {status.detail}
            </span>
          </Fact>
          <Fact label={t("services.summary.pid")}>
            {service.pid === undefined ? t("services.summary.noPid") : String(service.pid)}
          </Fact>
        </dl>
        {isActionable(service) ? (
          <LaunchdActionPanel key={service.id} service={service} onChanged={onChanged} />
        ) : null}
      </SummarySection>

      <SummarySection id="services-summary-files" title={t("services.summary.files")}>
        {service.configFiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("services.summary.noConfigFile")}</p>
        ) : (
          <div className="grid min-w-0 gap-ui-12">
            {service.configFiles.map((file) => (
              <PathEntry
                key={file.path}
                label={t("services.summary.configFile")}
                path={file.path}
                result={copyResult}
                onCopy={copyPath}
              />
            ))}
          </div>
        )}
        {executable !== undefined ? (
          <div className="grid min-w-0 gap-ui-8">
            <PathEntry
              label={t("services.summary.program")}
              path={executable}
              result={copyResult}
              onCopy={copyPath}
            />
            {execution?.arguments.length ? (
              <ol className="grid min-w-0 gap-ui-4" aria-label={t("services.summary.arguments")}>
                {execution.arguments.map((argument, index) => (
                  <li className={`font-mono text-xs ${WRAP}`} key={`${index}-${argument}`}>
                    {argument}
                  </li>
                ))}
              </ol>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {t("services.summary.maskedArguments")}
            </span>
            {execution?.truncated ? (
              <span className="text-xs text-muted-foreground">
                {t("services.summary.argumentsTruncated")}
              </span>
            ) : null}
          </div>
        ) : null}
      </SummarySection>

      <SummarySection id="services-summary-logs" title={t("services.summary.logs")}>
        {hasLogPaths ? (
          <dl className="grid min-w-0 gap-ui-8">
            {stdoutPath !== undefined ? (
              <Fact label={t("services.summary.stdout")}>
                <span className={`font-mono text-xs ${WRAP}`}>{stdoutPath}</span>
              </Fact>
            ) : null}
            {stderrPath !== undefined ? (
              <Fact label={t("services.summary.stderr")}>
                <span className={`font-mono text-xs ${WRAP}`}>{stderrPath}</span>
              </Fact>
            ) : null}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{t("services.summary.noLogFile")}</p>
        )}
        {hasLogPaths && renderLogs ? (
          <div className="grid min-w-0 justify-items-start gap-ui-12">
            <Button size="sm" onClick={() => setLogsOpen((open) => !open)}>
              {logsOpen ? t("services.summary.hideLogs") : t("services.summary.viewLogs")}
            </Button>
            {logsOpen ? renderLogs(service) : null}
          </div>
        ) : null}
      </SummarySection>

      {renderManagement ? renderManagement(service) : null}
    </div>
  );
}

interface PathEntryProps {
  label: string;
  path: string;
  result: CopyResult | null;
  onCopy: (path: string) => void;
}

function PathEntry({ label, path, result, onCopy }: PathEntryProps) {
  const t = useT();
  const shown = result?.path === path ? result : null;
  return (
    <div className="grid min-w-0 gap-ui-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${WRAP}`}>{path}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <Button size="sm" onClick={() => onCopy(path)}>
          {t("services.copy.button")}
        </Button>
        {shown?.ok ? (
          <span className="text-xs text-muted-foreground" role="status">
            {t("services.copy.copied")}
          </span>
        ) : null}
        {shown && !shown.ok ? (
          <span className="text-xs text-warning" role="alert">
            {t("services.copy.failed")}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function SummarySection({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-ui-8">
      <h4 className="text-sm font-semibold" id={id}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function Fact({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-ui-12 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 ${WRAP}`}>{children}</dd>
    </div>
  );
}
