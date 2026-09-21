import { StatusBadge } from "../../components/ui";
import type {
  CatalogPriority,
  DetectionEvidenceKind,
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

export function ApplicationSupportSummary({
  application,
}: {
  application: ManagedAppSummary;
}) {
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
    </section>
  );
}
