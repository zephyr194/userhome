import { Button as HeadlessButton } from "@headlessui/react";
import type { ButtonHTMLAttributes, Ref } from "react";
import { classNames } from "./classNames";

/**
 * variant 层级，每个 Button 显式写出：
 * primary：一个操作区里唯一要提交或推进的动作（保存、创建、应用），同区最多一个。
 * default：一般动作（取消、预览、刷新、导入），也是默认外观。
 * default：一般动作（取消、预览、刷新、导入），白底、普通按钮描边，不带图标。
 * secondary：与主动作并列、同样重要的备选，淡青底、青字。
 * ghost：行内、工具类与图标按钮（复制、展开、清除、显示/隐藏），不带图标。
 * danger：删除、停止、卸载、重置、覆盖等破坏性确认，以及出错后的补救动作，永远不作为 primary。
 */
type ButtonVariant = "default" | "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    "border-button-border bg-surface text-foreground enabled:hover:border-button-border-hover enabled:hover:bg-surface-muted enabled:active:bg-surface-muted",
  primary:
    "r12-btn--primary border-transparent bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:active:bg-primary-hover",
  secondary:
    "border-transparent bg-primary-soft text-accent-text enabled:hover:bg-primary-soft-hover enabled:active:bg-primary-soft-hover",
  danger:
    "r12-btn--danger border-transparent bg-danger text-danger-foreground enabled:hover:bg-danger-hover enabled:active:bg-danger-hover",
  ghost:
    "border-transparent bg-transparent text-muted-foreground enabled:hover:bg-surface-muted enabled:hover:text-foreground enabled:active:bg-surface-muted enabled:active:text-foreground",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-control-sm px-ui-8 text-meta",
  md: "min-h-control-md px-ui-8 text-aux",
  lg: "min-h-control-lg px-ui-12 text-body",
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
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <HeadlessButton
      ref={ref}
      className={classNames(
        "inline-flex shrink-0 items-center justify-center gap-ui-4 whitespace-nowrap rounded-control border font-medium leading-none transition-colors motion-press",
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
