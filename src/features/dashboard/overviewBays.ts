import type { AiConfigReport } from "../../ipc/aiConfig";
import type { AppConfigListItem } from "../../ipc/appConfig";
import type { CaddyRunState, CaddyStatus } from "../../ipc/caddy";
import type { ServiceSummary } from "../../ipc/services";

export type BayTone = "neutral" | "success" | "warning" | "danger";

export interface BayStatus {
  tone: BayTone;
  label: string;
  attention: boolean;
}

export interface BayFigure {
  label: string;
  value: string;
}

export interface BayReading {
  status: BayStatus;
  value: string;
}

export type ServiceBayInput =
  | { status: "loading" }
  | { status: "ready"; services: readonly ServiceSummary[] }
  | { status: "error" };

export const BAY_NO_VALUE = "—";
export const BAY_UNLOADED: BayStatus = { tone: "neutral", label: "未读取", attention: false };
export const BAY_READING: BayStatus = { tone: "neutral", label: "读取中", attention: false };
export const BAY_HEALTHY: BayStatus = { tone: "success", label: "正常", attention: false };
export const BAY_NEEDS_ATTENTION: BayStatus = { tone: "warning", label: "需留意", attention: true };
export const BAY_FAILED: BayStatus = { tone: "danger", label: "异常", attention: true };

const SERVICE_FIGURE_LABEL = "运行 / 停止";

export const OVERVIEW_MODULE_BAYS = [
  { routeId: "caddy", title: "Caddy", figureLabel: "运行状态", action: "打开 Caddy" },
  { routeId: "environment", title: "环境变量", figureLabel: "变量数与未保存", action: "打开环境变量" },
  { routeId: "aiConfig", title: "AI 配置", figureLabel: "已检测工具", action: "打开 AI 配置" },
  { routeId: "appConfig", title: "应用配置", figureLabel: "已发现条目", action: "打开应用配置" },
] as const;

export type OverviewModuleBay = (typeof OVERVIEW_MODULE_BAYS)[number];

const CADDY_RUN_LABELS: Record<CaddyRunState, string> = {
  STOPPED: "已停止",
  STARTING: "启动中",
  RUNNING: "运行中",
  STOPPING: "停止中",
  FAILED: "失败",
  UNKNOWN: "未知",
};

export function serviceBay(services: ServiceBayInput): { status: BayStatus; figure: BayFigure } {
  if (services.status === "loading") {
    return {
      status: BAY_READING,
      figure: { label: SERVICE_FIGURE_LABEL, value: BAY_NO_VALUE },
    };
  }
  if (services.status === "error") {
    return { status: BAY_UNLOADED, figure: { label: SERVICE_FIGURE_LABEL, value: BAY_NO_VALUE } };
  }
  const { services: list } = services;
  const failed = list.filter((item) => item.state === "ERROR").length;
  const started = list.filter((item) => item.state === "STARTED").length;
  const stopped = list.filter((item) => item.state === "STOPPED").length;
  const status: BayStatus =
    failed > 0
      ? { tone: "danger", label: `${failed} 项异常`, attention: true }
      : list.length === 0
        ? { tone: "neutral", label: "暂无服务", attention: false }
        : BAY_HEALTHY;
  return {
    status,
    figure: { label: SERVICE_FIGURE_LABEL, value: `${started} / ${stopped}` },
  };
}

export function caddyBayReading(status: CaddyStatus): BayReading {
  const bayStatus =
    status.state === "FAILED"
      ? BAY_FAILED
      : status.state === "UNKNOWN"
        ? BAY_NEEDS_ATTENTION
        : BAY_HEALTHY;
  return { status: bayStatus, value: CADDY_RUN_LABELS[status.state] };
}

export function aiBayReading(report: AiConfigReport): BayReading {
  const found = report.tools.filter((tool) => tool.installStatus === "found").length;
  const invalid = report.tools.some((tool) => tool.installStatus === "invalid");
  return {
    status: invalid ? BAY_NEEDS_ATTENTION : BAY_HEALTHY,
    value: `${found} / ${report.tools.length}`,
  };
}

export function appConfigBayReading(items: readonly AppConfigListItem[]): BayReading {
  const inaccessible = items.some((item) => item.probe.status === "inaccessible");
  return {
    status: inaccessible ? BAY_NEEDS_ATTENTION : BAY_HEALTHY,
    value: String(items.length),
  };
}
