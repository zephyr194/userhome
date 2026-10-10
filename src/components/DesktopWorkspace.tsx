import type { ReactNode } from "react";

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
  inspectorLabel = "检查器",
  list,
  listLabel = "项目列表",
  operationProgress,
  sidebar,
  toolbar,
}: DesktopWorkspaceProps) {
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
          aria-label="当前页面工具栏"
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
              aria-label={listLabel}
              tabIndex={0}
            >
              {list}
            </section>
          ) : null}
          <section
            key="detail"
            className="desktop-workspace__detail min-w-0 min-h-0"
            aria-label={detailLabel}
            tabIndex={0}
          >
            {detail}
          </section>
          {inspector ? (
            <aside
              key="inspector"
              className="desktop-workspace__inspector min-w-0 min-h-0"
              aria-label={inspectorLabel}
              tabIndex={0}
            >
              {inspector}
            </aside>
          ) : null}
        </div>
        {operationProgress ? (
          <section
            className="desktop-workspace__operation-progress min-w-0 min-h-0"
            aria-label="操作进度"
            tabIndex={0}
          >
            {operationProgress}
          </section>
        ) : null}
      </main>
    </div>
  );
}
