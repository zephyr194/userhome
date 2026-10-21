import type { ReactNode } from "react";
import { classNames } from "./ui/classNames";

type AsyncStateKind = "loading" | "empty" | "partial" | "error";

const STATE_CLASSES: Record<AsyncStateKind, string> = {
  loading: "bg-surface-muted text-muted-foreground",
  empty: "bg-surface text-muted-foreground",
  partial: "bg-warning-soft text-warning",
  error: "bg-danger-soft text-danger",
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
        "mt-ui-3xl rounded-control px-ui-xl py-ui-lg text-body leading-relaxed state-transition",
        STATE_CLASSES[kind],
      )}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" ? "true" : undefined}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {kind === "partial" || kind === "error" ? (
        <strong className="mr-ui-sm">
          {kind === "error" ? "错误：" : "注意："}
        </strong>
      ) : null}
      {children}
    </div>
  );
}
