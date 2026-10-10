import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function Panel({
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={classNames(
        "rounded-panel border border-border bg-surface text-foreground",
        className,
      )}
      {...props}
    />
  );
}
