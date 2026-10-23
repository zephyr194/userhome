import { translate } from "../../i18n";

export const COPY_LINK_FAILED_KEY = "common.clipboard.copyLinkFailed";

export const COPY_LINK_FAILED = translate("zh-CN", COPY_LINK_FAILED_KEY);

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
