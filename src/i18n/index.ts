import { en } from "./messages/en";
import { zhCN, type MessageKey } from "./messages/zh-CN";

export type { MessageKey } from "./messages/zh-CN";

export type LanguagePreference = "system" | "zh-CN" | "en";
export type Locale = "zh-CN" | "en";
export type MessageParams = Readonly<Record<string, string | number>>;
export type TranslateFunction = (key: MessageKey, params?: MessageParams) => string;

export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = [
  "system",
  "zh-CN",
  "en",
];

const MESSAGES: Record<Locale, Readonly<Record<string, string>>> = {
  "zh-CN": zhCN,
  en,
};

export function resolveLocale(
  preference: LanguagePreference,
  systemLanguage: string | undefined,
): Locale {
  if (preference === "zh-CN" || preference === "en") {
    return preference;
  }
  return systemLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const PLURAL_PATTERN = /\{(\w+),\s*plural,\s*((?:\w+\s*\{[^{}]*\}\s*)+)\}/g;
const PLURAL_BRANCH_PATTERN = /(\w+)\s*\{([^{}]*)\}/g;
const PARAMETER_PATTERN = /\{(\w+)\}/g;

function selectPluralBranch(
  locale: Locale,
  branchSource: string,
  count: number,
): string {
  const branches = new Map<string, string>();
  for (const [, category, text] of branchSource.matchAll(PLURAL_BRANCH_PATTERN)) {
    branches.set(category, text);
  }
  const category = new Intl.PluralRules(locale).select(count);
  return branches.get(category) ?? branches.get("other") ?? "";
}

export function formatMessage(
  locale: Locale,
  template: string,
  params?: MessageParams,
): string {
  const withPlurals = template.replace(
    PLURAL_PATTERN,
    (_match, name: string, branchSource: string) => {
      const count = Number(params?.[name]);
      const branch = selectPluralBranch(locale, branchSource, count);
      return branch.replace(/#/g, String(count));
    },
  );
  return withPlurals.replace(PARAMETER_PATTERN, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = MESSAGES[locale][key];
  if (template === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] 缺少文案键：${key}`);
    }
    return key;
  }
  return formatMessage(locale, template, params);
}
