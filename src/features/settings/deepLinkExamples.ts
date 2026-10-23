export const DEEP_LINK_EXAMPLES = [
  {
    id: "environment-zsh",
    purposeKey: "settings.deepLink.example.environmentZsh",
    link: "userhome://open/environment?section=zsh",
  },
  {
    id: "caddy-rules",
    purposeKey: "settings.deepLink.example.caddyRules",
    link: "userhome://open/caddy?section=rules",
  },
  {
    id: "settings-general",
    purposeKey: "settings.deepLink.example.settingsGeneral",
    link: "userhome://open/settings?group=general",
  },
] as const;
