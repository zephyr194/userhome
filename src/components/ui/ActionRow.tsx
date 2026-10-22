import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function ActionRow({
  align,
  alignItems = "center",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  align?: "end";
  alignItems?: "center" | "end";
}) {
  return (
    <div
      className={classNames(
        "flex flex-wrap",
        alignItems === "end" ? "items-end" : "items-center",
        "gap-ui-8",
        align === "end" && "justify-end",
        className,
      )}
      {...props}
    />
  );
}
