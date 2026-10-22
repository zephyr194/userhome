import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function ActionRow({
  align,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  align?: "end";
}) {
  return (
    <div
      className={classNames(
        "flex flex-wrap items-center gap-ui-8",
        align === "end" && "justify-end",
        className,
      )}
      {...props}
    />
  );
}
