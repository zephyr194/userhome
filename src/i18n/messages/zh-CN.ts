import { commonZh } from "./common";
import { dashboardZh } from "./dashboard";
import { settingsZh } from "./settings";
import { shellZh } from "./shell";
import { systemToolsZh } from "./systemTools";

export const zhCN = {
  ...shellZh,
  ...settingsZh,
  ...dashboardZh,
  ...systemToolsZh,
  ...commonZh,
} as const;

export type MessageKey = keyof typeof zhCN;
