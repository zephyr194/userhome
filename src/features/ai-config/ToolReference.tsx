import { useCallback, useEffect, useState } from "react";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { CheckboxField, SelectField, TextField } from "../../components/ui/forms";
import type { AiToolId } from "../../ipc/aiConfig";
import {
  getToolReference,
  type ReferenceListing,
  type ReferenceResource,
  type ReferenceSetting,
  type ToolReference as ToolReferenceData,
} from "../../ipc/aiConfigReference";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  COVERAGE_LABELS,
  COVERAGE_TONES,
  LAYER_LABELS,
  REFERENCE_BANNER_TEXT,
  REFERENCE_PAGE_SIZE,
  RISK_LABELS,
  VALUE_TYPE_FILTER_OPTIONS,
  VALUE_TYPE_LABELS,
  filterSettings,
  formatVersionNote,
  listingStatusText,
  nextShownCount,
  visiblePage,
  type ValueTypeFilter,
} from "./toolReferenceModel";

export type ToolReferenceState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly reference: ToolReferenceData }
  | { readonly status: "failed"; readonly error: AppError };

export interface ToolReferenceProps {
  readonly toolId: AiToolId;
}

/** Callers key this by tool id, so each tool starts from a fresh, unfiltered list. */
export function ToolReference({ toolId }: ToolReferenceProps) {
  const [state, setState] = useState<ToolReferenceState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    getToolReference(toolId).then(
      (reference) => {
        if (current) setState({ status: "ready", reference });
      },
      (error: unknown) => {
        if (current) setState({ status: "failed", error: decodeAppError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [toolId, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  return <ToolReferenceView state={state} onRetry={retry} />;
}

export function ToolReferenceView({
  state,
  onRetry,
}: {
  readonly state: ToolReferenceState;
  readonly onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在读取官方设置参考……
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <Panel role="alert" className="grid justify-items-start gap-ui-8 p-ui-12">
        <p className="m-0 text-body font-semibold text-danger">无法读取官方设置参考</p>
        <p className="m-0 text-body">{state.error.message}</p>
        <Button onClick={onRetry}>重试</Button>
      </Panel>
    );
  }
  return <ReferenceContent reference={state.reference} />;
}

function ReferenceContent({ reference }: { readonly reference: ToolReferenceData }) {
  return (
    <section
      aria-label={`${reference.displayName} 官方设置参考`}
      className="grid min-w-0 content-start gap-ui-12"
    >
      <Panel className="grid gap-ui-8 p-ui-12">
        <h3 className="m-0 text-group font-semibold">官方设置参考</h3>
        <p role="note" className="m-0 text-body font-semibold">
          {REFERENCE_BANNER_TEXT}
        </p>
        <p className="m-0 text-aux text-muted-foreground">
          来源：<span className="break-all font-mono">{reference.source.url}</span>（
          {formatVersionNote(reference)}）
        </p>
      </Panel>

      {reference.notices.length > 0 ? (
        <ul aria-label="官方提示" className="m-0 grid list-none gap-ui-8 p-0">
          {reference.notices.map((notice) => (
            <li
              key={notice}
              className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft p-ui-12 text-body text-warning-text"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                <span aria-hidden="true" className="font-semibold">
                  ⚠
                </span>
                <StatusBadge tone="warning">需注意</StatusBadge>
              </div>
              <p className="m-0">{notice}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <ResourceList resources={reference.resources} />
      <CoverageSummary flags={reference.flagsCoverage} env={reference.envCoverage} />
      <SettingsList settings={reference.settings} />
    </section>
  );
}

function ResourceList({ resources }: { readonly resources: readonly ReferenceResource[] }) {
  return (
    <section aria-labelledby="ai-reference-resources" className="grid min-w-0 gap-ui-8">
      <h3 id="ai-reference-resources" className="m-0 text-body font-semibold">
        来源资源（{resources.length}）
      </h3>
      <ul aria-label="来源资源列表" className="m-0 grid list-none gap-ui-8 p-0">
        {resources.map((resource) => (
          <li key={resource.id} className="grid min-w-0 gap-ui-4 border-t border-border pt-ui-8">
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <code className="break-all text-aux font-semibold">{resource.id}</code>
              <StatusBadge tone={COVERAGE_TONES[resource.coverage]}>
                {COVERAGE_LABELS[resource.coverage]}
              </StatusBadge>
              {resource.metadataOnly ? <StatusBadge tone="neutral">仅元数据</StatusBadge> : null}
            </div>
            <p className="m-0 break-all text-aux text-muted-foreground">
              {LAYER_LABELS[resource.layer]} · {resource.format} ·{" "}
              <code className="font-mono">{resource.location}</code>
            </p>
            <p className="m-0 text-aux">
              {resource.description}
              {resource.descriptionTruncated ? "（说明已截断，完整内容见官方来源）" : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoverageSummary({
  flags,
  env,
}: {
  readonly flags: ReferenceListing;
  readonly env: ReferenceListing;
}) {
  return (
    <section aria-labelledby="ai-reference-coverage" className="grid min-w-0 gap-ui-4">
      <h3 id="ai-reference-coverage" className="m-0 text-body font-semibold">
        命令行参数与环境变量覆盖
      </h3>
      <ListingLine label="命令行参数" listing={flags} />
      <ListingLine label="环境变量" listing={env} />
    </section>
  );
}

function ListingLine({ label, listing }: { readonly label: string; readonly listing: ReferenceListing }) {
  return (
    <p className="m-0 break-words text-aux">
      {label}：{listingStatusText(listing.snapshotComplete)}
      {listing.coverageNote ? `。${listing.coverageNote}` : ""}
      {listing.coverageNoteTruncated ? "（说明已截断）" : ""}
      <span className="text-muted-foreground">
        {" "}
        来源：<span className="break-all font-mono">{listing.sourceUrl}</span>
      </span>
    </p>
  );
}

function SettingsList({ settings }: { readonly settings: readonly ReferenceSetting[] }) {
  const [query, setQuery] = useState("");
  const [valueType, setValueType] = useState<ValueTypeFilter>("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [shown, setShown] = useState(REFERENCE_PAGE_SIZE);

  const filtered = filterSettings(settings, { query, valueType, riskOnly });
  const page = visiblePage(filtered, shown);

  return (
    <section aria-labelledby="ai-reference-settings" className="grid min-w-0 gap-ui-8">
      <h3 id="ai-reference-settings" className="m-0 text-body font-semibold">
        设置清单（{filtered.length} / {settings.length}）
      </h3>
      <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
        <TextField
          label="搜索键名或描述"
          className="min-w-0 flex-1"
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
        <SelectField<ValueTypeFilter>
          label="按类型"
          value={valueType}
          options={VALUE_TYPE_FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onValueChange={(next) => {
            setValueType(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
        <CheckboxField
          label="只看有风险或敏感的键"
          checked={riskOnly}
          onCheckedChange={(next) => {
            setRiskOnly(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          没有匹配的设置键。
        </p>
      ) : (
        <ul aria-label="官方设置键" className="m-0 grid list-none gap-ui-8 p-0">
          {page.visible.map((setting) => (
            <SettingRow key={setting.id} setting={setting} />
          ))}
        </ul>
      )}

      {page.hasMore ? (
        <div>
          <Button variant="secondary" onClick={() => setShown(nextShownCount(shown, filtered.length))}>
            显示更多（还有 {page.remaining} 项）
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SettingRow({ setting }: { readonly setting: ReferenceSetting }) {
  return (
    <li className="grid min-w-0 gap-ui-4 border-t border-border pt-ui-8">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <code className="break-all text-aux font-semibold">{setting.keyPath}</code>
        <StatusBadge tone="neutral">{VALUE_TYPE_LABELS[setting.valueType]}</StatusBadge>
        {setting.risks.map((risk) => (
          <StatusBadge key={risk} tone="warning">
            {RISK_LABELS[risk]}
          </StatusBadge>
        ))}
        {setting.secret ? <StatusBadge tone="danger">敏感</StatusBadge> : null}
      </div>
      <p className="m-0 text-aux">
        {setting.description}
        {setting.descriptionTruncated ? "（说明已截断，完整内容见官方来源）" : ""}
      </p>
      <p className="m-0 break-words text-aux text-muted-foreground">
        默认值：{setting.defaultNote}
        {setting.defaultNoteTruncated ? "（已截断）" : ""}
      </p>
      {setting.valueType === "enum" ? (
        <p className="m-0 break-words text-aux text-muted-foreground">
          可选值：{setting.allowedValues.join("、")}
        </p>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        覆盖：{COVERAGE_LABELS[setting.coverage]}
      </p>
    </li>
  );
}
