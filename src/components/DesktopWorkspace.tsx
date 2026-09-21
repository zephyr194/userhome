import type { ReactNode, Ref } from "react";

interface DesktopWorkspaceProps {
  banner?: ReactNode;
  detail: ReactNode;
  detailLabel: string;
  inspector?: ReactNode;
  inspectorLabel?: string;
  list?: ReactNode;
  listLabel?: string;
  mainRef?: Ref<HTMLElement>;
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
  mainRef,
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
        ref={mainRef}
        id="main-content"
        className="desktop-workspace__main"
        tabIndex={-1}
      >
        <header className="desktop-workspace__toolbar">{toolbar}</header>
        {banner ? (
          <div className="desktop-workspace__banner">{banner}</div>
        ) : null}
        <div className={paneClassName}>
          {list ? (
            <section
              className="desktop-workspace__list"
              aria-label={listLabel}
            >
              {list}
            </section>
          ) : null}
          <section
            className="desktop-workspace__detail"
            aria-label={detailLabel}
          >
            {detail}
          </section>
          {inspector ? (
            <aside
              className="desktop-workspace__inspector"
              aria-label={inspectorLabel}
            >
              {inspector}
            </aside>
          ) : null}
        </div>
        {operationProgress ? (
          <section
            className="desktop-workspace__operation-progress"
            aria-label="操作进度"
          >
            {operationProgress}
          </section>
        ) : null}
      </main>
    </div>
  );
}
