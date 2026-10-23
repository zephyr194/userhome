import { useState } from "react";
import { Button } from "../components/ui/Button";
import { COPY_LINK_FAILED_KEY, copyText } from "../components/ui/clipboard";
import { useT } from "../i18n/useLocale";

/** Copies the link of the page on screen; the key remounts it so a stale status never outlives its page. */
export function CopyPageLinkButton({ link }: { link: string | undefined }) {
  const t = useT();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    if (link === undefined) return;
    setStatus((await copyText(link)) ? "copied" : "failed");
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-ui-8">
      {status === "failed" && link !== undefined ? (
        <span className="r8-deeplink-copy-failure" role="alert">
          <span>{t(COPY_LINK_FAILED_KEY)}</span>
          <code className="r8-deeplink-copy-failure__link">{link}</code>
        </span>
      ) : status === "copied" ? (
        <span className="text-aux text-muted-foreground" role="status">
          {t("common.copyLink.copied")}
        </span>
      ) : null}
      <Button
        disabled={link === undefined}
        onClick={() => void copyLink()}
        size="sm"
        variant="secondary"
      >
        {t("common.copyLink.copy")}
      </Button>
    </span>
  );
}
