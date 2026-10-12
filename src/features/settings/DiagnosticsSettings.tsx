import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
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

const PROVIDER_LABELS = {
  system: "系统",
  homebrew: "Homebrew",
  candidates: "候选发现",
} as const;

const PROVIDER_STATE_LABELS: Record<DiagnosticProviderState, string> = {
  LOADING: "加载中",
  HEALTHY: "正常",
  PARTIAL: "部分可用",
  UNAVAILABLE: "不可用",
  ERROR: "错误",
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
      setMessage("净化诊断报告已复制到剪贴板。");
    } catch {
      setActionError("无法复制诊断报告。请检查系统剪贴板权限后重试。");
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
      setMessage(`净化诊断报告已导出到 ${exported.displayLocation}。`);
    } catch (caught) {
      setActionError(decodeAppError(caught).message);
    } finally {
      setBusyAction(undefined);
    }
  }

  if (state.status === "loading") {
    return <AsyncState kind="loading">正在生成净化诊断报告…</AsyncState>;
  }

  if (state.status === "error") {
    return (
      <SettingsForm>
        <AsyncState kind="error">{state.error.message}</AsyncState>
        <SettingsActions className="border-0 pt-0">
          <Button size="sm" onClick={() => void loadReport()}>
            重新生成
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
          label="应用与系统"
          description={
            <>
              UserHome {report.application.version} · macOS{" "}
              {report.system.macosVersion ?? "未知"}
            </>
          }
        >
          {report.system.architecture}
        </SettingsValueField>
        <SettingsValueField
          label="Catalog"
          description={`${report.catalog.applicationCount} 个应用 · ${report.catalog.managedDocumentCount} 个受管文档 · ${report.catalog.serviceCount} 个服务`}
        >
          <StatusBadge tone="success">
            schema {report.catalog.schemaVersion}
          </StatusBadge>
        </SettingsValueField>
        <SettingsValueField
          label="权限辅助程序"
          description={
            report.helper.supported
              ? report.helper.signed
                ? "受支持且签名状态有效"
                : "受支持，但签名状态不可用"
              : "当前平台不支持"
          }
        >
          <StatusBadge
            tone={report.helper.available ? "success" : "warning"}
          >
            {report.helper.available ? "可用" : "不可用"}
          </StatusBadge>
        </SettingsValueField>
      </SettingsFieldList>

      <Panel
        className="bg-surface-muted p-ui-2xl"
        aria-labelledby="diagnostics-provider-heading"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-xl">
          <SettingsSection
            title="提供程序健康"
            description="仅显示固定提供程序和枚举状态，不包含错误详情或候选路径。"
            headingId="diagnostics-provider-heading"
          />
          <Button
            size="sm"
            disabled={busyAction !== undefined}
            onClick={() => void loadReport()}
          >
            重新生成
          </Button>
        </div>
        <div className="mt-ui-xl flex flex-wrap gap-ui-md">
          {report.providers.map((provider) => (
            <StatusBadge
              key={provider.id}
              tone={providerTone(provider.state)}
            >
              {PROVIDER_LABELS[provider.id]}：
              {PROVIDER_STATE_LABELS[provider.state]}
            </StatusBadge>
          ))}
        </div>
      </Panel>

      <SettingsSection
        title="净化报告"
        description="不包含配置内容、密钥、用户名、绝对主目录、环境变量或授权材料。"
        headingId="diagnostics-report-heading"
      >
        <div className="flex min-w-0 flex-wrap justify-end gap-ui-md">
          <Button
            size="sm"
            disabled={busyAction !== undefined}
            onClick={() => void copyReport(report)}
          >
            {busyAction === "copy" ? "正在复制…" : "复制"}
          </Button>
          <Button
            size="sm"
            disabled={busyAction !== undefined}
            onClick={() => void exportReport()}
          >
            {busyAction === "export" ? "正在导出…" : "导出…"}
          </Button>
        </div>
        <pre
          className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-panel bg-surface-muted p-ui-xl font-mono text-xs leading-relaxed text-foreground [scrollbar-gutter:stable]"
          tabIndex={0}
        >
          {report.reportText}
        </pre>
      </SettingsSection>

      <SettingsFeedback error={actionError} status={message} />
    </SettingsForm>
  );
}
