import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

type StatusTone = "neutral" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border bg-surface-muted text-muted-foreground",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusBadge({
  className,
  tone = "neutral",
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={classNames(
        "inline-flex min-h-status-badge max-w-full items-center break-words rounded-control border px-ui-md py-ui-xxs text-xs font-medium leading-snug",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
