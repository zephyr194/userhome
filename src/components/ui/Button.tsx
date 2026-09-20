import type { ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover",
  secondary:
    "border-border bg-surface text-foreground hover:bg-surface-muted",
  danger:
    "border-danger bg-danger text-white hover:brightness-95 dark:text-neutral-950",
  ghost:
    "border-transparent bg-transparent text-muted-foreground hover:bg-surface-muted hover:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 py-1.5 text-xs",
  md: "min-h-9 px-3.5 py-2 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  className,
  size = "md",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames(
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
