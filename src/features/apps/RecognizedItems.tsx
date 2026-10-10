import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import type { CandidateModule } from "../../app/discoverySelectors";
import type {
  ManagedAppCoverageClass,
  ManagedAppSummary,
} from "../../ipc/catalog";
import type { AppError } from "../../ipc/core";
import type {
  CandidateEvidence,
  CandidateKind,
  CandidateRootKind,
  CandidateScanOutcomeKind,
  CandidateSensitivityHint,
  ConfigurationCoverage,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import type { PreferredEditorMode } from "../../ipc/settings";
import { ApplicationIcon } from "./ApplicationIcon";
import {
  isManagedCoverageClass,
  type CandidateConfigMatch,
} from "./candidateCatalogMatch";
import { ConfigWorkspace } from "./ConfigWorkspace";

const COVERAGE_PRESENTATION: Record<
  ManagedAppCoverageClass,
  { label: string; tone: "neutral" | "success" | "warning" }
> = {
  MANAGED_WRITABLE: { label: "受管可写", tone: "success" },
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

const ROOT_LABELS: Record<CandidateRootKind, string> = {
  HOME: "用户主目录",
  XDG_CONFIG_HOME: "XDG 配置目录",
  APPLICATION_SUPPORT: "Application Support",
  HOMEBREW_PREFIX: "Homebrew 前缀",
  APP_SUPPORT: "应用支持目录",
};

const SENSITIVITY_LABELS: Record<CandidateSensitivityHint, string> = {
  STANDARD: "标准",
  SENSITIVE: "敏感",
  SECRET: "机密",
  UNKNOWN: "未确定",
};

const EVIDENCE_LABELS: Record<CandidateEvidence, string> = {
  METADATA_PRESENT: "元数据存在",
  CATALOG_DOCUMENT: "Catalog 文档匹配",
  CATALOG_SERVICE: "Catalog 服务位置",
  BOUNDED_ROOT_ENTRY: "受限根目录条目",
  SYMLINK_METADATA_ONLY: "仅检查符号链接元数据",
  EXCLUSION_RULE: "命中排除规则",
};

const SCAN_OUTCOME_LABELS: Record<CandidateScanOutcomeKind, string> = {
  COMPLETE: "扫描完成",
  CANDIDATE_LIMIT_REACHED: "达到候选数量上限",
  ENTRY_LIMIT_REACHED: "达到单根条目上限",
  METADATA_LIMIT_REACHED: "达到元数据数量上限",
  PERMISSION_DENIED: "存在权限不足的根",
  SYMLINK_METADATA_ONLY: "符号链接仅检查元数据",
  TIMEOUT: "扫描超时",
  METADATA_UNAVAILABLE: "元数据不可用",
  INVALID_ROOT: "无效的扫描根",
};

const MODULE_STATUS_LABELS: Record<CandidateModule["status"], string> = {
  LOADING: "加载中",
  READY: "就绪",
  ERROR: "错误",
};

function formatModifiedTime(value?: number) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "不可用";
}

function isConfigurationCoverage(
  data: ConfigurationCoverage | readonly UnmanagedCandidate[],
): data is ConfigurationCoverage {
  return !Array.isArray(data);
}

function coverageOf(module: CandidateModule): ConfigurationCoverage | undefined {
  if (module.status !== "READY" || !isConfigurationCoverage(module.data)) {
    return undefined;
  }
  return module.data;
}

function nextActionText({
  applicationPresent,
  candidate,
  match,
  matchError,
}: {
  applicationPresent: boolean;
  candidate: UnmanagedCandidate;
  match?: CandidateConfigMatch;
  matchError?: AppError;
}): string {
  if (isManagedCoverageClass(candidate.coverageClass)) {
    if (matchError) {
      return matchError.message;
    }
    if (!match || (match.kind === "UNIQUE" && !applicationPresent)) {
      return "正在匹配受管配置文档…";
    }
    if (match.kind === "UNIQUE") {
      return `此路径唯一匹配受管配置文档 ${match.configId}，可查看受管配置；读写仍由 Rust appId/configId 授权。`;
    }
    if (match.kind === "AMBIGUOUS") {
      return "此路径匹配多个受管配置文档，未提供打开或写入操作。";
    }
    return "此路径未唯一匹配受管配置文档，未提供打开或写入操作。";
  }
  if (candidate.coverageClass === "DETECTED_UNSUPPORTED") {
    return "catalog 未声明支持此条目；未提供打开、写入、预览、备份、恢复、服务或提权操作。";
  }
  if (candidate.coverageClass === "EXCLUDED") {
    return "此条目被安全策略排除；未提供任何操作。";
  }
  return "无可执行操作。";
}

export interface RecognizedItemsProps {
  candidate: UnmanagedCandidate;
  module: CandidateModule;
  /** Omitted while the managed catalog application is being matched. */
  match?: CandidateConfigMatch;
  application?: ManagedAppSummary;
  matchError?: AppError;
  /** Whether the matched managed config workspace is expanded. */
  opened?: boolean;
  onOpenManagedConfig?: () => void;
  onOperationChanged?: () => void;
  onSelectedConfigChange?: (applicationId: string, configId?: string) => void;
  preferredEditorMode?: PreferredEditorMode;
  refreshId?: string;
}

export function RecognizedItems({
  application,
  candidate,
  match,
  matchError,
  module,
  onOpenManagedConfig,
  onOperationChanged,
  onSelectedConfigChange,
  opened = false,
  preferredEditorMode = "STRUCTURED",
  refreshId,
}: RecognizedItemsProps) {
  const coverage = COVERAGE_PRESENTATION[candidate.coverageClass];
  const managedCandidate = isManagedCoverageClass(candidate.coverageClass);
  const managedApplication = managedCandidate ? application : undefined;
  const uniqueConfigId = match?.kind === "UNIQUE" ? match.configId : undefined;
  const canOpenManaged =
    managedApplication !== undefined && uniqueConfigId !== undefined;
  const scanCoverage = coverageOf(module);

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
                {candidate.displayName}
              </h2>
              <StatusBadge tone={coverage.tone}>{coverage.label}</StatusBadge>
              <StatusBadge tone="neutral">本机识别项</StatusBadge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              本机识别项来自只读候选快照；UserHome 不会读取其内容，只有目录授权的受管文档才提供受控操作。
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-5">
        <dl className="grid grid-cols-2 gap-3">
          <div className="col-span-2 rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">安全相对路径</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {candidate.relativePath}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">发现根</dt>
            <dd className="mt-1 text-sm font-medium">
              {ROOT_LABELS[candidate.rootKind]}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">条目类型</dt>
            <dd className="mt-1 text-sm font-medium">
              {KIND_LABELS[candidate.entryType]}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">覆盖等级</dt>
            <dd className="mt-1 text-sm font-medium">{coverage.label}</dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">敏感度</dt>
            <dd className="mt-1 text-sm font-medium">
              {SENSITIVITY_LABELS[candidate.sensitivityHint]}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">修改时间</dt>
            <dd className="mt-1 text-sm font-medium">
              {formatModifiedTime(candidate.modifiedAtEpochMs)}
            </dd>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">Catalog 归属</dt>
            <dd className="mt-1 text-sm font-medium">
              {candidate.catalogAppId ?? "无"}
            </dd>
          </div>
          <div className="col-span-2 rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">分类证据</dt>
            <dd className="mt-1 text-sm font-medium">
              {candidate.evidence.length > 0
                ? candidate.evidence
                    .map((item) => EVIDENCE_LABELS[item])
                    .join("、")
                : "无"}
            </dd>
          </div>
          <div className="col-span-2 rounded-md border border-border bg-surface-muted p-3">
            <dt className="text-xs text-muted-foreground">分类原因</dt>
            <dd className="mt-1 text-sm leading-relaxed">
              {candidate.classificationReason}
            </dd>
          </div>
        </dl>

        <section
          className="rounded-md border border-border bg-surface-muted p-3"
          aria-labelledby="recognized-scan-heading"
        >
          <h3 id="recognized-scan-heading" className="text-xs text-muted-foreground">
            扫描状态
          </h3>
          <p className="mt-1 text-sm leading-relaxed">
            {scanCoverage
              ? `完整性 ${scanCoverage.completeness === "PARTIAL" ? "部分" : "完整"} · 候选 ${scanCoverage.summary.candidateCount} · 元数据 ${scanCoverage.summary.metadataCount} · 根 ${scanCoverage.summary.rootCount}`
              : "本机发现模块未附带扫描摘要。"}
          </p>
          {scanCoverage && scanCoverage.summary.outcomes.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {scanCoverage.summary.outcomes
                .map((outcome) => SCAN_OUTCOME_LABELS[outcome.kind])
                .join("；")}
            </p>
          ) : null}
        </section>

        <section
          className="rounded-md border border-border bg-surface-muted p-3"
          aria-labelledby="recognized-module-heading"
        >
          <h3 id="recognized-module-heading" className="text-xs text-muted-foreground">
            模块状态
          </h3>
          <p className="mt-1 text-sm leading-relaxed">
            {module.status === "ERROR"
              ? module.error.message
              : `候选模块：${MODULE_STATUS_LABELS[module.status]}`}
          </p>
        </section>

        <section className="rounded-md border border-border bg-surface-muted p-3">
          <h3 className="text-xs text-muted-foreground">下一步操作</h3>
          <p className="mt-1 text-sm leading-relaxed">
            {nextActionText({
              applicationPresent: managedApplication !== undefined,
              candidate,
              match,
              matchError,
            })}
          </p>
        </section>

        {canOpenManaged ? (
          <div
            className="flex items-center gap-2"
            data-testid="candidate-actions"
          >
            <Button
              size="sm"
              disabled={opened}
              onClick={onOpenManagedConfig}
            >
              查看受管配置
            </Button>
            <span className="text-xs text-muted-foreground">
              打开后仍按 Rust appId/configId 授权，不直接使用候选路径。
            </span>
          </div>
        ) : null}

        {opened && canOpenManaged && managedApplication && uniqueConfigId ? (
          <div
            className="min-h-0 overflow-hidden rounded-md border border-border"
            data-testid="recognized-config-workspace"
          >
            <ConfigWorkspace
              key={`${managedApplication.id}:${uniqueConfigId}`}
              application={managedApplication}
              onOperationChanged={onOperationChanged}
              onSelectedConfigChange={
                onSelectedConfigChange ?? (() => undefined)
              }
              preferredEditorMode={preferredEditorMode}
              refreshId={refreshId}
              selectedConfigId={uniqueConfigId}
            />
          </div>
        ) : null}

        {managedCandidate && !canOpenManaged ? (
          <AsyncState kind="empty">
            没有可安全执行的操作：受管路径必须唯一匹配目录配置文档后，才由 Rust 提供受控读写。
          </AsyncState>
        ) : null}
      </div>
    </article>
  );
}
