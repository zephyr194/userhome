import type { AppError } from "../../ipc/core";
import type {
  CaddyCheckStage,
  CaddyReferenceKind,
  CaddyValidationReport,
} from "../../ipc/caddy";

export type ValidationState =
  | { status: "idle" }
  | {
      status: "running";
      runId: string;
      allowExternalReferences: boolean;
      checkedText: string;
    }
  | {
      status: "done";
      report: CaddyValidationReport;
      allowExternalReferences: boolean;
      checkedText: string;
    }
  | { status: "failed"; error: AppError; checkedText: string };

export type SummaryTone = "success" | "warning" | "danger" | "muted";

export interface ValidationSummary {
  tone: SummaryTone;
  title: string;
  details: string[];
  canAllowExternal: boolean;
}

const REFERENCE_LABELS: Record<CaddyReferenceKind, string> = {
  IMPORT: "import 引用其他文件",
  FILE_PLACEHOLDER: "{file.*} 会读取文件",
  ENV_PLACEHOLDER: "{env.*} 或 {$变量} 会读取环境变量",
  TLS_ARGUMENTS: "tls 带参数（证书文件或本地 CA）",
};

const STAGE_LABELS: Record<CaddyCheckStage, string> = {
  ADAPT: "结构解析失败（adapt）",
  VALIDATE: "模块加载失败（validate）",
};

export const EXTERNAL_REFERENCE_NOTE =
  "允许后才会执行校验。校验在私有临时目录中进行，相对引用不会指向你的其他文件。";

export function referenceLabel(kind: CaddyReferenceKind): string {
  return REFERENCE_LABELS[kind];
}

export function stageLabel(stage: CaddyCheckStage): string {
  return STAGE_LABELS[stage];
}

export function summarizeReport(report: CaddyValidationReport): ValidationSummary {
  const messages = report.diagnostics.map((item) =>
    item.line === undefined ? item.message : `第 ${item.line} 行：${item.message}`,
  );
  switch (report.status) {
    case "VALID":
      return {
        tone: "success",
        title: "校验通过",
        details: ["已依次执行 adapt 与 validate。"],
        canAllowExternal: false,
      };
    case "INVALID":
      return {
        tone: "danger",
        title: report.stage ? `校验未通过：${stageLabel(report.stage)}` : "校验未通过",
        details: messages,
        canAllowExternal: false,
      };
    case "EXTERNAL_REFERENCES":
      return {
        tone: "warning",
        title: "含外部引用，需要显式允许",
        details: [
          ...report.externalReferences.map(
            (reference) => `第 ${reference.line} 行：${referenceLabel(reference.kind)}`,
          ),
          EXTERNAL_REFERENCE_NOTE,
        ],
        canAllowExternal: true,
      };
    case "TIMEOUT":
      return {
        tone: "danger",
        title: "校验超时，已停止（结果未知）",
        details: messages,
        canAllowExternal: false,
      };
    case "CANCELLED":
      return { tone: "muted", title: "已取消校验", details: [], canAllowExternal: false };
    case "OUTPUT_TOO_LARGE":
      return {
        tone: "danger",
        title: "Caddy 输出超过上限，已停止校验",
        details: messages,
        canAllowExternal: false,
      };
    case "UNAVAILABLE":
      return {
        tone: "danger",
        title: "无法运行 Caddy",
        details: messages,
        canAllowExternal: false,
      };
  }
}

export function summarizeFailure(error: AppError): ValidationSummary {
  return {
    tone: "danger",
    title: "校验请求失败",
    details: [error.message],
    canAllowExternal: false,
  };
}

/** A result only describes the text that was checked; any edit makes it stale. */
export function isResultStale(state: ValidationState, text: string): boolean {
  return (state.status === "done" || state.status === "failed") && state.checkedText !== text;
}

export function isRunning(state: ValidationState): boolean {
  return state.status === "running";
}
