import { createContext } from "react";
import { translate, type Locale, type TranslateFunction } from "./index";

export interface LocaleContextValue {
  locale: Locale;
  t: TranslateFunction;
}

export function createLocaleValue(locale: Locale): LocaleContextValue {
  return {
    locale,
    t: (key, params) => translate(locale, key, params),
  };
}

export const LocaleContext = createContext<LocaleContextValue>(
  createLocaleValue("zh-CN"),
);
