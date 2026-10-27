import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { localizeError } from "../../i18n/errors";
import { formatByteSize } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import { VariableChainList } from "./VariableChainTable";
import { zshVariableRows, type VariableChainRow } from "./variableChainModel";
import {
  appliesToText,
  fileStatus,
  reasonText,
  resolveZshNames,
  sourceLabel,
  stepStatus,
  summarize,
  zdotdirSummary,
  zshFileDisplay,
  type SummaryTone,
  type ZshEditIntent,
  type ZshNameResolution,
  type ZshState,
} from "./zshModel";

export interface ZshViewProps {
  state: ZshState;
  /** 目录选择面板正打开着。 */
  choosing: boolean;
  /** 提示文字（如选择目录被取消、授权失败）。 */
  notice?: { tone: "info" | "error"; text: string };
  onReload: () => void;
  onChooseDirectory: () => void;
  onClearDirectory: () => void;
  /** 取回一项的明文；只在用户点击“载入值”后调用。 */
  onLoadValue: (file: ZshFileKey, row: ZshEntryRow) => Promise<string>;
  /**
   * 打开某个文件的专用块编辑器。不传时视图完全只读、没有任何编辑入口；传入后
   * 只有位置已确定、且已读取或不存在的文件会出现入口（越界、未确定位置的没有）。
   * intent 说明要新增变量，还是定位到某个变量；不传则只打开编辑器。
   */
  onEditFile?: (file: ZshFileKey, intent?: ZshEditIntent) => void;
}

const HEADER_CLASSES =
  "flex min-w-0 flex-wrap items-start justify-between gap-ui-8 px-ui-12 pt-ui-12 pb-ui-8";
const CARD_CLASSES = "min-w-0 overflow-hidden";
const NOTE_CLASSES = "text-xs leading-relaxed text-muted-foreground";

/**
 * 只读视图：变量读取链表放在最上面（最终值与过程值），zsh 的读取顺序、ZDOTDIR 与
 * 各启动文件原文收在下方的折叠区里。不执行命令；默认没有编辑入口，只有页面传入
 * onEditFile 时，位置已确定的文件才出现入口（编辑器本身不在这个视图里）。
 */
export function ZshView(props: ZshViewProps) {
  const t = useT();
  const { state } = props;
  const { load } = state;
  const overview =
    load.status === "ready"
      ? load.overview
      : load.status === "loading"
        ? load.previous
        : undefined;
  return (
    <section
      aria-labelledby="zsh-heading"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain"
    >
      <header className={HEADER_CLASSES}>
        <div className="min-w-0">
          <h2 className="text-group font-semibold" id="zsh-heading">
            {t("env.zsh.heading")}
          </h2>
          <p className="mt-ui-4 text-xs text-muted-foreground">{t("env.zsh.subheading")}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          {props.onEditFile ? (
            <Button
              disabled={!zshrcEditable(overview)}
              onClick={() => props.onEditFile?.("ZSHRC", { kind: "addition" })}
              size="sm"
              variant="primary"
            >
              {t("env.zsh.addVariable")}
            </Button>
          ) : null}
          <Button
            disabled={load.status === "loading"}
            onClick={props.onReload}
            size="sm"
            variant="default"
          >
            {load.status === "loading" ? t("env.zsh.reloading") : t("env.zsh.reload")}
          </Button>
        </div>
      </header>
      <div className="grid gap-ui-12 px-ui-12 py-ui-8">
        {props.notice ? (
          <p
            className={classNames(
              "text-xs leading-relaxed",
              props.notice.tone === "error" ? "text-danger" : "text-muted-foreground",
            )}
            role={props.notice.tone === "error" ? "alert" : "status"}
          >
            {props.notice.text}
          </p>
        ) : null}
        <Body {...props} overview={overview} />
      </div>
    </section>
  );
}

function Body(props: ZshViewProps & { overview?: ZshOverview }) {
  const t = useT();
  const locale = useLocale();
  const { overview, state } = props;
  const { load } = state;
  if (load.status === "error") {
    return (
      <AsyncState
        kind="error"
        action={
          <Button onClick={props.onReload} size="sm" variant="default">
            {t("env.zsh.retry")}
          </Button>
        }
      >
        <span className="break-words [overflow-wrap:anywhere]">
          {localizeError(load.error, locale)}
        </span>
      </AsyncState>
    );
  }
  if (!overview) {
    return <AsyncState kind="loading">{t("env.zsh.loading")}</AsyncState>;
  }
  const summary = summarize(overview, t);
  const resolution = resolveZshNames(overview);
  return (
    <>
      {load.status === "loading" ? (
        <AsyncState kind="loading">{t("env.zsh.reloadingNotice")}</AsyncState>
      ) : null}
      {summary.kind === "empty" ? (
        <AsyncState kind="empty">{t("env.zsh.allMissing")}</AsyncState>
      ) : null}
      {summary.kind === "partial" ? (
        <AsyncState kind="partial">
          {t("env.zsh.partial", { problems: summary.problems.join(t("env.zsh.listSeparator")) })}
        </AsyncState>
      ) : null}
      <VariablesSection
        onEditFile={props.onEditFile}
        onLoadValue={props.onLoadValue}
        overview={overview}
      />
      <details className="group min-w-0 border-t border-line pt-ui-8">
        <summary className="cursor-pointer text-aux font-semibold text-foreground">
          {t("env.zsh.details")}
        </summary>
        <div className="grid gap-ui-12 pt-ui-12">
          <StaticReadingNote overview={overview} />
          <ReadingOrder overview={overview} />
          <ZdotdirPanel {...props} overview={overview} />
          <div className="grid gap-ui-8">
            {overview.files.map((file) => (
              <FileCard
                file={file}
                key={file.file}
                onEditFile={props.onEditFile}
                resolution={resolution}
              />
            ))}
          </div>
        </div>
      </details>
    </>
  );
}

function StaticReadingNote({ overview }: { overview?: ZshOverview }) {
  const t = useT();
  return (
    <div className="grid gap-ui-4">
      <p className={NOTE_CLASSES}>{t("env.zsh.staticNote")}</p>
      {overview ? (
        <p className={NOTE_CLASSES}>
          {t("env.zsh.source", {
            label: sourceLabel(t),
            date: overview.source.consultedOn,
          })}{" "}
          <code className="break-all font-mono">{overview.source.url}</code>
        </p>
      ) : null}
    </div>
  );
}

// ---- reading order ----------------------------------------------------------

function ReadingOrder({ overview }: { overview: ZshOverview }) {
  const t = useT();
  const byFile = new Map(overview.files.map((file) => [file.file, file]));
  return (
    <section aria-labelledby="zsh-order-heading" className={CARD_CLASSES}>
      <h3 className="text-aux font-semibold" id="zsh-order-heading">
        {t("env.zsh.order.heading")}
      </h3>
      <p className={classNames("mt-ui-4", NOTE_CLASSES)}>{t("env.zsh.order.note")}</p>
      <div className="mt-ui-8 min-w-0 overflow-x-auto">
        <table
          aria-label={t("env.zsh.order.table")}
          className="w-full min-w-[32rem] table-fixed border-collapse text-xs"
        >
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-28" />
            <col className="w-40" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-meta text-muted-foreground">
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.zsh.order.step")}</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.zsh.order.path")}</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.zsh.order.scope")}</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">{t("env.zsh.order.status")}</th>
            </tr>
          </thead>
          <tbody>
            {overview.order.map((step) => (
              <OrderRow
                file={step.file ? byFile.get(step.file) : undefined}
                key={step.position}
                step={step}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderRow({ file, step }: { file?: ZshFile; step: ZshOrderStep }) {
  const t = useT();
  const applies = appliesToText(step.appliesTo, t);
  const note = stepStatus(step, t);
  const status = file ? fileStatus(file, t) : undefined;
  return (
    <tr
      className={classNames(
        "min-h-control-md border-t border-line align-middle",
        step.scope === "SYSTEM" && "text-muted-foreground",
      )}
    >
      <td className="whitespace-nowrap px-ui-8 py-ui-4 text-meta text-muted-foreground">
        {t("env.zsh.order.position", { position: step.position })}
      </td>
      <td className="min-w-0 px-ui-8 py-ui-4">
        <code className="break-all font-mono text-aux">{step.pathLabel}</code>
      </td>
      <td className="px-ui-8 py-ui-4">
        <StatusBadge title={applies.detail}>{applies.label}</StatusBadge>
      </td>
      <td className="px-ui-8 py-ui-4">
        <span className="flex flex-wrap items-center gap-ui-4">
          {note ? <span className="text-meta">{note}</span> : null}
          {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
        </span>
      </td>
    </tr>
  );
}

// ---- ZDOTDIR ----------------------------------------------------------------

function toneClasses(tone: SummaryTone): string {
  switch (tone) {
    case "success":
      return "border-success";
    case "warning":
      return "border-warning";
    case "danger":
      return "border-danger";
    case "neutral":
      return "border-border";
  }
}

function ZdotdirPanel({
  choosing,
  onChooseDirectory,
  onClearDirectory,
  overview,
}: ZshViewProps & { overview: ZshOverview }) {
  const t = useT();
  const summary = zdotdirSummary(overview.zdotdir, t);
  return (
    <section
      aria-labelledby="zsh-zdotdir-heading"
      className={classNames(CARD_CLASSES, "border-l-4 px-ui-12 py-ui-8", toneClasses(summary.tone))}
    >
      <h3 className="text-aux font-semibold" id="zsh-zdotdir-heading">
        {summary.title}
      </h3>
      <p className={classNames("mt-ui-4 break-words [overflow-wrap:anywhere]", NOTE_CLASSES)}>
        {summary.detail}
      </p>
      {summary.problem ? (
        <p className="mt-ui-8 text-xs leading-relaxed text-danger" role="alert">
          {summary.problem}
        </p>
      ) : null}
      {summary.needsChoice || summary.selected ? (
        <div className="mt-ui-8 flex min-w-0 flex-wrap items-center gap-ui-8">
          <Button
            disabled={choosing}
            onClick={onChooseDirectory}
            size="sm"
            variant={summary.needsChoice ? "primary" : "default"}
          >
            {choosing
              ? t("env.zsh.zdotdir.waiting")
              : summary.selected
                ? t("env.zsh.zdotdir.change")
                : t("env.zsh.zdotdir.choose")}
          </Button>
          {summary.selected ? (
            <Button disabled={choosing} onClick={onClearDirectory} size="sm" variant="ghost">
              {t("env.zsh.zdotdir.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className={classNames("mt-ui-8", NOTE_CLASSES)}>{t("env.zsh.zdotdir.note")}</p>
    </section>
  );
}

// ---- files ---------------------------------------------------------------------

function FileCard({
  file,
  onEditFile,
  resolution,
}: {
  file: ZshFile;
  onEditFile?: ZshViewProps["onEditFile"];
  resolution: ZshNameResolution;
}) {
  const t = useT();
  const applies = appliesToText(file.appliesTo, t);
  const status = fileStatus(file, t);
  const headingId = `zsh-file-${file.file}`;
  const { outcome } = file;
  return (
    <section aria-labelledby={headingId} className={CARD_CLASSES}>
      <header className={HEADER_CLASSES}>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-ui-8 text-aux font-semibold" id={headingId}>
            <code className="font-mono">{file.name}</code>
            <span className="text-meta font-normal text-muted-foreground">
              {t("env.zsh.order.position", { position: file.position })}
            </span>
          </h3>
          <p className="mt-ui-4 break-all text-xs text-muted-foreground">
            {file.displayPath ?? t("env.zsh.file.undetermined")}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          <StatusBadge title={applies.detail}>{applies.label}</StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {onEditFile && canEdit(outcome) ? (
            <Button
              aria-label={t("env.zsh.file.editBlockLabel", { name: file.name })}
              onClick={() => onEditFile(file.file)}
              size="sm"
              variant={file.file === "ZSHRC" ? "primary" : "default"}
            >
              {t("env.zsh.file.editBlock")}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="px-ui-12 py-ui-8">
        <p className={NOTE_CLASSES}>{applies.detail}</p>
        {onEditFile && canEdit(outcome) && file.file !== "ZSHRC" ? (
          <p className={classNames("mt-ui-4", NOTE_CLASSES)}>{t("env.zsh.file.nonZshrcNote")}</p>
        ) : null}
        {outcome.status === "READY" ? (
          <ReadyFile file={file} outcome={outcome} resolution={resolution} />
        ) : (
          <FileProblem outcome={outcome} />
        )}
      </div>
    </section>
  );
}

/** Only a located file that was read, or that does not exist yet, can be edited. */
function canEdit(outcome: ZshFile["outcome"]): boolean {
  return (
    outcome.status === "READY" ||
    (outcome.status === "UNAVAILABLE" && outcome.reason === "NOT_FOUND")
  );
}

/** .zshrc is the file the header action edits by default. */
function zshrcEditable(overview: ZshOverview | undefined): boolean {
  const zshrc = overview?.files.find((file) => file.file === "ZSHRC");
  return zshrc !== undefined && canEdit(zshrc.outcome);
}

function FileProblem({ outcome }: { outcome: Exclude<ZshFile["outcome"], { status: "READY" }> }) {
  const t = useT();
  if (outcome.status === "UNAVAILABLE" && outcome.reason === "NOT_FOUND") {
    return <AsyncState kind="empty">{t("env.zsh.file.missingNote")}</AsyncState>;
  }
  if (outcome.status === "NOT_LOCATED") {
    return <AsyncState kind="partial">{outcome.message}</AsyncState>;
  }
  return (
    <AsyncState kind="error">
      <span className="break-words [overflow-wrap:anywhere]">{outcome.message}</span>
    </AsyncState>
  );
}

function ReadyFile({
  file,
  outcome,
  resolution,
}: {
  file: ZshFile;
  outcome: Extract<ZshFile["outcome"], { status: "READY" }>;
  resolution: ZshNameResolution;
}) {
  const t = useT();
  const locale = useLocale();
  const display = zshFileDisplay(file.file, outcome, resolution);
  const lines = outcome.rows.filter(isLineRow);
  return (
    <>
      <div className="mt-ui-8 flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
        <span>{formatByteSize(outcome.sizeBytes, locale)}</span>
        <span>{t("env.zsh.file.lines", { count: outcome.lineCount })}</span>
        <span>{t("env.zsh.file.entries", { count: display.entryCount })}</span>
        <span>{t("env.zsh.file.masked", { count: display.secretCount })}</span>
        {display.dynamicCount > 0 ? (
          <StatusBadge tone="warning">
            {t("env.zsh.file.dynamic", { count: display.dynamicCount })}
          </StatusBadge>
        ) : null}
        {outcome.unrecognizedCount > 0 ? (
          <StatusBadge tone="warning">
            {t("env.zsh.file.unrecognized", { count: outcome.unrecognizedCount })}
          </StatusBadge>
        ) : null}
      </div>
      {outcome.rowsTruncated ? (
        <AsyncState kind="partial">
          {t("env.zsh.file.truncated", { shown: outcome.rows.length, total: outcome.lineCount })}
        </AsyncState>
      ) : null}
      {outcome.rows.length === 0 ? <AsyncState kind="empty">{t("env.zsh.file.empty")}</AsyncState> : null}
      {lines.length > 0 ? (
        <ol
          aria-label={t("env.zsh.file.contentLabel", { name: file.name })}
          className="mt-ui-8 grid max-h-96 gap-ui-4 overflow-y-auto"
          // The list scrolls, so keyboard users must be able to focus it.
          tabIndex={0}
        >
          {lines.map((row) => (
            <li key={`${row.line}:${row.kind}`}>
              <RowView row={row} />
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

/** Variables are listed in the chain table; the file list keeps everything else as written. */
type LineRow = Exclude<ZshRow, ZshEntryRow>;

function isLineRow(row: ZshRow): row is LineRow {
  return row.kind !== "ENTRY";
}

function LineNumber({ line }: { line: number }) {
  const t = useT();
  return (
    <span
      aria-label={t("env.zsh.file.lineLabel", { line })}
      className="w-10 shrink-0 select-none text-right font-mono text-meta text-muted-foreground"
    >
      {line}
    </span>
  );
}

const ROW_BASE = "flex min-w-0 items-start gap-ui-8 rounded-control px-ui-8 py-ui-4";

function RowView({ row }: { row: LineRow }) {
  const t = useT();
  switch (row.kind) {
    case "BLANK":
      return (
        <div className={classNames(ROW_BASE, "text-muted-foreground")}>
          <LineNumber line={row.line} />
          <span className="text-meta">{t("env.zsh.file.blank")}</span>
        </div>
      );
    case "COMMENT":
      return (
        <div className={classNames(ROW_BASE, "bg-surface")}>
          <LineNumber line={row.line} />
          <RowText className="text-muted-foreground" row={row} />
        </div>
      );
    case "DYNAMIC": {
      const reason = reasonText(row.reason, t);
      return (
        <div className={classNames(ROW_BASE, "bg-warning-soft")}>
          <LineNumber line={row.line} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <StatusBadge tone="warning" title={reason.hint}>
                {t("env.zsh.file.dynamicBadge")}
              </StatusBadge>
              <span className="text-meta">{reason.label}</span>
              <EndLine line={row.line} endLine={row.endLine} />
            </div>
            <span className="sr-only">{reason.hint}</span>
            <div className="mt-ui-4">
              <RowText row={row} />
            </div>
          </div>
        </div>
      );
    }
    case "UNRECOGNIZED":
      return (
        <div className={classNames(ROW_BASE, "bg-warning-soft")}>
          <LineNumber line={row.line} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <StatusBadge tone="warning">{t("env.zsh.file.unrecognizedBadge")}</StatusBadge>
              <EndLine line={row.line} endLine={row.endLine} />
            </div>
            <div className="mt-ui-4">
              <RowText row={row} />
            </div>
          </div>
        </div>
      );
  }
}

function EndLine({ line, endLine }: { line: number; endLine: number }) {
  const t = useT();
  return endLine > line ? (
    <span className="text-meta text-muted-foreground">
      {t("env.zsh.file.lineRange", { line, endLine })}
    </span>
  ) : null;
}

function RowText({
  className,
  row,
}: {
  className?: string;
  row: { text?: string; withheld: boolean };
}) {
  const t = useT();
  if (row.withheld || row.text === undefined) {
    return <span className="text-xs text-muted-foreground">{t("env.zsh.file.withheld")}</span>;
  }
  return (
    <code className={classNames("break-all font-mono text-aux", className)}>
      {row.text}
    </code>
  );
}

function VariablesSection({
  onEditFile,
  onLoadValue,
  overview,
}: {
  onEditFile?: ZshViewProps["onEditFile"];
  onLoadValue: ZshViewProps["onLoadValue"];
  overview: ZshOverview;
}) {
  const t = useT();
  const rows = zshVariableRows(overview, t);
  const keyByName = new Map(overview.files.map((file) => [file.name, file.file]));

  const edit = (row: VariableChainRow) => {
    const key = keyByName.get(row.final.source.file);
    const line = row.final.source.line;
    if (!onEditFile || key === undefined || line === undefined) return;
    onEditFile(key, { kind: "variable", name: row.name, line });
  };

  const reveal = (row: VariableChainRow): Promise<string> => {
    const file = overview.files.find((item) => item.name === row.final.source.file);
    const line = row.final.source.line;
    const entry =
      file?.outcome.status === "READY"
        ? file.outcome.rows.find(
            (item): item is ZshEntryRow => item.kind === "ENTRY" && item.line === line,
          )
        : undefined;
    if (!file || !entry) return Promise.reject(new Error(t("env.chain.notFound")));
    return onLoadValue(file.file, entry);
  };

  return (
    <section aria-labelledby="zsh-variables-heading" className="min-w-0">
      <h3 className="sr-only" id="zsh-variables-heading">
        {t("env.zsh.variables.heading")}
      </h3>
      <VariableChainList
        emptyState={<AsyncState kind="empty">{t("env.zsh.variables.empty")}</AsyncState>}
        label={t("env.zsh.variables.table")}
        onEdit={onEditFile ? edit : undefined}
        onRevealFinal={reveal}
        rows={rows}
        searchKey="zsh"
      />
    </section>
  );
}
