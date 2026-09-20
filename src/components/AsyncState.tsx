import type { ReactNode } from "react";

type AsyncStateKind = "loading" | "empty" | "error";

export function AsyncState({
  children,
  kind,
}: {
  children: ReactNode;
  kind: AsyncStateKind;
}) {
  return (
    <div
      className={`async-state async-state--${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" ? "true" : undefined}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}
