import { Button as HeadlessButton } from "@headlessui/react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "../../i18n/useLocale";
import { classNames } from "./classNames";

const EDGE = 8;
const GAP = 4;

export function InfoTip({
  className,
  description,
  title,
}: {
  className?: string;
  description: ReactNode;
  title: string;
}) {
  const t = useT();
  const bubbleId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (hovered || focused || pinned);

  useEffect(() => {
    if (!pinned) return;
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setPinned(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pinned]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const trigger = triggerRef.current;
    if (!open || !bubble || !trigger) return;

    bubble.dataset.side = "bottom";
    bubble.dataset.align = "start";
    const anchor = trigger.getBoundingClientRect();
    const box = bubble.getBoundingClientRect();
    const fitsBelow = anchor.bottom + GAP + box.height <= window.innerHeight - EDGE;
    const fitsAbove = anchor.top - GAP - box.height >= EDGE;
    if (!fitsBelow && fitsAbove) bubble.dataset.side = "top";
    const fitsStart = anchor.left + box.width <= window.innerWidth - EDGE;
    const fitsEnd = anchor.right - box.width >= EDGE;
    if (!fitsStart && fitsEnd) bubble.dataset.align = "end";
  }, [open]);

  return (
    <span
      className={classNames("info-tip", className)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
        setPinned(false);
        setDismissed(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setDismissed(true);
        setPinned(false);
      }}
      ref={wrapperRef}
    >
      <HeadlessButton
        aria-describedby={bubbleId}
        aria-label={t("common.infoTip.label", { title })}
        className="info-tip__trigger"
        data-open={open || undefined}
        onClick={() => {
          setPinned((current) => !current);
          setDismissed(false);
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onMouseEnter={() => {
          setHovered(true);
          setDismissed(false);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setDismissed(false);
        }}
        ref={triggerRef}
      >
        <svg
          aria-hidden="true"
          className="info-tip__icon"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
          viewBox="0 0 16 16"
          width="16"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4" />
          <path d="M8 4.75v.25" />
        </svg>
      </HeadlessButton>
      <span
        className="info-tip__bubble text-aux break-words"
        hidden={!open}
        id={bubbleId}
        ref={bubbleRef}
        role="tooltip"
      >
        {description}
      </span>
    </span>
  );
}
