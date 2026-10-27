import { Button as HeadlessButton } from "@headlessui/react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { classNames } from "./classNames";

/**
 * variant 层级，每个 Button 显式写出：
 * primary：一个操作区里唯一要提交或推进的动作（保存、创建、应用），同区最多一个。
 * secondary：与主动作并列的备选或辅助动作（取消、预览、刷新、导入），也是默认外观。
 * ghost：行内、工具类与图标按钮（复制、展开、清除、显示/隐藏）。
 * danger：删除、停止、卸载、重置、覆盖等破坏性确认，永远不作为 primary。
 */
type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "r12-btn--primary border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:active:bg-primary-hover",
  secondary:
    "border-control-border bg-surface text-foreground enabled:hover:bg-surface-muted enabled:active:bg-surface-muted",
  danger:
    "r12-btn--danger border-transparent bg-danger text-danger-foreground enabled:hover:bg-danger-hover enabled:active:bg-danger-hover",
  ghost:
    "border-transparent bg-transparent text-muted-foreground enabled:hover:bg-surface-muted enabled:hover:text-foreground enabled:active:bg-surface-muted enabled:active:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-control-sm px-ui-8 text-aux",
  md: "min-h-control-md px-ui-12 text-body",
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
        "inline-flex shrink-0 items-center justify-center gap-ui-8 whitespace-nowrap rounded-control border font-medium transition-colors motion-press",
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
