import type { ReactNode } from "react";
import { classNames } from "./classNames";

export type PageShellLayout = "strip" | "board" | "master-detail";
export type PageShellStatusTone = "neutral" | "success" | "warning" | "danger";
export type BoardSpan = 4 | 6 | 8 | 12;

export interface PageShellStatus {
  tone?: PageShellStatusTone;
  text: ReactNode;
}

export interface PageShellProps {
  title: ReactNode;
  status?: PageShellStatus;
  actions?: ReactNode;
  boardToggle?: ReactNode;
  layout: PageShellLayout;
  children?: ReactNode;
}

export function PageShell({
  title,
  status,
  actions,
  boardToggle,
  layout,
  children,
}: PageShellProps) {
  return (
    <section className="page-shell">
      <header className="page-shell__header">
        <h1 className="page-shell__title">{title}</h1>
        {status ? (
          <span className="page-shell__status">
            <span
              aria-hidden="true"
              className={classNames(
                "page-shell__status-dot",
                `page-shell__status-dot--${status.tone ?? "neutral"}`,
              )}
            />
            <span className="page-shell__status-text">{status.text}</span>
          </span>
        ) : null}
        {actions ? <div className="page-shell__actions">{actions}</div> : null}
        {boardToggle ? <div className="page-shell__board-toggle">{boardToggle}</div> : null}
      </header>
      <div className="page-shell__body">
        <div className={`page-shell__layout page-shell__layout--${layout}`}>{children}</div>
      </div>
    </section>
  );
}

export function BoardCell({ span, children }: { span: BoardSpan; children?: ReactNode }) {
  return <div className={`page-shell__cell page-shell__cell--span-${span}`}>{children}</div>;
}
