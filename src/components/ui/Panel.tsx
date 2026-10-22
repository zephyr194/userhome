import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function Panel({
  className,
  selectable = false,
  selected = false,
  ...props
}: ComponentPropsWithoutRef<"section"> & {
  selectable?: boolean;
  selected?: boolean;
}) {
  return (
    <section
      className={classNames(
        "rounded-panel bg-surface text-foreground ring-1 ring-inset ring-line",
        selectable && "slide-item",
        className,
      )}
      aria-selected={selectable ? selected : undefined}
      {...props}
    />
  );
}
