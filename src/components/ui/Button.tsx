import { Button as HeadlessButton } from "@headlessui/react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { classNames } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:active:bg-primary-hover",
  secondary:
    "border-control-border bg-surface text-foreground enabled:hover:bg-surface-muted enabled:active:bg-surface-muted",
  danger:
    "border-transparent bg-danger text-danger-foreground enabled:hover:bg-danger-hover enabled:active:bg-danger-hover",
  ghost:
    "border-transparent bg-transparent text-muted-foreground enabled:hover:bg-surface-muted enabled:hover:text-foreground enabled:active:bg-surface-muted enabled:active:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-control-sm px-ui-lg text-aux",
  md: "min-h-control-md px-ui-2xl text-body",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  className,
  ref,
  size = "md",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <HeadlessButton
      ref={ref}
      className={classNames(
        "inline-flex items-center justify-center gap-ui-md rounded-control border font-medium transition-colors",
        "focus-visible:shadow-focus",
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
