import { AsyncState } from "../../components/AsyncState";
import type { DiscoveryState } from "../../app/shellState";
import { SystemSummary } from "./SystemSummary";

export function DashboardPage({ state }: { state: DiscoveryState }) {
  if (state.status === "loading") {
    return (
      <section
        className="dashboard-panel"
        aria-labelledby="dashboard-heading"
        aria-busy="true"
      >
        <p className="section-kicker">本机发现</p>
        <h2 id="dashboard-heading">这台 Mac</h2>
        <AsyncState kind="loading">正在读取本机元数据…</AsyncState>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="dashboard-panel" aria-labelledby="dashboard-heading">
        <p className="section-kicker">本机发现</p>
        <h2 id="dashboard-heading">本机状态暂不可用</h2>
        <AsyncState kind="error">{state.error.message}</AsyncState>
      </section>
    );
  }

  const { snapshot } = state;
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">本机发现</p>
          <h2 id="dashboard-heading">这台 Mac</h2>
        </div>
        {snapshot.system.status === "READY" &&
        snapshot.system.data.completeness === "PARTIAL" ? (
          <span className="state-label state-label--partial">部分结果</span>
        ) : null}
      </div>

      {snapshot.system.status === "LOADING" ? (
        <AsyncState kind="loading">正在读取本机元数据…</AsyncState>
      ) : snapshot.system.status === "ERROR" ? (
        <AsyncState kind="error">{snapshot.system.error.message}</AsyncState>
      ) : (
        <SystemSummary summary={snapshot.system.data} />
      )}

      <div className="dashboard-brew">
        <h3>Homebrew</h3>
        {snapshot.brew.status === "LOADING" ? (
          <AsyncState kind="loading">正在后台读取软件清单…</AsyncState>
        ) : snapshot.brew.status === "ERROR" ? (
          <AsyncState kind="error">{snapshot.brew.error.message}</AsyncState>
        ) : snapshot.brew.data.available ? (
          <p>
            {snapshot.brew.data.version} · Formula{" "}
            {snapshot.brew.data.formulaCount} 项 · Cask{" "}
            {snapshot.brew.data.caskCount} 项
          </p>
        ) : (
          <AsyncState kind="empty">
            未检测到受信任的 Homebrew 安装。
          </AsyncState>
        )}
      </div>
    </section>
  );
}
