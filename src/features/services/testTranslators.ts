import { translate, type TranslateFunction } from "../../i18n";

export const tZh: TranslateFunction = (key, params) => translate("zh-CN", key, params);
export const tEn: TranslateFunction = (key, params) => translate("en", key, params);

/** Binds the zh-CN translator as the trailing argument. */
export function withZh<A extends unknown[], R>(
  fn: (...args: [...A, TranslateFunction]) => R,
): (...args: A) => R {
  return (...args: A) => fn(...args, tZh);
}
