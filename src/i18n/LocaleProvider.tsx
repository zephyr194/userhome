import { useEffect, useMemo, type ReactNode } from "react";
import { resolveLocale, type LanguagePreference } from "./index";
import { createLocaleValue, LocaleContext } from "./localeContext";

export function LocaleProvider({
  children,
  preference,
}: {
  children: ReactNode;
  preference: LanguagePreference;
}) {
  const locale = resolveLocale(preference);
  const value = useMemo(() => createLocaleValue(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
