import { commonZh } from "./common";
import { environmentZh } from "./environment";
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
  ...environmentZh,
} as const;

export type MessageKey = keyof typeof zhCN;
