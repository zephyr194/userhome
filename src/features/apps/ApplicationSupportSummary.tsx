import { StatusBadge } from "../../components/ui";
import type {
  CatalogPriority,
  DetectionEvidenceKind,
  ManagedAppSourceLicenseStatus,
  ManagedAppSourceReviewStatus,
  ManagedAppSummary,
} from "../../ipc/catalog";

const PRIORITY_LABELS: Record<CatalogPriority, string> = {
  PRIORITY_A: "Priority A",
  PRIORITY_B: "Priority B",
  PRIORITY_C: "Priority C",
};

const EVIDENCE_LABELS: Record<DetectionEvidenceKind, string> = {
  BREW_CASK: "Homebrew Cask",
  BREW_FORMULA: "Homebrew Formula",
  EXECUTABLE: "可执行文件",
  HOMEBREW_PATH: "Homebrew 路径",
  HOME_PATH: "用户路径",
  SERVICE: "用户级服务",
};

const LICENSE_LABELS: Record<ManagedAppSourceLicenseStatus, string> = {
  APPROVED: "许可证已审查",
  REJECTED: "许可证不允许",
  REVIEW_REQUIRED: "许可证待审查",
};

const REVIEW_LABELS: Record<ManagedAppSourceReviewStatus, string> = {
  APPROVED: "维护者已批准",
  PENDING: "维护者待批准",
  REJECTED: "维护者已拒绝",
};

const SOURCE_STALE_BEFORE =
  Date.now() - 90 * 24 * 60 * 60 * 1_000;

export function ApplicationSupportSummary({
  application,
}: {
  application: ManagedAppSummary;
}) {
  const sourceEvidence = application.sourceEvidence ?? [];

  return (
    <section
      className="grid gap-3 rounded-md border border-border bg-surface px-4 py-3"
      aria-labelledby={`support-heading-${application.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          id={`support-heading-${application.id}`}
          className="text-sm font-semibold"
        >
          支持范围说明
        </h3>
        <StatusBadge>{PRIORITY_LABELS[application.priority]}</StatusBadge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {application.coverageClass === "EXCLUDED"
          ? "已明确排除：仅展示分类元数据，不读取配置或执行管理操作。"
          : application.coverageClass === "DETECTED_UNSUPPORTED"
            ? "目前仅支持检测与分类；没有配置读取、编辑或服务管理权限。"
            : application.coverageClass === "MANAGED_READ_ONLY"
              ? "仅支持受管配置的受限读取；不提供写入操作。"
              : "仅允许对明确授权的配置文档执行预览、确认后的写入。"}
      </p>

      <div className="grid gap-3 text-xs leading-relaxed sm:grid-cols-2">
        <div>
          <h4 className="font-semibold text-foreground">检测证据</h4>
          <ul className="mt-1 grid gap-1 text-muted-foreground">
            {application.detectionEvidence.map((evidence) => (
              <li key={`${evidence.kind}:${evidence.value}`}>
                <span>{EVIDENCE_LABELS[evidence.kind]}：</span>
                <code className="break-all">{evidence.value}</code>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-foreground">当前限制</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {application.support.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-foreground">明确排除</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {application.support.exclusions.map((exclusion) => (
              <li key={exclusion}>{exclusion}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-foreground">增加支持需要</h4>
          <p className="mt-1 text-muted-foreground">
            {application.support.requirement}
          </p>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold text-foreground">官方来源证据</h4>
        {sourceEvidence.length === 0 ? (
          <p className="mt-1 text-xs text-warning">
            尚无已确认的官方来源；该记录仅用于本机检测，不授予任何操作权限。
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {sourceEvidence.map((evidence) => {
              const stale =
                evidence.verifiedAt !== undefined &&
                Date.parse(evidence.verifiedAt) < SOURCE_STALE_BEFORE;
              return (
                <li
                  className="min-w-0 rounded-control border border-border bg-surface-muted px-3 py-2"
                  key={evidence.url}
                >
                  <code className="block break-all text-xs text-foreground">
                    {evidence.url}
                  </code>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge
                      tone={
                        evidence.reviewStatus === "APPROVED"
                          ? "success"
                          : evidence.reviewStatus === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {REVIEW_LABELS[evidence.reviewStatus]}
                    </StatusBadge>
                    <StatusBadge
                      tone={
                        evidence.licenseStatus === "APPROVED"
                          ? "success"
                          : evidence.licenseStatus === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {LICENSE_LABELS[evidence.licenseStatus]}
                    </StatusBadge>
                    {stale ? (
                      <StatusBadge tone="danger">证据已超过 90 天</StatusBadge>
                    ) : null}
                  </div>
                  {evidence.contentSha256 ? (
                    <p className="mt-2 break-all text-[11px] text-muted-foreground">
                      SHA-256：{evidence.contentSha256}
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      未捆绑不可变 revision/digest，仅作为待审查来源提示。
                    </p>
                  )}
                  {evidence.verifiedAt ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      验证时间：{evidence.verifiedAt}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          来源证据与读写、命令、服务及提权权限严格分离。
        </p>
      </div>
    </section>
  );
}
