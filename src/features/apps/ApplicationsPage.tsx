import { AsyncState } from "../../components/AsyncState";
import type { ApplicationsState } from "../../app/shellState";
import type { ManagedAppCapability } from "../../ipc/catalog";
import type {
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import { UnmanagedCandidates } from "./UnmanagedCandidates";
import { ConfigWorkspace } from "./ConfigWorkspace";

const CAPABILITY_LABELS: Record<ManagedAppCapability, string> = {
  DETECT: "检测",
  READ_CONFIG: "读取配置",
  WRITE_CONFIG: "管理配置",
  MANAGE_SERVICE: "管理服务",
};

interface ApplicationsPageProps {
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>;
  onOperationChanged?: () => void;
  state: ApplicationsState;
}

export function ApplicationsPage({
  candidates,
  onOperationChanged,
  state,
}: ApplicationsPageProps) {
  if (state.status === "loading") {
    return (
      <section
        className="applications-panel"
        aria-labelledby="applications-heading"
        aria-busy="true"
      >
        <p className="section-kicker">受管目录</p>
        <h2 id="applications-heading">已批准的应用</h2>
        <AsyncState kind="loading">正在加载应用目录…</AsyncState>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <div className="stacked-panels">
        <section
          className="applications-panel"
          aria-labelledby="applications-heading"
        >
          <p className="section-kicker">受管目录</p>
          <h2 id="applications-heading">应用目录暂不可用</h2>
          <AsyncState kind="error">{state.error.message}</AsyncState>
        </section>
        <UnmanagedCandidates state={candidates} />
      </div>
    );
  }

  return (
    <div className="stacked-panels">
      <section
        className="applications-panel"
        aria-labelledby="applications-heading"
      >
        <div className="applications-panel__heading">
          <div>
            <p className="section-kicker">
              受管目录 v{state.catalog.schemaVersion}
            </p>
            <h2 id="applications-heading">已批准的应用</h2>
          </div>
          <p>{state.catalog.applications.length} 个定义</p>
        </div>

        {state.catalog.applications.length === 0 ? (
          <AsyncState kind="empty">目录中暂无已批准的应用。</AsyncState>
        ) : (
          <ul className="applications-list" aria-label="已批准的应用列表">
            {state.catalog.applications.map((app) => (
            <li key={app.id}>
              <article className="application-card">
                <div className="application-card__identity">
                  <span className="application-card__icon" aria-hidden="true">
                    {app.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h3>{app.displayName}</h3>
                    <p>{app.description}</p>
                  </div>
                </div>

                <ul
                  className="application-capabilities"
                  aria-label={`${app.displayName} 能力`}
                >
                  {app.capabilities.map((capability) => (
                    <li key={capability}>{CAPABILITY_LABELS[capability]}</li>
                  ))}
                </ul>

                <p className="application-card__metadata">
                  受管文档 {app.managedDocumentCount} 项
                  {app.serviceCount > 0
                    ? ` · 用户级服务 ${app.serviceCount} 项`
                    : ""}
                </p>
              </article>
            </li>
            ))}
          </ul>
        )}
      </section>
      <ConfigWorkspace
        applications={state.catalog.applications}
        onOperationChanged={onOperationChanged}
      />
      <UnmanagedCandidates state={candidates} />
    </div>
  );
}
