import type { MessageKey } from "./zh-CN";
import { commonEn } from "./common";
import { dashboardEn } from "./dashboard";
import { settingsEn } from "./settings";
import { shellEn } from "./shell";
import { systemToolsEn } from "./systemTools";

export const en: Record<MessageKey, string> = {
  ...shellEn,
  ...settingsEn,
  ...dashboardEn,
  ...systemToolsEn,
  ...commonEn,
};
