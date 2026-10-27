import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import { formatNumber } from "../../i18n/format";
import type { MessageKey } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  exportDiagnosticsReport,
  getDiagnosticsReport,
  type DiagnosticProviderState,
  type DiagnosticsReport,
} from "../../ipc/settings";
import {
  SettingsActions,
  SettingsFeedback,
  SettingsFieldList,
  SettingsForm,
  SettingsSection,
  SettingsValueField,
} from "./SettingsPrimitives";

type ReportState =
  | { status: "loading" }
  | { status: "ready"; report: DiagnosticsReport }
  | { status: "error"; error: AppError };

const PROVIDER_LABEL_KEYS = {
  system: "settings.diagnostics.provider.system",
  homebrew: "settings.diagnostics.provider.homebrew",
  candidates: "settings.diagnostics.provider.candidates",
} as const satisfies Record<DiagnosticsReport["providers"][number]["id"], MessageKey>;

const PROVIDER_STATE_LABEL_KEYS: Record<DiagnosticProviderState, MessageKey> = {
  LOADING: "common.loading",
  HEALTHY: "settings.diagnostics.state.healthy",
  PARTIAL: "settings.diagnostics.state.partial",
  UNAVAILABLE: "settings.diagnostics.state.unavailable",
  ERROR: "settings.diagnostics.state.error",
};

function providerTone(
  state: DiagnosticProviderState,
): "neutral" | "success" | "warning" | "danger" {
  if (state === "HEALTHY") return "success";
  if (state === "ERROR") return "danger";
  if (state === "PARTIAL" || state === "UNAVAILABLE") return "warning";
  return "neutral";
}

export function DiagnosticsSettings() {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [busyAction, setBusyAction] = useState<"copy" | "export">();
  const [message, setMessage] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  async function loadReport(): Promise<void> {
    setState({ status: "loading" });
    setMessage(undefined);
    setActionError(undefined);
    try {
      setState({ status: "ready", report: await getDiagnosticsReport() });
    } catch (caught) {
      setState({ status: "error", error: decodeAppError(caught) });
    }
  }

  useEffect(() => {
    let active = true;
    void getDiagnosticsReport()
      .then((report) => {
        if (active) setState({ status: "ready", report });
      })
      .catch((caught) => {
        if (active) {
          setState({ status: "error", error: decodeAppError(caught) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function copyReport(report: DiagnosticsReport): Promise<void> {
    if (busyAction) return;
    setBusyAction("copy");
    setMessage(undefined);
    setActionError(undefined);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(report.reportText);
      setMessage(t("settings.diagnostics.copied"));
    } catch {
      setActionError(t("settings.diagnostics.copyFailed"));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function exportReport(): Promise<void> {
    if (busyAction) return;
    setBusyAction("export");
    setMessage(undefined);
    setActionError(undefined);
    try {
      const exported = await exportDiagnosticsReport();
      setMessage(t("settings.diagnostics.exported", { location: exported.displayLocation }));
    } catch (caught) {
      setActionError(decodeAppError(caught).message);
    } finally {
      setBusyAction(undefined);
    }
  }

  if (state.status === "loading") {
    return <AsyncState kind="loading">{t("settings.diagnostics.generating")}</AsyncState>;
  }

  if (state.status === "error") {
    return (
      <SettingsForm>
        <AsyncState kind="error">{state.error.message}</AsyncState>
        <SettingsActions className="border-0 pt-0">
          <Button size="sm" variant="default" onClick={() => void loadReport()}>
            {t("settings.diagnostics.regenerate")}
          </Button>
        </SettingsActions>
      </SettingsForm>
    );
  }

  const { report } = state;

  return (
    <SettingsForm busy={busyAction !== undefined}>
      <SettingsFieldList>
        <SettingsValueField
          label={t("settings.diagnostics.appSystem.label")}
          description={
            t("settings.diagnostics.appSystem.description", {
              version: report.application.version,
              macos: report.system.macosVersion ?? t("settings.diagnostics.unknown"),
            })
          }
        >
          {report.system.architecture}
        </SettingsValueField>
        <SettingsValueField
          label="Catalog"
          description={t("settings.diagnostics.catalog.description", {
            applications: formatNumber(report.catalog.applicationCount, locale),
            documents: formatNumber(report.catalog.managedDocumentCount, locale),
            services: formatNumber(report.catalog.serviceCount, locale),
          })}
        >
          <StatusBadge tone="success">
            schema {report.catalog.schemaVersion}
          </StatusBadge>
        </SettingsValueField>
      </SettingsFieldList>

      <Panel
        className="bg-surface-muted p-ui-12"
        aria-labelledby="diagnostics-provider-heading"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12">
          <SettingsSection
            title={t("settings.diagnostics.providers.title")}
            description={t("settings.diagnostics.providers.description")}
            headingId="diagnostics-provider-heading"
          />
          <Button
            size="sm"
            variant="default"
            disabled={busyAction !== undefined}
            onClick={() => void loadReport()}
          >
            {t("settings.diagnostics.regenerate")}
          </Button>
        </div>
        <div className="mt-ui-12 flex flex-wrap gap-ui-8">
          {report.providers.map((provider) => (
            <StatusBadge
              key={provider.id}
              tone={providerTone(provider.state)}
            >
              {t("settings.diagnostics.providerStatus", {
                provider: t(PROVIDER_LABEL_KEYS[provider.id]),
                state: t(PROVIDER_STATE_LABEL_KEYS[provider.state]),
              })}
            </StatusBadge>
          ))}
        </div>
      </Panel>

      <SettingsSection
        title={t("settings.diagnostics.report.title")}
        description={t("settings.diagnostics.report.description")}
        headingId="diagnostics-report-heading"
      >
        <div className="flex min-w-0 flex-wrap justify-end gap-ui-8">
          <Button
            size="sm"
            variant="ghost"
            disabled={busyAction !== undefined}
            onClick={() => void copyReport(report)}
          >
            {busyAction === "copy" ? t("settings.diagnostics.copying") : t("common.copy")}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={busyAction !== undefined}
            onClick={() => void exportReport()}
          >
            {busyAction === "export" ? t("settings.diagnostics.exporting") : t("settings.diagnostics.export")}
          </Button>
        </div>
        <pre
          className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-panel bg-surface-muted p-ui-12 font-mono text-xs leading-relaxed text-foreground [scrollbar-gutter:stable]"
          tabIndex={0}
        >
          {report.reportText}
        </pre>
      </SettingsSection>

      <SettingsFeedback error={actionError} status={message} />
    </SettingsForm>
  );
}
