import { Button, Panel, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type { AppConfigListItem, AppConfigReadResult } from "../../ipc/appConfig";
import {
  CAPABILITY_LABELS,
  describeEntryDetail,
  describeProbe,
  groupByCategory,
  isFixedLocation,
  type DetailState,
  type ListState,
} from "./appConfigModel";

export interface AppConfigViewProps {
  list: ListState;
  detail: DetailState;
  onReload: () => void;
  onSelect: (id: string) => void;
}

export function AppConfigView({ list, detail, onReload, onSelect }: AppConfigViewProps) {
  const items = list.status === "ready" || list.status === "partial" ? list.items : undefined;
  const selectedId = detail.status === "idle" ? undefined : detail.id;

  return (
    <div className="grid min-w-0 gap-ui-xl">
      <div className="flex flex-wrap items-center justify-between gap-ui-sm">
        <p className="m-0 text-aux text-muted-foreground">
          仅显示默认位置。本页只读，不修改任何文件，也不检查未登记的文件。
        </p>
        {list.status === "loading" ? null : (
          <Button size="sm" onClick={onReload}>
            刷新
          </Button>
        )}
      </div>
      <ListStatusNotice list={list} onReload={onReload} />
      {items ? (
        <div className="grid min-w-0 gap-ui-xl md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <EntryList items={items} selectedId={selectedId} onSelect={onSelect} />
          <EntryDetail items={items} detail={detail} />
        </div>
      ) : null}
    </div>
  );
}

function ListStatusNotice({ list, onReload }: { list: ListState; onReload: () => void }) {
  switch (list.status) {
    case "loading":
      return (
        <p role="status" className="m-0 text-body text-muted-foreground">
          正在检查默认位置……
        </p>
      );
    case "empty":
      return (
        <p role="status" className="m-0 text-body text-muted-foreground">
          没有登记的应用配置条目。
        </p>
      );
    case "partial":
      return (
        <p role="status" className="m-0 text-body">
          有 {list.failedCount} 个条目无法检查（不可访问或越界），其余条目不受影响。
        </p>
      );
    case "error":
      return (
        <Panel role="alert" className="grid gap-ui-sm p-ui-lg">
          <p className="m-0 text-body font-semibold text-danger">无法读取应用配置列表</p>
          <p className="m-0 text-body">{list.error.message}</p>
          <div>
            <Button size="sm" onClick={onReload}>
              重试
            </Button>
          </div>
        </Panel>
      );
    case "ready":
      return null;
  }
}

function EntryList({
  items,
  selectedId,
  onSelect,
}: {
  items: AppConfigListItem[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel aria-labelledby="app-config-list-title" className="grid content-start gap-ui-lg p-ui-lg">
      <h2 id="app-config-list-title" className="m-0 text-group font-semibold">
        条目
      </h2>
      {groupByCategory(items).map((group) => (
        <div key={group.category} className="grid gap-ui-sm">
          <h3 className="m-0 text-meta font-semibold text-muted-foreground">{group.label}</h3>
          <ul className="m-0 grid list-none gap-ui-sm p-0">
            {group.items.map((item) => (
              <EntryRow
                key={item.summary.id}
                item={item}
                selected={item.summary.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function EntryRow({
  item,
  selected,
  onSelect,
}: {
  item: AppConfigListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { summary, probe } = item;
  const badge = describeProbe(probe);
  return (
    <li>
      <Button
        aria-current={selected ? "true" : undefined}
        className={classNames(
          "grid h-auto w-full min-w-0 justify-start gap-ui-xs py-ui-sm text-left",
          selected && "border-primary bg-selection text-selection-foreground",
        )}
        onClick={() => onSelect(summary.id)}
        size="sm"
      >
        <span className="font-medium">{summary.name}</span>
        <span className="break-all text-aux text-muted-foreground">{summary.displayPath}</span>
        <span className="flex flex-wrap gap-ui-xs">
          <StatusBadge tone={badge.tone}>
            <span aria-hidden="true">{badge.symbol} </span>
            {badge.label}
          </StatusBadge>
          <StatusBadge>{CAPABILITY_LABELS[summary.capability]}</StatusBadge>
        </span>
      </Button>
    </li>
  );
}

function EntryDetail({
  items,
  detail,
}: {
  items: AppConfigListItem[];
  detail: DetailState;
}) {
  const headingId = "app-config-detail-title";
  const selected = detail.status === "idle" ? undefined : items.find((item) => item.summary.id === detail.id);

  return (
    <Panel
      role="region"
      aria-labelledby={headingId}
      className="grid content-start gap-ui-lg p-ui-lg"
    >
      <h2 id={headingId} className="m-0 text-group font-semibold">
        {selected ? selected.summary.name : "详情"}
      </h2>
      {selected ? <EntryFacts item={selected} /> : null}
      <EntryBody items={items} detail={detail} />
    </Panel>
  );
}

function EntryFacts({ item }: { item: AppConfigListItem }) {
  const { summary } = item;
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-lg gap-y-ui-xs text-body">
      <dt className="text-muted-foreground">位置</dt>
      <dd className="m-0 break-all">
        {summary.displayPath}
        {isFixedLocation(summary) ? "（系统文件，只读）" : null}
      </dd>
      <dt className="text-muted-foreground">格式</dt>
      <dd className="m-0">{summary.format}</dd>
      <dt className="text-muted-foreground">能力</dt>
      <dd className="m-0">{CAPABILITY_LABELS[summary.capability]}</dd>
      <dt className="text-muted-foreground">来源</dt>
      <dd className="m-0 break-all">
        {summary.sourceUrl}（核实于 {summary.verifiedOn}）
      </dd>
    </dl>
  );
}

function EntryBody({
  items,
  detail,
}: {
  items: AppConfigListItem[];
  detail: DetailState;
}) {
  if (detail.status === "idle") {
    return <p className="m-0 text-body text-muted-foreground">选择左侧条目，查看其只读内容。</p>;
  }
  if (detail.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        正在读取……
      </p>
    );
  }
  if (detail.status === "failed") {
    return (
      <Panel role="alert" className="grid gap-ui-sm p-ui-md">
        <p className="m-0 text-body font-semibold text-danger">无法读取该条目</p>
        <p className="m-0 text-body">{detail.error.message}</p>
      </Panel>
    );
  }
  const item = items.find((candidate) => candidate.summary.id === detail.id);
  if (!item) {
    return <p className="m-0 text-body text-muted-foreground">该条目已不在列表中。</p>;
  }
  return <ReadResultBody item={item} result={detail.result} />;
}

function ReadResultBody({
  item,
  result,
}: {
  item: AppConfigListItem;
  result: AppConfigReadResult;
}) {
  const view = describeEntryDetail(item.summary, result);
  switch (view.kind) {
    case "content":
      return (
        <div className="grid gap-ui-sm">
          {view.redacted ? (
            <p className="m-0 text-aux text-muted-foreground">
              敏感值已遮盖（显示为 [REDACTED]）。
            </p>
          ) : null}
          <pre
            aria-label="解析后的内容"
            tabIndex={0}
            className="m-0 overflow-auto rounded-control bg-surface-muted p-ui-md text-meta"
          >
            {view.text || "（文件没有可显示的内容）"}
          </pre>
          {view.withheldLines > 0 ? (
            <p className="m-0 text-aux text-muted-foreground">
              有 {view.withheldLines} 行（注释或无法识别的行）未显示。
            </p>
          ) : null}
          {view.warnings.length > 0 ? (
            <ul className="m-0 grid list-none gap-ui-xs p-0 text-aux">
              {view.warnings.map((warning) => (
                <li key={`${warning.line}-${warning.message}`}>
                  第 {warning.line} 行：{warning.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "metadata":
      return (
        <div className="grid gap-ui-sm">
          <p className="m-0 text-body">{view.note}</p>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-lg gap-y-ui-xs text-body">
            {view.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="m-0">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "unavailable":
      return <p className="m-0 text-body">{view.message}</p>;
    case "failed":
      return <p className="m-0 text-body">{view.message}</p>;
  }
}
