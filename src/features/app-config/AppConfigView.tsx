import { Button as HeadlessButton } from "@headlessui/react";
import { ActionRow, Button, CodeViewer, PageShell, Panel } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { localizeError } from "../../i18n/errors";
import { useLocale } from "../../i18n/useLocale";
import type { AppConfigEntrySummary, AppConfigListItem, AppConfigProbeStatus, AppConfigReadResult } from "../../ipc/appConfig";
import {
  CAPABILITY_LABELS,
  appConfigCopy,
  codeLanguageFor,
  describeEntryDetail,
  describeProbe,
  entryName,
  fileNameOf,
  groupByCategory,
  type EntryDetailView,
  isFixedLocation,
  type DetailState,
  type ListState,
  type ProbeTone,
} from "./appConfigModel";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import { AppConfigEditor } from "./AppConfigEditor";
import { SupportedConfigsAction } from "./SupportedConfigsAction";

const PROBE_TEXT_CLASS: Record<ProbeTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export interface AppConfigEditControls {
  editingId: string | null;
  notice: string | null;
  onStart: (id: string) => void;
  onExit: () => void;
  onSaved: (created: boolean) => void;
}

export interface AppConfigViewProps {
  list: ListState;
  detail: DetailState;
  onReload: () => void;
  onSelect: (id: string) => void;
  edit?: AppConfigEditControls;
}

export function AppConfigView({ list, detail, onReload, onSelect, edit }: AppConfigViewProps) {
  const items = list.status === "ready" || list.status === "partial" ? list.items : undefined;
  const selectedId = detail.status === "idle" ? undefined : detail.id;

  return (
    <PageShell layout="master-detail" scrollKey="compact">
      <PageRegion className="r4-fe4-scroll content-start gap-ui-12 overflow-y-auto overscroll-contain">
        {list.status === "loading" ? <ListHeading items={undefined} /> : null}
        <ListStatusNotice list={list} onReload={onReload} />
        {items ? (
          <EntryList
            items={items}
            locked={Boolean(edit?.editingId)}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ) : null}
      </PageRegion>
      <PageRegion className="r4-fe4-scroll content-start overflow-y-auto overscroll-contain">
        {items ? <EntryDetail items={items} detail={detail} edit={edit} /> : null}
      </PageRegion>
    </PageShell>
  );
}

function ListStatusNotice({ list, onReload }: { list: ListState; onReload: () => void }) {
  const copy = appConfigCopy(useLocale());
  switch (list.status) {
    case "loading":
      return (
        <p role="status" className="m-0 text-body text-muted-foreground">
          {copy.t("appConfig.list.checking")}
        </p>
      );
    case "empty":
      return (
        <div className="grid gap-ui-8">
          <p role="status" className="m-0 text-body text-muted-foreground">
            {copy.t("appConfig.list.empty")}
          </p>
          <ActionRow>
            <Button size="sm" onClick={onReload}>
              {copy.t("common.refresh")}
            </Button>
            <SupportedConfigsAction items={[]} />
          </ActionRow>
        </div>
      );
    case "partial":
      return (
        <p role="status" className="m-0 text-body">
          {copy.t("appConfig.list.partial", { count: list.failedCount })}
        </p>
      );
    case "error":
      return (
        <Panel role="alert" className="grid gap-ui-8 p-ui-8">
          <p className="m-0 text-body font-semibold text-danger">
            {copy.t("appConfig.list.loadFailed")}
          </p>
          <p className="m-0 text-body">{localizeError(list.error, copy.locale)}</p>
          <ActionRow>
            <Button size="sm" onClick={onReload}>
              {copy.t("common.retry")}
            </Button>
            <SupportedConfigsAction items={undefined} />
          </ActionRow>
        </Panel>
      );
    case "ready":
      return null;
  }
}

function ListHeading({ items }: { items: readonly AppConfigListItem[] | undefined }) {
  const copy = appConfigCopy(useLocale());
  return (
    <div className="flex min-w-0 items-center justify-between gap-ui-8">
      <h2 id="app-config-list-title" className="m-0 min-w-0 text-group font-semibold">
        {copy.t("appConfig.list.heading")}
      </h2>
      <SupportedConfigsAction items={items} />
    </div>
  );
}

function EntryList({
  items,
  locked,
  selectedId,
  onSelect,
}: {
  items: AppConfigListItem[];
  locked: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const copy = appConfigCopy(useLocale());
  const listRef = useSlideIndicator(selectedId);
  return (
    <Panel aria-labelledby="app-config-list-title" className="grid content-start gap-ui-8 p-ui-8">
      <ListHeading items={items} />
      <div ref={listRef} className="slide-list grid gap-ui-4">
        {groupByCategory(items, copy).map((group) => (
          <div key={group.category} className="grid gap-ui-4">
            <h3 className="m-0 flex h-control-md items-center text-aux font-normal text-muted-foreground">
              {group.label}
            </h3>
            <ul className="m-0 grid list-none gap-ui-4 p-0">
              {group.items.map((item) => (
                <EntryRow
                  key={item.summary.id}
                  item={item}
                  locked={locked}
                  selected={item.summary.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="m-0 text-aux text-muted-foreground">
        {locked ? copy.t("appConfig.list.locked") : copy.t("appConfig.list.hint")}
      </p>
    </Panel>
  );
}

function EntryRow({
  item,
  locked,
  selected,
  onSelect,
}: {
  item: AppConfigListItem;
  locked: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const copy = appConfigCopy(useLocale());
  const { summary, probe } = item;
  return (
    <li>
      <HeadlessButton
        aria-current={selected ? "true" : undefined}
        className="slide-item entry-row grid w-full min-w-0 content-center gap-ui-2 px-ui-12 py-ui-4 text-left disabled:cursor-not-allowed"
        disabled={locked}
        onClick={() => onSelect(summary.id)}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-ui-8">
          <span className="min-w-0 truncate text-body font-semibold">{entryName(summary, copy)}</span>
          <ProbeStatus probe={probe} />
        </span>
        <span
          className="min-w-0 truncate font-mono text-aux text-muted-foreground"
          title={summary.displayPath}
        >
          {summary.displayPath}
        </span>
      </HeadlessButton>
    </li>
  );
}

function ProbeStatus({ probe }: { probe: AppConfigProbeStatus }) {
  const copy = appConfigCopy(useLocale());
  const badge = describeProbe(probe, copy);
  return (
    <span className={`shrink-0 text-meta ${PROBE_TEXT_CLASS[badge.tone]}`}>
      <span aria-hidden="true">{badge.symbol} </span>
      {badge.label}
    </span>
  );
}


function EntryDetail({
  items,
  detail,
  edit,
}: {
  items: AppConfigListItem[];
  detail: DetailState;
  edit: AppConfigEditControls | undefined;
}) {
  const copy = appConfigCopy(useLocale());
  const headingId = "app-config-detail-title";
  const selected = detail.status === "idle" ? undefined : items.find((item) => item.summary.id === detail.id);
  const editing = Boolean(selected && edit && edit.editingId === selected.summary.id);
  const canEdit = Boolean(
    selected && edit && !edit.editingId && selected.summary.capability === "writable",
  );

  return (
    <Panel
      role="region"
      aria-labelledby={headingId}
      className="grid content-start gap-ui-8 p-ui-8"
    >
      <h2 id={headingId} className="m-0 text-group font-semibold">
        {selected ? entryName(selected.summary, copy) : copy.t("appConfig.detail.heading")}
      </h2>
      {selected ? (
        <EntryHeader
          item={selected}
          onEdit={canEdit && edit ? () => edit.onStart(selected.summary.id) : undefined}
        />
      ) : null}
      {selected ? <EntryFacts item={selected} /> : null}
      {!editing && edit?.notice ? (
        <p role="status" className="m-0 text-body">
          {edit.notice}
        </p>
      ) : null}
      {selected && editing && edit ? (
        <AppConfigEditor
          key={selected.summary.id}
          item={selected}
          onExit={edit.onExit}
          onSaved={edit.onSaved}
        />
      ) : (
        <EntryBody items={items} detail={detail} />
      )}
    </Panel>
  );
}

function EntryHeader({ item, onEdit }: { item: AppConfigListItem; onEdit?: () => void }) {
  const copy = appConfigCopy(useLocale());
  return (
    <div className="flex flex-wrap items-center justify-between gap-ui-8">
      <ProbeStatus probe={item.probe} />
      {onEdit ? (
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {copy.t("common.edit")}
        </Button>
      ) : null}
    </div>
  );
}

function EntryFacts({ item }: { item: AppConfigListItem }) {
  const copy = appConfigCopy(useLocale());
  const { summary } = item;
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-8 gap-y-ui-4 text-body">
      <dt className="text-muted-foreground">{copy.t("appConfig.facts.location")}</dt>
      <dd className="m-0 break-all">
        {summary.displayPath}
        {isFixedLocation(summary) ? copy.t("appConfig.facts.systemFile") : null}
      </dd>
      <dt className="text-muted-foreground">{copy.t("appConfig.facts.format")}</dt>
      <dd className="m-0">{summary.format}</dd>
      <dt className="text-muted-foreground">{copy.t("appConfig.facts.capability")}</dt>
      <dd className="m-0">{copy.t(CAPABILITY_LABELS[summary.capability])}</dd>
      <dt className="text-muted-foreground">{copy.t("appConfig.facts.source")}</dt>
      <dd className="m-0 break-all">
        {copy.t("appConfig.facts.sourceVerified", {
          source: summary.sourceUrl,
          date: summary.verifiedOn,
        })}
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
  const copy = appConfigCopy(useLocale());
  if (detail.status === "idle") {
    return (
      <p className="m-0 text-body text-muted-foreground">{copy.t("appConfig.detail.select")}</p>
    );
  }
  if (detail.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {copy.t("appConfig.loading")}
      </p>
    );
  }
  if (detail.status === "failed") {
    return (
      <Panel role="alert" className="grid gap-ui-8 p-ui-8">
        <p className="m-0 text-body font-semibold text-danger">
          {copy.t("appConfig.detail.loadFailed")}
        </p>
        <p className="m-0 text-body">{localizeError(detail.error, copy.locale)}</p>
      </Panel>
    );
  }
  const item = items.find((candidate) => candidate.summary.id === detail.id);
  if (!item) {
    return (
      <p className="m-0 text-body text-muted-foreground">{copy.t("appConfig.detail.missing")}</p>
    );
  }
  return <ReadResultBody summary={item.summary} result={detail.result} />;
}

function ReadResultBody({
  summary,
  result,
}: {
  summary: AppConfigEntrySummary;
  result: AppConfigReadResult;
}) {
  const copy = appConfigCopy(useLocale());
  const view = describeEntryDetail(summary, result, copy);
  switch (view.kind) {
    case "content":
      return <ContentBody summary={summary} view={view} />;
    case "metadata":
      return (
        <div className="grid gap-ui-8">
          <p className="m-0 text-body">{view.note}</p>
          <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-ui-8 gap-y-ui-4 text-body">
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

function ContentBody({
  summary,
  view,
}: {
  summary: AppConfigEntrySummary;
  view: Extract<EntryDetailView, { kind: "content" }>;
}) {
  const copy = appConfigCopy(useLocale());
  const notice = view.redacted ? (
    <p className="m-0">{copy.t("appConfig.content.redacted")}</p>
  ) : undefined;
  return (
    <div className="grid min-w-0 gap-ui-8">
      {view.text ? (
        <CodeViewer
          label={copy.t("appConfig.content.label")}
          language={codeLanguageFor(summary)}
          notice={notice}
          text={view.text}
          title={fileNameOf(summary.displayPath)}
        />
      ) : (
        <>
          {notice}
          <p className="m-0 text-aux text-muted-foreground">{copy.t("appConfig.content.empty")}</p>
        </>
      )}
      {view.withheldLines > 0 ? (
        <p className="m-0 text-aux text-muted-foreground">
          {copy.t("appConfig.content.withheld", { count: view.withheldLines })}
        </p>
      ) : null}
      {view.warnings.length > 0 ? (
        <ul className="m-0 grid list-none gap-ui-4 p-0 text-aux">
          {view.warnings.map((warning) => (
            <li key={`${warning.line}-${warning.message}`}>
              {copy.t("appConfig.line", { line: warning.line, message: warning.message })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
