import { AsyncState } from "../../components/AsyncState";
import type {
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";

export function UnmanagedCandidates({
  state,
}: {
  state: ModuleSnapshot<readonly UnmanagedCandidate[]>;
}) {
  return (
    <section
      className="candidate-panel"
      aria-labelledby="candidate-heading"
      aria-busy={state.status === "LOADING" ? "true" : undefined}
    >
      <div className="panel-heading">
        <div>
          <p className="section-kicker">只读候选项</p>
          <h2 id="candidate-heading">未受管的点目录</h2>
        </div>
        {state.status === "READY" ? <p>{state.data.length} 项</p> : null}
      </div>
      {state.status === "LOADING" ? (
        <AsyncState kind="loading">正在扫描浅层目录元数据…</AsyncState>
      ) : state.status === "ERROR" ? (
        <AsyncState kind="error">{state.error.message}</AsyncState>
      ) : state.data.length === 0 ? (
        <AsyncState kind="empty">没有发现未受管候选项。</AsyncState>
      ) : (
        <>
          <p className="panel-note">
            仅显示名称、类型与修改时间；UserHome 不读取候选目录内容。
          </p>
          <ul className="candidate-list">
            {state.data.map((candidate) => (
              <li key={candidate.name}>
                <strong>{candidate.name}</strong>
                <span>
                  {candidate.kind === "SYMLINK" ? "符号链接" : "目录"}
                  {candidate.modifiedAtEpochMs
                    ? ` · ${new Intl.DateTimeFormat("zh-CN").format(
                        new Date(candidate.modifiedAtEpochMs),
                      )}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
