import { translate, type TranslateFunction } from "../../i18n";

/**
 * Model functions that return user text take a translator as their last argument.
 * Without one they produce the zh-CN text, which keeps the Chinese-rendered tests unchanged.
 */
export const zhTranslate: TranslateFunction = (key, params) => translate("zh-CN", key, params);
