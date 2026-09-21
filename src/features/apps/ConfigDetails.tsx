import { Panel, StatusBadge } from "../../components/ui";
import type { ManagedConfigDocumentPresentation } from "../../ipc/catalog";
import type {
  ConfigDocument,
  ConfigVariantResolution,
} from "../../ipc/config";
import {
  ACCESS_MODE_PRESENTATION,
  CONFIG_STATE_PRESENTATION,
  SENSITIVITY_PRESENTATION,
  WRITE_POLICY_LABELS,
} from "./configPresentation";
import { ConfigVariantSelector } from "./ConfigVariantSelector";

const CONTENT_WHITESPACE: Record<
  ManagedConfigDocumentPresentation["formatFamily"],
  string
> = {
  JSON: "whitespace-pre",
  JSONC: "whitespace-pre",
  TOML: "whitespace-pre",
  YAML: "whitespace-pre",
  INI: "whitespace-pre",
  GIT_CONFIG: "whitespace-pre",
  KEY_VALUE: "whitespace-pre",
  PLIST: "whitespace-pre",
  COMMAND: "whitespace-pre",
  PLAIN_TEXT: "whitespace-pre-wrap",
};

export function ConfigDetails({
  document,
  presentation,
  variants,
  disabled = false,
  showContent = true,
  contentUnavailableMessage,
  onVariantChange,
}: {
  document: ConfigDocument;
  presentation: ManagedConfigDocumentPresentation;
  variants: readonly ConfigVariantResolution[];
  disabled?: boolean;
  showContent?: boolean;
  contentUnavailableMessage?: string;
  onVariantChange: (variantId: string) => void;
}) {
  const sensitivity = SENSITIVITY_PRESENTATION[document.sensitivity];
  const state = CONFIG_STATE_PRESENTATION[document.state];
  const access = ACCESS_MODE_PRESENTATION[presentation.accessMode];

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
            {presentation.purpose}
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          <StatusBadge tone={sensitivity.tone}>{sensitivity.label}</StatusBadge>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-surface-muted px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">路径</dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {document.displayPath}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">访问模式</dt>
          <dd className="mt-1 text-sm font-medium">{access.label}</dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">文件权限</dt>
          <dd className="mt-1 text-sm font-medium">
            {document.mode === undefined
              ? "不可用"
              : document.mode.toString(8)}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">格式</dt>
          <dd className="mt-1 text-sm font-medium">
            {presentation.format} · {presentation.formatFamily}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">大小</dt>
          <dd className="mt-1 text-sm font-medium">
            {document.sizeBytes === undefined
              ? "不可用"
              : `${document.sizeBytes} / ${presentation.maxSizeBytes} bytes`}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">写入策略</dt>
          <dd className="mt-1 text-sm font-medium">
            {WRITE_POLICY_LABELS[document.writePolicy]}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {access.description}
      </p>
      {document.symlink && (
        <p className="mt-3 break-all rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          符号链接目标：
          <span className="font-mono">{document.symlink.targetDisplayPath}</span>
        </p>
      )}
      <div className="mt-4">
        <ConfigVariantSelector
          currentVariantId={document.variantId}
          disabled={disabled}
          variants={variants}
          onChange={onVariantChange}
        />
      </div>
      {!showContent || document.content === undefined ? (
        <p
          className="mt-4 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground"
          role="status"
        >
          {!showContent
            ? (contentUnavailableMessage ??
              "当前 catalog 访问模式仅允许元数据，界面不会显示内容。")
            : "后端仅返回元数据，配置内容不会离开 Rust 边界。"}
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
              {presentation.formatFamily} · 只读快照
            </span>
          </div>
          {document.contentRedacted && (
            <p
              className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
              role="status"
            >
              敏感字段、值或不安全内容已被屏蔽。
            </p>
          )}
          <pre
            aria-label="当前配置内容，可滚动"
            className={`mt-2 max-h-80 min-w-0 overflow-auto overscroll-contain rounded-md bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100 ${CONTENT_WHITESPACE[presentation.formatFamily]}`}
            tabIndex={0}
          >
            {document.content}
          </pre>
        </section>
      )}
    </Panel>
  );
}
