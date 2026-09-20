import type {
  DetectionEvidence,
  DetectionStatus,
  SystemSummary as SystemSummaryData,
} from "../../ipc/discovery";
import { StatusBadge } from "../../components/ui";

function evidenceLabel(evidence: DetectionEvidence): string {
  if (evidence.kind === "CONFIG_PRESENT") {
    return evidence.present ? "配置存在" : "未发现配置";
  }
  return evidence.present ? "命令可用" : "未发现命令";
}

const APPLICATION_STATUS: Record<
  DetectionStatus,
  { label: string; tone: "neutral" | "success" | "warning" }
> = {
  DETECTED: { label: "已检测", tone: "success" },
  PARTIAL: { label: "部分检测", tone: "warning" },
  ABSENT: { label: "未检测", tone: "neutral" },
};

function PresenceIcon({ present }: { present: boolean }) {
  return present ? (
    <svg
      className="size-3.5 shrink-0 text-success"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8 3 3 7-7" />
    </svg>
  ) : (
    <svg
      className="size-3.5 shrink-0 text-muted-foreground"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m4 4 8 8M12 4 4 12" />
    </svg>
  );
}

export function SystemSummary({ summary }: { summary: SystemSummaryData }) {
  const detected = summary.applications.filter(
    (application) => application.status !== "ABSENT",
  );
  const fullyDetected = summary.applications.filter(
    (application) => application.status === "DETECTED",
  ).length;
  const partial = summary.applications.filter(
    (application) => application.status === "PARTIAL",
  ).length;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(260px,0.72fr)_minmax(360px,1.28fr)]">
      <section
        className="min-w-0 rounded-md border border-border bg-surface-muted"
        aria-labelledby="machine-summary-heading"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 id="machine-summary-heading" className="text-sm font-semibold">
              机器信息
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              当前登录环境
            </p>
          </div>
          <StatusBadge
            tone={summary.completeness === "COMPLETE" ? "success" : "warning"}
          >
            {summary.completeness === "COMPLETE" ? "完整" : "部分可用"}
          </StatusBadge>
        </header>

        <dl className="divide-y divide-border px-4">
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-xs text-muted-foreground">macOS</dt>
            <dd className="min-w-0 text-right text-sm font-semibold">
              {summary.osVersion ?? "不可用"}
            </dd>
          </div>
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-xs text-muted-foreground">架构</dt>
            <dd className="min-w-0 text-right font-mono text-xs font-medium">
              {summary.architecture ?? "不可用"}
            </dd>
          </div>
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-xs text-muted-foreground">用户目录</dt>
            <dd className="min-w-0 break-all text-right font-mono text-xs font-medium">
              {summary.homeDirectory}
            </dd>
          </div>
          <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 py-3">
            <dt className="text-xs text-muted-foreground">登录 Shell</dt>
            <dd className="min-w-0 break-all text-right font-mono text-xs font-medium">
              {summary.shell ?? "不可用"}
            </dd>
          </div>
        </dl>

        {summary.issues.length > 0 ? (
          <div className="border-t border-warning/30 bg-warning/10 px-4 py-3">
            <p className="text-xs font-semibold text-warning">
              {summary.issues.length} 项发现警告
            </p>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {summary.issues.map((issue) => (
                <li key={`${issue.module}-${issue.message}`}>
                  {issue.module}：{issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section
        className="min-w-0 overflow-hidden rounded-md border border-border"
        aria-labelledby="applications-summary-heading"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3
              id="applications-summary-heading"
              className="text-sm font-semibold"
            >
              应用检测
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              已识别 {detected.length}/{summary.applications.length} 个应用
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              完整 <strong className="text-foreground">{fullyDetected}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              部分 <strong className="text-foreground">{partial}</strong>
            </span>
          </div>
        </header>

        <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto overscroll-contain">
          {summary.applications.map((application) => (
            <li key={application.appId} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="min-w-0 truncate text-sm font-semibold">
                  {application.displayName}
                </strong>
                <StatusBadge tone={APPLICATION_STATUS[application.status].tone}>
                  {APPLICATION_STATUS[application.status].label}
                </StatusBadge>
              </div>
              <ul className="mt-2 grid gap-1">
                {application.evidence.map((evidence) => (
                  <li
                    key={`${evidence.kind}-${evidence.label}`}
                    className="flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
                  >
                    <PresenceIcon present={evidence.present} />
                    <span className="min-w-0 break-all">
                      <span className="font-medium text-foreground">
                        {evidenceLabel(evidence)}
                      </span>
                      ：{evidence.path?.displayPath ?? evidence.label}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
