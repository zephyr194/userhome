import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type { DiscoveryState } from "../../app/shellState";
import { SystemSummary } from "./SystemSummary";

export function DashboardPage({ state }: { state: DiscoveryState }) {
  if (state.status === "loading") {
    return (
      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-5"
        aria-labelledby="dashboard-heading"
        aria-busy="true"
      >
        <p className="section-kicker">本机发现</p>
        <h2
          id="dashboard-heading"
          className="mt-2 text-2xl font-semibold tracking-tight"
        >
          正在构建本机概览
        </h2>
        <AsyncState kind="loading">正在读取本机元数据…</AsyncState>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-5"
        aria-labelledby="dashboard-heading"
      >
        <p className="section-kicker">本机发现</p>
        <h2
          id="dashboard-heading"
          className="mt-2 text-2xl font-semibold tracking-tight"
        >
          本机状态暂不可用
        </h2>
        <AsyncState kind="error">{state.error.message}</AsyncState>
      </section>
    );
  }

  const { snapshot } = state;
  const systemIsPartial =
    snapshot.system.status === "READY" &&
    snapshot.system.data.completeness === "PARTIAL";

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="dashboard-heading">
      <div className="rounded-lg border border-border bg-surface">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="section-kicker">本机发现</p>
            <h2
              id="dashboard-heading"
              className="mt-1 text-xl font-semibold tracking-tight"
            >
              这台 Mac
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              本机身份、应用能力与配置证据
            </p>
          </div>
          {snapshot.system.status === "LOADING" ? (
            <StatusBadge tone="warning">读取中</StatusBadge>
          ) : snapshot.system.status === "ERROR" ? (
            <StatusBadge tone="danger">读取失败</StatusBadge>
          ) : systemIsPartial ? (
            <StatusBadge tone="warning">部分结果</StatusBadge>
          ) : (
            <StatusBadge tone="success">信息完整</StatusBadge>
          )}
        </header>

        <div className="p-4">
          {snapshot.system.status === "LOADING" ? (
            <AsyncState kind="loading">正在读取本机元数据…</AsyncState>
          ) : snapshot.system.status === "ERROR" ? (
            <AsyncState kind="error">{snapshot.system.error.message}</AsyncState>
          ) : (
            <SystemSummary summary={snapshot.system.data} />
          )}
        </div>
      </div>

      <section
        className="rounded-lg border border-border bg-surface px-5 py-4"
        aria-labelledby="homebrew-summary-heading"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface-muted text-primary"
              aria-hidden="true"
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3h8l-1 4H9L8 3Z" />
                <path d="M9 7h6l1.2 12H7.8L9 7Z" />
                <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" />
              </svg>
            </span>
            <div className="min-w-0">
              <h3
                id="homebrew-summary-heading"
                className="text-sm font-semibold"
              >
                Homebrew
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                受信任安装与本机软件包规模
              </p>
            </div>
          </div>
          {snapshot.brew.status === "LOADING" ? (
            <StatusBadge tone="warning">扫描中</StatusBadge>
          ) : snapshot.brew.status === "ERROR" ? (
            <StatusBadge tone="danger">扫描失败</StatusBadge>
          ) : snapshot.brew.data.available ? (
            <StatusBadge tone="success">可用</StatusBadge>
          ) : (
            <StatusBadge>未安装</StatusBadge>
          )}
        </div>

        {snapshot.brew.status === "LOADING" ? (
          <AsyncState kind="loading">正在后台读取软件清单…</AsyncState>
        ) : snapshot.brew.status === "ERROR" ? (
          <AsyncState kind="error">{snapshot.brew.error.message}</AsyncState>
        ) : snapshot.brew.data.available ? (
          <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(72px,0.5fr))]">
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                安装
              </dt>
              <dd className="mt-1 truncate text-sm font-medium">
                {snapshot.brew.data.version ?? "版本不可用"}
              </dd>
              {snapshot.brew.data.prefix ? (
                <dd className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {snapshot.brew.data.prefix}
                </dd>
              ) : null}
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Formula
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {snapshot.brew.data.formulaCount}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Cask
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {snapshot.brew.data.caskCount}
              </dd>
            </div>
          </dl>
        ) : (
          <AsyncState kind="empty">
            未检测到受信任的 Homebrew 安装。
          </AsyncState>
        )}
      </section>
    </section>
  );
}
