import { useContext } from "react";
import type { Locale, TranslateFunction } from "./index";
import { LocaleContext } from "./localeContext";

export function useT(): TranslateFunction {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}
