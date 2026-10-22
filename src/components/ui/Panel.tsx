import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function Panel({
  className,
  ticks = false,
  selectable = false,
  selected = false,
  ...props
}: ComponentPropsWithoutRef<"section"> & {
  ticks?: boolean;
  selectable?: boolean;
  selected?: boolean;
}) {
  return (
    <section
      className={classNames(
        "rounded-panel bg-surface text-foreground ring-1 ring-inset ring-line",
        ticks && "corner-ticks",
        selectable && "bracket",
        className,
      )}
      aria-selected={selectable ? selected : undefined}
      {...props}
    />
  );
}
