import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../../i18n";
import { useT } from "../../i18n/useLocale";
import { Button } from "./Button";
import { classNames } from "./classNames";

const UNREADABLE_MESSAGE: MessageKey = "common.paste.unreadable";
const EMPTY_MESSAGE: MessageKey = "common.paste.empty";

export interface PasteButtonProps {
  className?: string;
  disabled?: boolean;
  onPaste: (text: string) => void;
}

export function PasteButton({
  className,
  disabled = false,
  onPaste,
}: PasteButtonProps) {
  const t = useT();
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<MessageKey | "">("");
  const mounted = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function paste() {
    if (inFlight.current) return;
    inFlight.current = true;
    setReading(true);
    setNotice("");
    let text: string | undefined;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = undefined;
    } finally {
      inFlight.current = false;
    }
    if (!mounted.current) return;
    setReading(false);
    if (text === undefined) {
      setNotice(UNREADABLE_MESSAGE);
    } else if (text.trim() === "") {
      setNotice(EMPTY_MESSAGE);
    } else {
      onPaste(text);
    }
  }

  return (
    <span
      className={classNames(
        "inline-flex min-w-0 items-center gap-ui-8",
        className,
      )}
    >
      <span
        aria-live="polite"
        className="min-w-0 break-words text-right text-aux text-muted-foreground"
      >
        {notice ? t(notice) : ""}
      </span>
      <Button
        size="sm"
        variant="default"
        disabled={reading || disabled}
        onClick={() => void paste()}
      >
        {t("common.paste.read")}
      </Button>
    </span>
  );
}
