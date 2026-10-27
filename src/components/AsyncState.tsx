import type { ReactNode } from "react";
import { useT } from "../i18n/useLocale";
import { classNames } from "./ui/classNames";
import { Skeleton } from "./ui/Skeleton";

type AsyncStateKind = "loading" | "empty" | "partial" | "error";

const STATE_CLASSES: Record<AsyncStateKind, string> = {
  loading: "bg-surface-muted text-muted-foreground",
  empty: "bg-surface text-muted-foreground",
  partial: "bg-warning-soft text-warning",
  error: "bg-danger-soft text-danger",
};

export function AsyncState({
  action,
  children,
  className,
  flush = false,
  kind,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  kind: AsyncStateKind;
}) {
  const t = useT();
  return (
    <div
      className={classNames(
        "mt-ui-16",
        !flush && "rounded-control",
        "px-ui-12 py-ui-8 text-body leading-relaxed state-transition",
        STATE_CLASSES[kind],
        className,
      )}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" ? "true" : undefined}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {kind === "partial" || kind === "error" ? (
        <strong className="block">
          {kind === "error"
            ? t("common.async.errorPrefix")
            : t("common.async.warningPrefix")}
        </strong>
      ) : null}
      {children}
      {kind === "loading" ? <Skeleton bars={2} className="mt-ui-8" /> : null}
      {action ? <div className="mt-ui-8">{action}</div> : null}
    </div>
  );
}
