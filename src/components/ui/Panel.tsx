import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function Panel({
  className,
  ticks = false,
  ...props
}: ComponentPropsWithoutRef<"section"> & { ticks?: boolean }) {
  return (
    <section
      className={classNames(
        "rounded-panel bg-surface text-foreground ring-1 ring-inset ring-line",
        ticks && "corner-ticks",
        className,
      )}
      {...props}
    />
  );
}
