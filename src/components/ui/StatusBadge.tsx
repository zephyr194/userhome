import type { HTMLAttributes } from "react";
import { classNames } from "./classNames";

type StatusTone = "neutral" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
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
        "inline-flex min-h-status-badge max-w-full items-center break-words rounded-badge px-ui-8 font-sans text-aux font-medium state-transition",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
