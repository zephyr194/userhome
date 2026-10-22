import { StatusBadge } from "../../components/ui";
import type {
  DetectionEvidence,
  DetectionStatus,
  SystemSummary as SystemSummaryData,
} from "../../ipc/discovery";

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
      strokeLinejoin="round"
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
    <div className="dashboard-system-summary">
      <section aria-labelledby="machine-summary-heading">
        <header className="dashboard-subgroup-heading">
          <div className="min-w-0">
            <h4 id="machine-summary-heading">机器信息</h4>
            <p>当前登录环境</p>
          </div>
          <StatusBadge
            className="shrink-0"
            tone={summary.completeness === "COMPLETE" ? "success" : "warning"}
          >
            {summary.completeness === "COMPLETE" ? "完整" : "部分可用"}
          </StatusBadge>
        </header>

        <dl className="dashboard-machine-rows">
          <div>
            <dt>macOS</dt>
            <dd>{summary.osVersion ?? "不可用"}</dd>
          </div>
          <div>
            <dt>架构</dt>
            <dd>{summary.architecture ?? "不可用"}</dd>
          </div>
          <div>
            <dt>用户目录</dt>
            <dd>{summary.homeDirectory}</dd>
          </div>
          <div>
            <dt>登录 Shell</dt>
            <dd>{summary.shell ?? "不可用"}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="applications-summary-heading">
        <header className="dashboard-subgroup-heading">
          <div className="min-w-0">
            <h4 id="applications-summary-heading">应用检测</h4>
            <p>
              已识别 {detected.length}/{summary.applications.length} 个应用
            </p>
          </div>
        </header>

        {summary.applications.length === 0 ? (
          <div
            className="flex min-w-0 items-start gap-ui-8 border-t border-border pt-ui-8"
            role="status"
          >
            <PresenceIcon present={false} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
                <strong className="min-w-0 text-xs">应用检测结果</strong>
                <StatusBadge className="shrink-0">无数据</StatusBadge>
              </div>
              <p className="mt-ui-4 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                本次发现未返回应用检测条目。
              </p>
            </div>
          </div>
        ) : (
          <details className="dashboard-applications">
            <summary>
              <span>查看检测证据</span>
              <span className="dashboard-counts">
                完整 <strong>{fullyDetected}</strong>
                <span aria-hidden="true">·</span>
                部分 <strong>{partial}</strong>
              </span>
            </summary>
            <ul className="dashboard-application-rows">
              {summary.applications.map((application) => (
                <li key={application.appId}>
                  <div className="dashboard-application-row__heading flex-wrap">
                    <strong
                      className="min-w-0 break-words"
                      title={application.displayName}
                    >
                      {application.displayName}
                    </strong>
                    <StatusBadge
                      className="shrink-0"
                      tone={APPLICATION_STATUS[application.status].tone}
                    >
                      {APPLICATION_STATUS[application.status].label}
                    </StatusBadge>
                  </div>
                  {application.evidence.length === 0 ? (
                    <p className="mt-ui-4 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                      未返回检测证据。
                    </p>
                  ) : (
                    <ul>
                      {application.evidence.map((evidence) => (
                        <li key={`${evidence.kind}-${evidence.label}`}>
                          <PresenceIcon present={evidence.present} />
                          <span className="min-w-0 break-words">
                            <strong>{evidenceLabel(evidence)}</strong>：
                            {evidence.path?.displayPath ?? evidence.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
