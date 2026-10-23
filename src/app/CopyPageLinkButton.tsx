import { useState } from "react";
import { Button } from "../components/ui/Button";
import { COPY_LINK_FAILED, copyText } from "../components/ui/clipboard";

/** Copies the link of the page on screen; the key remounts it so a stale status never outlives its page. */
export function CopyPageLinkButton({ link }: { link: string | undefined }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    if (link === undefined) return;
    setStatus((await copyText(link)) ? "copied" : "failed");
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-ui-8">
      {status === "failed" && link !== undefined ? (
        <span className="r8-deeplink-copy-failure" role="alert">
          <span>{COPY_LINK_FAILED}</span>
          <code className="r8-deeplink-copy-failure__link">{link}</code>
        </span>
      ) : status === "copied" ? (
        <span className="text-aux text-muted-foreground" role="status">
          已复制链接
        </span>
      ) : null}
      <Button
        disabled={link === undefined}
        onClick={() => void copyLink()}
        size="sm"
        variant="secondary"
      >
        复制链接
      </Button>
    </span>
  );
}
