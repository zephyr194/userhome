import { caddyZh } from "./caddy";
import { commonZh } from "./common";
import { operationsZh } from "./operations";
import { toolsZh } from "./tools";
import { aiConfigZh } from "./aiConfig";
import { appConfigZh } from "./appConfig";
import { environmentZh } from "./environment";
import { environmentEditorsZh } from "./environmentEditors";
import { environmentModelsZh } from "./environmentModels";
import { dashboardZh } from "./dashboard";
import { servicesZh } from "./services";
import { settingsZh } from "./settings";
import { shellZh } from "./shell";
import { systemToolsZh } from "./systemTools";

export const zhCN = {
  ...shellZh,
  ...settingsZh,
  ...dashboardZh,
  ...systemToolsZh,
  ...servicesZh,
  ...caddyZh,
  ...toolsZh,
  ...operationsZh,
  ...commonZh,
  ...environmentZh,
  ...aiConfigZh,
  ...appConfigZh,
  ...environmentEditorsZh,
  ...environmentModelsZh,
} as const;

export type MessageKey = keyof typeof zhCN;
