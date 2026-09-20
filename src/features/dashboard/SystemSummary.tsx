import type {
  DetectionEvidence,
  SystemSummary as SystemSummaryData,
} from "../../ipc/discovery";

function evidenceLabel(evidence: DetectionEvidence): string {
  if (evidence.kind === "CONFIG_PRESENT") {
    return evidence.present ? "配置存在" : "未发现配置";
  }
  return evidence.present ? "命令可用" : "未发现命令";
}

export function SystemSummary({ summary }: { summary: SystemSummaryData }) {
  const detected = summary.applications.filter(
    (application) => application.status !== "ABSENT",
  );

  return (
    <>
      <dl className="summary-grid">
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

      <div className="detected-apps">
        <h3>已识别应用 {detected.length} 个</h3>
        <ul>
          {summary.applications.map((application) => (
            <li key={application.appId}>
              <div>
                <strong>{application.displayName}</strong>
                <span className={`state-label state-label--${application.status.toLowerCase()}`}>
                  {application.status === "DETECTED"
                    ? "已检测"
                    : application.status === "PARTIAL"
                      ? "部分检测"
                      : "未检测"}
                </span>
              </div>
              <ul className="evidence-list">
                {application.evidence.map((evidence) => (
                  <li key={`${evidence.kind}-${evidence.label}`}>
                    {evidenceLabel(evidence)}：{evidence.path?.displayPath ?? evidence.label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
