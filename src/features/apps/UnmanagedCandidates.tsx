import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type { ManagedAppCoverageClass } from "../../ipc/catalog";
import type {
  CandidateKind,
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import { ApplicationIcon } from "./ApplicationIcon";

const COVERAGE_PRESENTATION: Record<
  ManagedAppCoverageClass,
  { label: string; tone: "neutral" | "warning" }
> = {
  MANAGED_WRITABLE: { label: "受管可写", tone: "neutral" },
  MANAGED_READ_ONLY: { label: "受管只读", tone: "neutral" },
  DETECTED_UNSUPPORTED: { label: "已发现，暂不支持", tone: "warning" },
  EXCLUDED: { label: "已排除", tone: "warning" },
};

const KIND_LABELS: Record<CandidateKind, string> = {
  FILE: "文件",
  DIRECTORY: "目录",
  SYMLINK: "符号链接",
  SOCKET: "套接字",
  OTHER: "其他",
};

function formatModifiedTime(value?: number) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "不可用";
}

function CandidateDetails({ candidate }: { candidate: UnmanagedCandidate }) {
  const coverage = COVERAGE_PRESENTATION[candidate.coverageClass];
  return (
    <article className="h-full min-h-0 overflow-y-auto overscroll-contain bg-surface">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted text-muted-foreground">
            <ApplicationIcon className="size-7" iconKey="candidate" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-all text-lg font-semibold tracking-tight">
                {candidate.name}
              </h2>
              <StatusBadge tone={coverage.tone}>{coverage.label}</StatusBadge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              未受管候选项仅用于安全分类，不会读取其内容。
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-5">
        <section
          className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3"
          aria-labelledby="candidate-boundary-heading"
        >
          <h3 id="candidate-boundary-heading" className="text-sm font-semibold">
            元数据边界
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            此候选项没有 catalog 内容读取或写入授权。UserHome
            仅保留名称、类型、覆盖分类与修改时间。
          </p>
        </section>

        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">条目类型</dt>
            <dd className="mt-1 text-sm font-medium">
              {KIND_LABELS[candidate.kind]}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">修改时间</dt>
            <dd className="mt-1 text-sm font-medium">
              {formatModifiedTime(candidate.modifiedAtEpochMs)}
            </dd>
          </div>
          <div className="col-span-2 rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">访问级别</dt>
            <dd className="mt-1 text-sm font-medium">仅元数据</dd>
          </div>
        </dl>

        <AsyncState kind="empty">
          此处没有打开、读取、编辑、备份或服务管理操作。
        </AsyncState>
      </div>
    </article>
  );
}

export function UnmanagedCandidates({
  selectedCandidate,
  state,
}: {
  selectedCandidate?: UnmanagedCandidate;
  state: ModuleSnapshot<readonly UnmanagedCandidate[]>;
}) {
  if (selectedCandidate) {
    return <CandidateDetails candidate={selectedCandidate} />;
  }

  return (
    <section
      className="candidate-panel"
      aria-labelledby="candidate-heading"
      aria-busy={state.status === "LOADING" ? "true" : undefined}
    >
      <div className="panel-heading">
        <div>
          <p className="section-kicker">只读候选项</p>
          <h2 id="candidate-heading">未受管的配置条目</h2>
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
            仅显示名称、类型、覆盖分类与修改时间；UserHome
            不读取候选条目内容。
          </p>
          <ul className="candidate-list">
            {state.data.map((candidate) => {
              const coverage = COVERAGE_PRESENTATION[candidate.coverageClass];
              return (
                <li key={candidate.name}>
                  <span>
                    <strong>{candidate.name}</strong>
                    <span>
                      {KIND_LABELS[candidate.kind]} ·{" "}
                      {formatModifiedTime(candidate.modifiedAtEpochMs)}
                    </span>
                  </span>
                  <StatusBadge tone={coverage.tone}>
                    {coverage.label}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
