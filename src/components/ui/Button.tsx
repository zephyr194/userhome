import { Button as HeadlessButton } from "@headlessui/react";
import type { ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground enabled:hover:border-primary-hover enabled:hover:bg-primary-hover enabled:active:border-primary-hover enabled:active:bg-primary-hover",
  secondary:
    "border-border bg-surface text-foreground enabled:hover:bg-surface-muted enabled:active:bg-surface-muted",
  danger:
    "border-danger bg-danger text-danger-foreground enabled:hover:border-danger-hover enabled:hover:bg-danger-hover enabled:active:border-danger-hover enabled:active:bg-danger-hover",
  ghost:
    "border-transparent bg-transparent text-muted-foreground enabled:hover:bg-surface-muted enabled:hover:text-foreground enabled:active:bg-surface-muted enabled:active:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-control-sm px-ui-lg py-ui-sm text-aux",
  md: "min-h-control-md px-ui-2xl py-ui-md text-body",
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
    <HeadlessButton
      className={classNames(
        "inline-flex items-center justify-center gap-ui-md rounded-control border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
