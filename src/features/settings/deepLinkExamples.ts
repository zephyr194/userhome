export const DEEP_LINK_EXAMPLES = [
  {
    id: "environment-zsh",
    purpose: "打开环境变量的 zsh 启动文件",
    link: "userhome://open/environment?section=zsh",
  },
  {
    id: "caddy-rules",
    purpose: "打开 Caddy 站点规则",
    link: "userhome://open/caddy?section=rules",
  },
  {
    id: "settings-general",
    purpose: "打开通用设置",
    link: "userhome://open/settings?group=general",
  },
] as const;
