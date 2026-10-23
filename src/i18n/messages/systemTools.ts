export const systemToolsZh = {
  "systemTools.open": "打开",
  "systemTools.caddy.description": "检测 Caddy 并编辑本机反向代理规则。",
} as const;

export const systemToolsEn = {
  "systemTools.open": "Open",
  "systemTools.caddy.description": "Detect Caddy and edit local reverse-proxy rules.",
} satisfies Record<keyof typeof systemToolsZh, string>;
