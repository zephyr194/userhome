import { useEffect, useState } from "react";
import { useT } from "../../i18n/useLocale";
import { Button } from "./Button";
import { classNames } from "./classNames";
import { copyText } from "./clipboard";

const FEEDBACK_MS = 3000;

/**
 * Copies `value` and confirms beside the button for a few seconds. Both
 * outcomes are stacked in one grid cell, so the slot keeps its width and the
 * row never shifts when the message changes.
 */
export function CopyButton({
  ariaLabel,
  label,
  value,
}: {
  ariaLabel?: string;
  label: string;
  value: string;
}) {
  const t = useT();
  const [result, setResult] = useState<{ copied: boolean }>();

  useEffect(() => {
    if (result === undefined) return;
    const timer = window.setTimeout(() => setResult(undefined), FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy() {
    setResult({ copied: await copyText(value) });
  }

  return (
    <span className="r12-copy-button">
      <Button aria-label={ariaLabel} onClick={() => void copy()} variant="ghost">
        {label}
      </Button>
      <span className="r12-copy-button__feedback">
        <span aria-hidden="true" className="r12-copy-button__sizer text-aux">
          {t("common.copyFeedback.copied")}
        </span>
        <span aria-hidden="true" className="r12-copy-button__sizer text-aux">
          {t("common.copyFeedback.failed")}
        </span>
        {result === undefined ? null : (
          <span
            className={classNames(
              "text-aux whitespace-nowrap",
              result.copied ? "text-muted-foreground" : "text-danger",
            )}
            role="status"
          >
            {result.copied ? t("common.copyFeedback.copied") : t("common.copyFeedback.failed")}
          </span>
        )}
      </span>
    </span>
  );
}
