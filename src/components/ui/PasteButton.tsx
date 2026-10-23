import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { classNames } from "./classNames";

const UNREADABLE_MESSAGE = "无法读取粘贴板：请在输入框中按 ⌘V 粘贴。";
const EMPTY_MESSAGE = "粘贴板里没有文本。";

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
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function paste() {
    setReading(true);
    setNotice("");
    let text: string | undefined;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = undefined;
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
        {notice}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={reading || disabled}
        onClick={() => void paste()}
      >
        读取粘贴板
      </Button>
    </span>
  );
}
