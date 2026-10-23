import type { ReactNode } from "react";
import { useT } from "../i18n/useLocale";

interface DesktopWorkspaceProps {
  banner?: ReactNode;
  detail: ReactNode;
  detailLabel: string;
  inspector?: ReactNode;
  inspectorLabel?: string;
  list?: ReactNode;
  listLabel?: string;
  operationProgress?: ReactNode;
  sidebar: ReactNode;
  toolbar: ReactNode;
}

export function DesktopWorkspace({
  banner,
  detail,
  detailLabel,
  inspector,
  inspectorLabel,
  list,
  listLabel,
  operationProgress,
  sidebar,
  toolbar,
}: DesktopWorkspaceProps) {
  const t = useT();
  const paneClassName = [
    "desktop-workspace__panes",
    list ? "desktop-workspace__panes--with-list" : "",
    inspector ? "desktop-workspace__panes--with-inspector" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="desktop-workspace">
      <div className="desktop-workspace__sidebar">{sidebar}</div>
      <main
        id="main-content"
        className="desktop-workspace__main"
        tabIndex={-1}
      >
        <header
          className="desktop-workspace__toolbar"
          aria-label={t("shell.workspace.toolbar")}
        >
          {toolbar}
        </header>
        <div
          className="desktop-workspace__banner min-w-0 break-words"
          hidden={!banner}
        >
          {banner}
        </div>
        <div className={paneClassName} key="panes">
          {list ? (
            <section
              key="list"
              className="desktop-workspace__list min-w-0 min-h-0"
              aria-label={listLabel ?? t("shell.workspace.list")}
            >
              {list}
            </section>
          ) : null}
          <section
            key="detail"
            className="desktop-workspace__detail min-w-0 min-h-0"
            aria-label={detailLabel}
          >
            {detail}
          </section>
          {inspector ? (
            <aside
              key="inspector"
              className="desktop-workspace__inspector min-w-0 min-h-0"
              aria-label={inspectorLabel ?? t("shell.workspace.inspector")}
            >
              {inspector}
            </aside>
          ) : null}
        </div>
        {operationProgress ? (
          <section
            className="desktop-workspace__operation-progress min-w-0 min-h-0"
            aria-label={t("shell.workspace.progress")}
          >
            {operationProgress}
          </section>
        ) : null}
      </main>
    </div>
  );
}
