import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshPathSegment,
  ZshRow,
} from "../../ipc/environment";
import { formatBytes } from "./environmentModel";
import { LazySecretValue } from "./LazySecretValue";
import { SameNameHint } from "./SameNameHint";
import {
  SOURCE_LABEL,
  appliesToText,
  fileStatus,
  needsFetch,
  pathSegmentText,
  reasonText,
  resolveZshNames,
  stepStatus,
  summarize,
  valueStateText,
  zdotdirSummary,
  zshFileDisplay,
  zshRowKey,
  type SummaryTone,
  type ZshEditIntent,
  type ZshLocation,
  type ZshNameNote,
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
  "flex min-w-0 flex-wrap items-start justify-between gap-ui-8 px-ui-12 pt-ui-16 pb-ui-12";
const CARD_CLASSES = "min-w-0 overflow-hidden";
const NOTE_CLASSES = "text-xs leading-relaxed text-muted-foreground";

/**
 * 只读视图：四个 zsh 启动文件的适用 shell 类型、读取顺序、ZDOTDIR 判断和静态
 * 识别出的条目。按原文显示，不展开变量、不执行命令。同名变量只显示读取顺序里
 * 最后一处的结果，被覆盖的位置收在一行提示里；追加或动态写法的同名项全部保留。
 * 默认没有任何编辑入口；只有页面传入 onEditFile 时，位置已确定的文件才出现入口
 * （编辑器本身不在这个视图里）。
 */
export function ZshView(props: ZshViewProps) {
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
          <h2 className="text-sm font-semibold" id="zsh-heading">
            zsh 启动文件
          </h2>
          <p className="mt-ui-4 text-xs text-muted-foreground">
            当前用户的 .zshenv、.zprofile、.zshrc、.zlogin，只读查看
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          {props.onEditFile ? (
            <Button
              disabled={!zshrcEditable(overview)}
              onClick={() => props.onEditFile?.("ZSHRC", { kind: "addition" })}
              size="sm"
              variant="primary"
            >
              设置变量
            </Button>
          ) : null}
          <Button
            disabled={load.status === "loading"}
            onClick={props.onReload}
            size="sm"
          >
            {load.status === "loading" ? "读取中…" : "重新读取"}
          </Button>
        </div>
      </header>
      <div className="grid gap-ui-12 px-ui-12 py-ui-8">
        <StaticReadingNote overview={overview} />
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

function StaticReadingNote({ overview }: { overview?: ZshOverview }) {
  return (
    <div className="grid gap-ui-4">
      <p className={NOTE_CLASSES}>
        静态读取：不启动 shell、不 source、不执行任何文件，也不读取 /etc
        下的系统级文件和进程环境。RCS 等选项与动态配置可能改变实际读取的内容，所以这里的展示不等于实际生效的环境。
      </p>
      {overview ? (
        <p className={NOTE_CLASSES}>
          来源：{SOURCE_LABEL}，{overview.source.consultedOn} 查阅（
          <code className="break-all font-mono">{overview.source.url}</code>）
        </p>
      ) : null}
    </div>
  );
}

function Body(props: ZshViewProps & { overview?: ZshOverview }) {
  const { overview, state } = props;
  const { load } = state;
  if (load.status === "error") {
    return (
      <AsyncState kind="error">
        <span className="break-words [overflow-wrap:anywhere]">{load.error.message}</span>{" "}
        <Button onClick={props.onReload} size="sm">
          重试
        </Button>
      </AsyncState>
    );
  }
  if (!overview) {
    return <AsyncState kind="loading">正在读取 zsh 启动文件…</AsyncState>;
  }
  const summary = summarize(overview);
  const resolution = resolveZshNames(overview);
  return (
    <>
      {load.status === "loading" ? (
        <AsyncState kind="loading">正在重新读取…</AsyncState>
      ) : null}
      {summary.kind === "empty" ? (
        <AsyncState kind="empty">
          四个启动文件都不存在。zsh 会按下面的顺序查找它们，不存在的文件会被跳过。
        </AsyncState>
      ) : null}
      {summary.kind === "partial" ? (
        <AsyncState kind="partial">
          部分文件没有读取：{summary.problems.join("；")}。
        </AsyncState>
      ) : null}
      <ReadingOrder overview={overview} />
      <ZdotdirPanel {...props} overview={overview} />
      <div className="grid gap-ui-8">
        {overview.files.map((file) => (
          <FileCard
            file={file}
            key={file.file}
            onEditFile={props.onEditFile}
            onLoadValue={props.onLoadValue}
            resolution={resolution}
          />
        ))}
      </div>
    </>
  );
}

// ---- reading order ----------------------------------------------------------

function ReadingOrder({ overview }: { overview: ZshOverview }) {
  const byFile = new Map(overview.files.map((file) => [file.file, file]));
  return (
    <section aria-labelledby="zsh-order-heading" className={classNames(CARD_CLASSES, "px-ui-12 py-ui-8")}>
      <h3 className="text-sm font-semibold" id="zsh-order-heading">
        读取顺序
      </h3>
      <p className={classNames("mt-ui-4", NOTE_CLASSES)}>
        zsh 启动时按下面的顺序读取；后读取的文件可以覆盖先读取的设置。同名变量只显示最后一处，是否真的生效还取决于 shell 的类型和动态写法。
      </p>
      <div className="mt-ui-8 min-w-0 overflow-x-auto">
        <table
          aria-label="zsh 启动文件读取顺序"
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
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">步骤</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">路径</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">范围</th>
              <th className="px-ui-8 py-ui-4 font-medium" scope="col">状态</th>
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
  const applies = appliesToText(step.appliesTo);
  const note = stepStatus(step);
  const status = file ? fileStatus(file) : undefined;
  return (
    <tr
      className={classNames(
        "min-h-control-md border-t border-line align-middle",
        step.scope === "SYSTEM" && "text-muted-foreground",
      )}
    >
      <td className="whitespace-nowrap px-ui-8 py-ui-4 text-meta text-muted-foreground">
        第 {step.position} 步
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
  const summary = zdotdirSummary(overview.zdotdir);
  return (
    <section
      aria-labelledby="zsh-zdotdir-heading"
      className={classNames(CARD_CLASSES, "border-l-4 px-ui-12 py-ui-8", toneClasses(summary.tone))}
    >
      <h3 className="text-sm font-semibold" id="zsh-zdotdir-heading">
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
            variant={summary.needsChoice ? "primary" : "secondary"}
          >
            {choosing ? "等待选择…" : summary.selected ? "重新选择目录…" : "选择 ZDOTDIR 目录…"}
          </Button>
          {summary.selected ? (
            <Button disabled={choosing} onClick={onClearDirectory} size="sm" variant="ghost">
              清除选择
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className={classNames("mt-ui-8", NOTE_CLASSES)}>
        .zshenv 始终从主目录读取。UserHome 不读取自身进程的 ZDOTDIR；/etc/zshenv
        或启动终端的会话也可能设置它，静态读取看不到这些来源。
      </p>
    </section>
  );
}

// ---- files ---------------------------------------------------------------------

function FileCard({
  file,
  onEditFile,
  onLoadValue,
  resolution,
}: {
  file: ZshFile;
  onEditFile?: ZshViewProps["onEditFile"];
  onLoadValue: ZshViewProps["onLoadValue"];
  resolution: ZshNameResolution;
}) {
  const applies = appliesToText(file.appliesTo);
  const status = fileStatus(file);
  const headingId = `zsh-file-${file.file}`;
  const { outcome } = file;
  return (
    <section aria-labelledby={headingId} className={CARD_CLASSES}>
      <header className={HEADER_CLASSES}>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-ui-8 text-sm font-semibold" id={headingId}>
            <code className="font-mono">{file.name}</code>
            <span className="text-meta font-normal text-muted-foreground">
              第 {file.position} 步
            </span>
          </h3>
          <p className="mt-ui-4 break-all text-xs text-muted-foreground">
            {file.displayPath ?? "位置未确定"}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          <StatusBadge title={applies.detail}>{applies.label}</StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {onEditFile && canEdit(outcome) ? (
            <Button
              aria-label={`编辑 ${file.name} 的 UserHome 专用块`}
              onClick={() => onEditFile(file.file)}
              size="sm"
              variant={file.file === "ZSHRC" ? "primary" : "secondary"}
            >
              编辑专用块…
            </Button>
          ) : null}
        </div>
      </header>
      <div className="px-ui-12 py-ui-8">
        <p className={NOTE_CLASSES}>{applies.detail}</p>
        {onEditFile && canEdit(outcome) && file.file !== "ZSHRC" ? (
          <p className={classNames("mt-ui-4", NOTE_CLASSES)}>
            默认只在 .zshrc 里编辑；这个文件需要你逐次选择，编辑前会显示它的影响范围。
          </p>
        ) : null}
        {outcome.status === "READY" ? (
          <ReadyFile
            edit={onEditFile && canEdit(outcome) ? onEditFile : undefined}
            file={file}
            onLoadValue={onLoadValue}
            outcome={outcome}
            resolution={resolution}
          />
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
  if (outcome.status === "UNAVAILABLE" && outcome.reason === "NOT_FOUND") {
    return <AsyncState kind="empty">该文件不存在，zsh 会跳过它。</AsyncState>;
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
  edit,
  file,
  onLoadValue,
  outcome,
  resolution,
}: {
  edit?: NonNullable<ZshViewProps["onEditFile"]>;
  file: ZshFile;
  onLoadValue: ZshViewProps["onLoadValue"];
  outcome: Extract<ZshFile["outcome"], { status: "READY" }>;
  resolution: ZshNameResolution;
}) {
  const display = zshFileDisplay(file.file, outcome, resolution);
  return (
    <>
      <div className="mt-ui-8 flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
        <span>{formatBytes(outcome.sizeBytes)}</span>
        <span>{outcome.lineCount} 行</span>
        <span>{display.entryCount} 项</span>
        <span>{display.secretCount} 项已遮盖</span>
        {display.dynamicCount > 0 ? (
          <StatusBadge tone="warning">{display.dynamicCount} 处动态／未解析</StatusBadge>
        ) : null}
        {outcome.unrecognizedCount > 0 ? (
          <StatusBadge tone="warning">{outcome.unrecognizedCount} 行未识别</StatusBadge>
        ) : null}
      </div>
      {outcome.rowsTruncated ? (
        <AsyncState kind="partial">
          文件行数过多，只显示前 {outcome.rows.length} 行（共 {outcome.lineCount} 行）。
        </AsyncState>
      ) : null}
      {display.rows.length === 0 ? (
        <AsyncState kind="empty">文件是空的。</AsyncState>
      ) : (
        <ol
          aria-label={`${file.name} 的内容`}
          className="mt-ui-8 grid max-h-96 gap-ui-4 overflow-y-auto"
          // The list scrolls, so keyboard users must be able to focus it.
          tabIndex={0}
        >
          {display.rows.map((row) => (
            <li key={`${row.line}:${row.kind}:${row.kind === "ENTRY" ? row.name : ""}`}>
              <RowView
                edit={
                  edit && row.kind === "ENTRY"
                    ? () => edit(file.file, { kind: "variable", name: row.name, line: row.line })
                    : undefined
                }
                file={file.file}
                note={resolution.notes.get(zshRowKey(file.file, row.line))}
                onLoadValue={onLoadValue}
                row={row}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function LineNumber({ line }: { line: number }) {
  return (
    <span
      aria-label={`第 ${line} 行`}
      className="w-10 shrink-0 select-none text-right font-mono text-meta text-muted-foreground"
    >
      {line}
    </span>
  );
}

const ROW_BASE = "flex min-w-0 items-start gap-ui-8 rounded-control px-ui-8 py-ui-4";

function RowView({
  edit,
  file,
  note,
  onLoadValue,
  row,
}: {
  edit?: () => void;
  file: ZshFileKey;
  note?: ZshNameNote;
  onLoadValue: ZshViewProps["onLoadValue"];
  row: ZshRow;
}) {
  switch (row.kind) {
    case "BLANK":
      return (
        <div className={classNames(ROW_BASE, "text-muted-foreground")}>
          <LineNumber line={row.line} />
          <span className="text-meta">（空行）</span>
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
      const reason = reasonText(row.reason);
      return (
        <div className={classNames(ROW_BASE, "bg-warning-soft")}>
          <LineNumber line={row.line} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <StatusBadge tone="warning" title={reason.hint}>
                动态／未解析
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
              <StatusBadge tone="warning">未识别行，保持原样</StatusBadge>
              <EndLine line={row.line} endLine={row.endLine} />
            </div>
            <div className="mt-ui-4">
              <RowText row={row} />
            </div>
          </div>
        </div>
      );
    case "ENTRY":
      return <EntryRowView edit={edit} file={file} note={note} onLoadValue={onLoadValue} row={row} />;
  }
}

function EndLine({ line, endLine }: { line: number; endLine: number }) {
  return endLine > line ? (
    <span className="text-meta text-muted-foreground">
      第 {line}–{endLine} 行
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
  if (row.withheld || row.text === undefined) {
    return (
      <span className="text-xs text-muted-foreground">（疑似含秘密，内容已隐藏）</span>
    );
  }
  return (
    <code className={classNames("break-all font-mono text-aux", className)}>
      {row.text}
    </code>
  );
}

function EntryRowView({
  edit,
  file,
  note,
  onLoadValue,
  row,
}: {
  edit?: () => void;
  file: ZshFileKey;
  note?: ZshNameNote;
  onLoadValue: ZshViewProps["onLoadValue"];
  row: ZshEntryRow;
}) {
  const state = valueStateText(row.state);
  const reason = row.reason ? reasonText(row.reason) : undefined;
  return (
    <div className={classNames(ROW_BASE, "bg-surface")}>
      <LineNumber line={row.line} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
          <code className="break-all font-mono text-aux font-semibold">{row.name}</code>
          {row.exported ? <StatusBadge>export</StatusBadge> : null}
          {row.operation === "APPEND" ? <StatusBadge>追加</StatusBadge> : null}
          {row.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
          <StatusBadge
            title={state.hint}
            tone={row.state === "DYNAMIC" ? "warning" : row.state === "REFERENCE" ? "neutral" : "success"}
          >
            {state.label}
          </StatusBadge>
          {reason ? <span className="text-meta">{reason.label}</span> : null}
          <EndLine line={row.line} endLine={row.endLine} />
          {note ? <NameNote name={row.name} note={note} /> : null}
          {edit ? (
            <Button aria-label={`修改 ${row.name}`} onClick={edit} size="sm" variant="ghost">
              修改
            </Button>
          ) : null}
        </div>
        <span className="sr-only">{state.hint}</span>
        <div className="mt-ui-4 min-w-0">
          <EntryValue file={file} onLoadValue={onLoadValue} row={row} />
        </div>
        {row.pathSegments && !row.secret ? (
          <PathSegments segments={row.pathSegments} />
        ) : null}
      </div>
    </div>
  );
}

function EntryValue({
  file,
  onLoadValue,
  row,
}: {
  file: ZshFileKey;
  onLoadValue: ZshViewProps["onLoadValue"];
  row: ZshEntryRow;
}) {
  if (!row.hasValue) {
    return <span className="text-xs text-muted-foreground">（空值）</span>;
  }
  if (needsFetch(row)) {
    return (
      <LazySecretValue
        label={row.name}
        load={() => onLoadValue(file, row)}
        resetKey={`${file}:${row.line}:${row.name}`}
      />
    );
  }
  return (
    <code className="break-all rounded-control bg-surface-muted px-ui-8 py-ui-2 font-mono text-aux">
      {row.value}
    </code>
  );
}

function PathSegments({ segments }: { segments: readonly ZshPathSegment[] }) {
  if (segments.length === 0) {
    return <p className={classNames("mt-ui-4", NOTE_CLASSES)}>（没有 PATH 项）</p>;
  }
  return (
    <ol aria-label="PATH 项（按书写顺序）" className="mt-ui-8 grid gap-ui-2">
      {segments.map((segment, index) => {
        const state = valueStateText(segment.state);
        return (
          <li className="flex min-w-0 flex-wrap items-center gap-ui-8" key={`${index}:${segment.text}`}>
            <span className="w-6 shrink-0 text-right text-meta text-muted-foreground">
              {index + 1}
            </span>
            <code className="break-all font-mono text-aux">{pathSegmentText(segment.text)}</code>
            {segment.state === "STATIC" ? null : (
              <StatusBadge
                title={state.hint}
                tone={segment.state === "DYNAMIC" ? "warning" : "neutral"}
              >
                {state.label}
              </StatusBadge>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---- same names across files ---------------------------------------------------

function NameNote({ name, note }: { name: string; note: ZshNameNote }) {
  const place = (item: ZshLocation) => `${item.fileName} 第 ${item.line} 行`;
  if (note.kind === "replaces") {
    return (
      <SameNameHint
        description={`被覆盖的位置：${note.replaced.map(place).join("、")}。按读取顺序，最后一处生效；不同类型的 shell 读取的文件不同。这里不显示被覆盖的值。`}
        label={`覆盖了前面 ${note.replaced.length} 处`}
        title={`${name} 的覆盖位置`}
      />
    );
  }
  return (
    <SameNameHint
      description={`其他位置：${note.others.map(place).join("、")}。含追加或动态写法，最终值无法只看最后一处，全部保留。`}
      label={`同名 ${note.others.length + 1} 处，未合并`}
      title={`${name} 的同名位置`}
    />
  );
}
