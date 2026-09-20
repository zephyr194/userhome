import type { ReactNode } from "react";
import { classNames } from "./ui/classNames";

type AsyncStateKind = "loading" | "empty" | "partial" | "error";

const STATE_CLASSES: Record<AsyncStateKind, string> = {
  loading: "border-border bg-surface-muted text-muted-foreground",
  empty: "border-dashed border-border bg-surface text-muted-foreground",
  partial: "border-warning/30 bg-warning/10 text-warning",
  error: "border-danger/30 bg-danger/10 text-danger",
};

export function AsyncState({
  children,
  kind,
}: {
  children: ReactNode;
  kind: AsyncStateKind;
}) {
  return (
    <div
      className={classNames(
        "mt-4 rounded-md border px-3 py-2.5 text-sm leading-relaxed",
        STATE_CLASSES[kind],
      )}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" ? "true" : undefined}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}
