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

export type ServiceBayInput =
  | { status: "loading" }
  | { status: "ready"; services: readonly ServiceSummary[] }
  | { status: "error" };

export const BAY_NO_VALUE = "—";
export const BAY_UNLOADED: BayStatus = { tone: "neutral", label: "未加载", attention: false };

const SERVICE_FIGURE_LABEL = "运行 / 停止";

/** Module bays whose key figures live in their own pages, so the overview shows them as unloaded. */
export const OVERVIEW_MODULE_BAYS = [
  { routeId: "caddy", title: "Caddy", figureLabel: "监听地址与状态", action: "打开 Caddy" },
  { routeId: "environment", title: "环境变量", figureLabel: "变量数与未保存", action: "打开环境变量" },
  { routeId: "aiConfig", title: "AI 配置", figureLabel: "已检测工具", action: "打开 AI 配置" },
  { routeId: "appConfig", title: "应用配置", figureLabel: "已发现条目", action: "打开应用配置" },
] as const;

export function serviceBay(services: ServiceBayInput): { status: BayStatus; figure: BayFigure } {
  if (services.status === "loading") {
    return {
      status: { tone: "neutral", label: "读取中", attention: false },
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
        : { tone: "success", label: "正常", attention: false };
  return {
    status,
    figure: { label: SERVICE_FIGURE_LABEL, value: `${started} / ${stopped}` },
  };
}
