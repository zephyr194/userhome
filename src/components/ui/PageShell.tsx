import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { classNames } from "./classNames";
import { createScrollMemory } from "./pageScrollMemory";

export type PageShellLayout = "strip" | "board" | "master-detail";
export type PageShellStatusTone = "neutral" | "success" | "warning" | "danger";
export type BoardSpan = 4 | 6 | 8 | 12;

export interface PageShellStatus {
  tone?: PageShellStatusTone;
  text: ReactNode;
}

export interface PageShellProps {
  title?: ReactNode;
  status?: PageShellStatus;
  actions?: ReactNode;
  layout: PageShellLayout;
  /** Each scrollKey keeps its own body offset; switching keys restores the one it left. */
  scrollKey?: string;
  children?: ReactNode;
}

export function PageShell({
  title,
  status,
  actions,
  layout,
  scrollKey,
  children,
}: PageShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollMemory] = useState(() => createScrollMemory(scrollKey ?? ""));

  useLayoutEffect(() => {
    if (scrollKey === undefined || !bodyRef.current) return;
    bodyRef.current.scrollTop = scrollMemory.switchTo(scrollKey);
  }, [scrollKey, scrollMemory]);

  const hasHeader = title !== undefined || status !== undefined || actions !== undefined;

  return (
    <section className="page-shell">
      {hasHeader ? (
        <header className="page-shell__header">
          {title !== undefined ? <h1 className="page-shell__title">{title}</h1> : null}
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
        </header>
      ) : null}
      <div
        className="page-shell__body"
        onScroll={(event) => scrollMemory.record(event.currentTarget.scrollTop)}
        ref={bodyRef}
      >
        <div className={`page-shell__layout page-shell__layout--${layout}`}>{children}</div>
      </div>
    </section>
  );
}

export function BoardCell({
  span,
  hidden,
  children,
}: {
  span: BoardSpan;
  hidden?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`page-shell__cell page-shell__cell--span-${span}`} hidden={hidden}>
      {children}
    </div>
  );
}

/** Wraps a region as a grid so its children keep the same layout in every page. */
export function PageRegion({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={classNames("grid min-h-0 min-w-0", className)}>
      {children}
    </div>
  );
}
