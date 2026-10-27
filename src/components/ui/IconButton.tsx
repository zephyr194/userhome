import type { ComponentProps } from "react";
import { Button } from "./Button";
import { classNames } from "./classNames";
import { CloseIcon } from "./icons";

type ButtonSize = NonNullable<ComponentProps<typeof Button>["size"]>;

const SQUARE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-w-control-sm",
  md: "min-w-control-md",
  lg: "min-w-control-lg",
};

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "variant"> {
  label: string;
  size?: ButtonSize;
}

export function IconButton({ className, label, size = "md", ...props }: IconButtonProps) {
  return (
    <Button
      {...props}
      aria-label={label}
      className={classNames(SQUARE_CLASSES[size], "r16-icon-button", className)}
      size={size}
      title={label}
      variant="ghost"
    />
  );
}

export function CloseButton(props: Omit<IconButtonProps, "children">) {
  return (
    <IconButton {...props}>
      <CloseIcon />
    </IconButton>
  );
}
