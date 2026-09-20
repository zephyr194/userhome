import { Panel, StatusBadge, type StatusBadgeProps } from "../../components/ui";
import type { ConfigDocument } from "../../ipc/config";

const SENSITIVITY_DETAILS: Record<
  ConfigDocument["sensitivity"],
  { label: string; tone: StatusBadgeProps["tone"] }
> = {
  STANDARD: { label: "标准", tone: "neutral" },
  SENSITIVE: { label: "敏感", tone: "warning" },
  SECRET: { label: "秘密", tone: "danger" },
};

const WRITE_POLICY_LABELS: Record<ConfigDocument["writePolicy"], string> = {
  MANAGED_BLOCK: "受管区块",
  READ_ONLY: "只读",
  STRUCTURED_AND_RAW: "结构化与原始写入",
  RAW_VALIDATED: "校验后原始写入",
};

export function ConfigDetails({ document }: { document: ConfigDocument }) {
  const sensitivity = SENSITIVITY_DETAILS[document.sensitivity];

  return (
    <Panel className="min-w-0 p-4" aria-labelledby="config-details-heading">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            配置详情
          </p>
          <h3
            className="mt-1 break-words text-lg font-semibold"
            id="config-details-heading"
          >
            {document.configId}
          </h3>
        </div>
        <StatusBadge tone={sensitivity.tone}>
          {sensitivity.label}
        </StatusBadge>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-surface-muted px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">路径</dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {document.displayPath}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">权限</dt>
          <dd className="mt-1 text-sm font-medium">
            {document.mode === undefined
              ? "不可用"
              : document.mode.toString(8)}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">大小</dt>
          <dd className="mt-1 text-sm font-medium">
            {document.sizeBytes === undefined
              ? "不可用"
              : `${document.sizeBytes} bytes`}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">格式</dt>
          <dd className="mt-1 text-sm font-medium">{document.format}</dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">写入策略</dt>
          <dd className="mt-1 text-sm font-medium">
            {WRITE_POLICY_LABELS[document.writePolicy]}
          </dd>
        </div>
      </dl>
      {document.symlink && (
        <p className="mt-3 break-all rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          符号链接目标：
          <span className="font-mono">{document.symlink.targetDisplayPath}</span>
        </p>
      )}
      {document.content === undefined ? (
        <p
          className="mt-4 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground"
          role="status"
        >
          此配置仅显示元数据，内容不会离开 Rust 边界。
        </p>
      ) : (
        <section
          className="mt-4 min-w-0"
          aria-labelledby="config-content-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold" id="config-content-heading">
              当前内容
            </h4>
            <span className="text-xs text-muted-foreground">
              只读快照
            </span>
          </div>
          {document.contentRedacted && (
            <p
              className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
              role="status"
            >
              可能包含秘密的行已隐藏。
            </p>
          )}
          <pre
            aria-label="当前配置内容，可滚动"
            className="mt-2 max-h-80 min-w-0 overflow-auto overscroll-contain rounded-md bg-neutral-950 p-3 font-mono text-xs leading-relaxed whitespace-pre text-neutral-100"
            tabIndex={0}
          >
            {document.content}
          </pre>
        </section>
      )}
    </Panel>
  );
}
