import { Button, Panel, StatusBadge } from "../../components/ui";
import type { ManagedConfigDocumentPresentation } from "../../ipc/catalog";
import type {
  ConfigDiagnostic,
  ConfigVariantResolution,
} from "../../ipc/config";
import {
  ACCESS_MODE_PRESENTATION,
  CONFIG_ACTION_LABELS,
  CONFIG_STATE_PRESENTATION,
} from "./configPresentation";
import { ConfigVariantSelector } from "./ConfigVariantSelector";

export function ConfigDiagnosticDetails({
  diagnostic,
  presentation,
  variants,
  disabled = false,
  onVariantChange,
  onRetry,
}: {
  diagnostic: ConfigDiagnostic;
  presentation: ManagedConfigDocumentPresentation;
  variants: readonly ConfigVariantResolution[];
  disabled?: boolean;
  onVariantChange: (variantId: string) => void;
  onRetry: () => void;
}) {
  const state = CONFIG_STATE_PRESENTATION[diagnostic.state];
  const access = ACCESS_MODE_PRESENTATION[presentation.accessMode];

  return (
    <Panel className="min-w-0 p-4" aria-labelledby="config-diagnostic-heading">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            配置诊断
          </p>
          <h3
            className="mt-1 break-words text-lg font-semibold"
            id="config-diagnostic-heading"
          >
            {presentation.purpose}
          </h3>
        </div>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {state.description}
      </p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-surface-muted px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">路径</dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {diagnostic.displayPath}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">访问模式</dt>
          <dd className="mt-1 text-sm font-medium">{access.label}</dd>
        </div>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">格式能力</dt>
          <dd className="mt-1 text-sm font-medium">
            {presentation.format} · {presentation.formatFamily}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <ConfigVariantSelector
          currentVariantId={diagnostic.variantId}
          disabled={disabled}
          variants={variants}
          onChange={onVariantChange}
        />
      </div>

      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-2.5"
        role={diagnostic.retryable ? "alert" : "status"}
      >
        <p className="text-sm text-muted-foreground">
          下一步：{CONFIG_ACTION_LABELS[diagnostic.nextAction]}
        </p>
        {diagnostic.retryable ? (
          <Button disabled={disabled} onClick={onRetry}>
            重新读取
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
