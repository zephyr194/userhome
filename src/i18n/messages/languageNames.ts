import type { LanguagePreference } from "../index";

/** Names stay in their own language in every interface language, so they never go through the catalogs. */
export const LANGUAGE_NAMES: Record<LanguagePreference, string> = {
  system: "跟随系统",
  "zh-CN": "简体中文",
  en: "English",
};
