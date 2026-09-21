import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  exportDiagnosticsReport,
  getDiagnosticsReport,
  type DiagnosticProviderState,
  type DiagnosticsReport,
} from "../../ipc/settings";

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
      <div className="settings-form">
        <AsyncState kind="error">{state.error.message}</AsyncState>
        <div>
          <Button onClick={() => void loadReport()}>重新生成</Button>
        </div>
      </div>
    );
  }

  const { report } = state;

  return (
    <div className="settings-form" aria-busy={busyAction !== undefined}>
      <div className="settings-control-list">
        <div className="settings-control-row">
          <span>
            <strong>应用与系统</strong>
            <small>
              UserHome {report.application.version} · macOS{" "}
              {report.system.macosVersion ?? "未知"}
            </small>
          </span>
          <span className="settings-control-row__value">
            {report.system.architecture}
          </span>
        </div>
        <div className="settings-control-row">
          <span>
            <strong>Catalog</strong>
            <small>
              {report.catalog.applicationCount} 个应用 ·{" "}
              {report.catalog.managedDocumentCount} 个受管文档 ·{" "}
              {report.catalog.serviceCount} 个服务
            </small>
          </span>
          <StatusBadge tone="success">
            schema {report.catalog.schemaVersion}
          </StatusBadge>
        </div>
        <div className="settings-control-row">
          <span>
            <strong>权限辅助程序</strong>
            <small>
              {report.helper.supported
                ? report.helper.signed
                  ? "受支持且签名状态有效"
                  : "受支持，但签名状态不可用"
                : "当前平台不支持"}
            </small>
          </span>
          <StatusBadge
            tone={report.helper.available ? "success" : "warning"}
          >
            {report.helper.available ? "可用" : "不可用"}
          </StatusBadge>
        </div>
      </div>

      <section
        className="rounded-lg border border-border bg-surface-muted p-3"
        aria-labelledby="diagnostics-provider-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              className="m-0 text-xs font-semibold"
              id="diagnostics-provider-heading"
            >
              提供程序健康
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              仅显示固定提供程序和枚举状态，不包含错误详情或候选路径。
            </p>
          </div>
          <Button
            size="sm"
            disabled={busyAction !== undefined}
            onClick={() => void loadReport()}
          >
            重新生成
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
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
      </section>

      <section aria-labelledby="diagnostics-report-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              className="m-0 text-xs font-semibold"
              id="diagnostics-report-heading"
            >
              净化报告
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              不包含配置内容、密钥、用户名、绝对主目录、环境变量或授权材料。
            </p>
          </div>
          <div className="flex gap-2">
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
        </div>
        <pre className="diagnostics-report">{report.reportText}</pre>
      </section>

      {actionError ? (
        <p className="settings-form__error" role="alert">
          {actionError}
        </p>
      ) : message ? (
        <p className="settings-form__status" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
