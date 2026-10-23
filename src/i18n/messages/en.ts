import type { MessageKey } from "./zh-CN";
import { caddyEn } from "./caddy";
import { commonEn } from "./common";
import { operationsEn } from "./operations";
import { toolsEn } from "./tools";
import { aiConfigEn } from "./aiConfig";
import { appConfigEn } from "./appConfig";
import { environmentEn } from "./environment";
import { environmentEditorsEn } from "./environmentEditors";
import { environmentModelsEn } from "./environmentModels";
import { dashboardEn } from "./dashboard";
import { servicesEn } from "./services";
import { settingsEn } from "./settings";
import { shellEn } from "./shell";
import { systemToolsEn } from "./systemTools";

export const en: Record<MessageKey, string> = {
  ...shellEn,
  ...settingsEn,
  ...dashboardEn,
  ...systemToolsEn,
  ...servicesEn,
  ...caddyEn,
  ...toolsEn,
  ...operationsEn,
  ...commonEn,
  ...environmentEn,
  ...aiConfigEn,
  ...appConfigEn,
  ...environmentEditorsEn,
  ...environmentModelsEn,
};
