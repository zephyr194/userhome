import type { ComponentPropsWithoutRef } from "react";
import { classNames } from "./classNames";

export function Panel({
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={classNames(
        "rounded-panel bg-surface text-foreground",
        className,
      )}
      {...props}
    />
  );
}
