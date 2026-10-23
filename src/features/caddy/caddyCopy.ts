import { useMemo } from "react";
import { translate, type Locale, type TranslateFunction } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";

export interface CaddyCopy {
  readonly t: TranslateFunction;
  readonly locale: Locale;
}

export const ZH_COPY: CaddyCopy = {
  locale: "zh-CN",
  t: (key, params) => translate("zh-CN", key, params),
};

export function useCaddyCopy(): CaddyCopy {
  const t = useT();
  const locale = useLocale();
  return useMemo(() => ({ t, locale }), [t, locale]);
}
