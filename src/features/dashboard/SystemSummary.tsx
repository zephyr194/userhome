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
          <div>
            <h4 id="machine-summary-heading">机器信息</h4>
            <p>当前登录环境</p>
          </div>
          <StatusBadge
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

        {summary.issues.length > 0 ? (
          <div className="dashboard-issues" role="status">
            <strong>{summary.issues.length} 项发现警告</strong>
            <ul>
              {summary.issues.map((issue) => (
                <li key={`${issue.module}-${issue.message}`}>
                  {issue.module}：{issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="applications-summary-heading">
        <header className="dashboard-subgroup-heading">
          <div>
            <h4 id="applications-summary-heading">应用检测</h4>
            <p>
              已识别 {detected.length}/{summary.applications.length} 个应用
            </p>
          </div>
          <span className="dashboard-counts">
            完整 <strong>{fullyDetected}</strong>
            <span aria-hidden="true">·</span>
            部分 <strong>{partial}</strong>
          </span>
        </header>

        <ul className="dashboard-application-rows">
          {summary.applications.map((application) => (
            <li key={application.appId}>
              <div className="dashboard-application-row__heading">
                <strong>{application.displayName}</strong>
                <StatusBadge tone={APPLICATION_STATUS[application.status].tone}>
                  {APPLICATION_STATUS[application.status].label}
                </StatusBadge>
              </div>
              <ul>
                {application.evidence.map((evidence) => (
                  <li key={`${evidence.kind}-${evidence.label}`}>
                    <PresenceIcon present={evidence.present} />
                    <span>
                      <strong>{evidenceLabel(evidence)}</strong>：
                      {evidence.path?.displayPath ?? evidence.label}
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
