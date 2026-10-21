import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  Button,
  CheckboxField,
  SecretReplacementField,
  StatusBadge,
  TextField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { SECRET_MASK } from "../../components/ui/secretMask";
import type { EnvChange, EnvEditPreview } from "../../ipc/environment";
import type { DotenvEditorController, EditorState } from "./dotenvEditorController";
import {
  canResumeEditing,
  entryEditability,
  looksLikeSecretName,
  previewHeadline,
  recoveryText,
  saveResultText,
  type DraftCheck,
  type EditorNotice,
  type EntryRow,
  type SaveResult,
} from "./dotenvEditorModel";

export type DotenvEditorActions = Pick<
  DotenvEditorController,
  | "addRow"
  | "cancelPreview"
  | "close"
  | "confirm"
  | "removeRow"
  | "requestPreview"
  | "resumeEditing"
  | "setEntryMode"
  | "setEntryValue"
  | "updateRow"
>;

export interface DotenvEditorProps {
  state: EditorState;
  /** The current drafts checked against the file (`controller.check()`). */
  check: DraftCheck;
  actions: DotenvEditorActions;
}

const WRAP = "break-words [overflow-wrap:anywhere]";

/**
 * Key-level editor for one dotenv file, or for a new file. Only the values
 * the user changes are sent; comments, blank lines, unknown lines and every
 * untouched key keep their exact bytes. Secret values are typed into masked
 * inputs, are never shown in the preview, and nothing is written until the
 * preview dialog is confirmed.
 */
export function DotenvEditor({ actions, check, state }: DotenvEditorProps) {
  const { target } = state;
  if (target === undefined) return null;
  const busy = state.phase === "previewing" || state.phase === "saving";
  const locked = state.phase !== "editing";
  const rows =
    target.kind === "existing"
      ? target.file.rows.filter((row): row is EntryRow => row.kind === "ENTRY")
      : [];

  return (
    <div className="grid gap-ui-lg">
      <div className="grid gap-ui-xs text-xs leading-relaxed text-muted-foreground">
        {target.kind === "new" ? (
          <p>
            新文件：<code className={classNames("font-mono", WRAP)}>{target.displayPath}</code>
            。这是你在“选择保存位置”里指定的目标与名称；预览会标明它将被创建，且没有恢复点。
          </p>
        ) : (
          <p>
            编辑 <code className={classNames("font-mono", WRAP)}>{target.path}</code>
            ：只发送你改动过的键；注释、空行、未识别行和未改动的键保持原样。
          </p>
        )}
        <p>
          值按字面量写入：含空格、#、引号、$ 或 Unicode 的值会加上能被读回的引号；含换行、
          控制字符或无法安全引用的值会被拒绝，不会变成插值、命令替换或多行值。保存前先预览，写入前先备份。
        </p>
      </div>

      {state.notice ? <Notice notice={state.notice} /> : null}
      {state.phase === "previewing" ? (
        <p className="text-xs text-muted-foreground" role="status">
          正在生成预览…
        </p>
      ) : null}

      {state.phase === "saved" && state.result ? (
        <ResultPanel actions={actions} result={state.result} />
      ) : (
        <>
          {target.kind === "existing" ? (
            <EntryList
              check={check}
              disabled={locked}
              onMode={actions.setEntryMode}
              onValue={actions.setEntryValue}
              rows={rows}
              state={state}
            />
          ) : null}
          <AdditionList actions={actions} check={check} disabled={locked} state={state} />
          <div className="flex min-w-0 flex-wrap items-center gap-ui-md">
            <Button
              disabled={locked || !check.ready}
              onClick={() => void actions.requestPreview()}
              variant="primary"
            >
              {state.phase === "previewing" ? "生成预览中…" : "预览改动"}
            </Button>
            <Button disabled={busy} onClick={actions.close}>
              取消编辑
            </Button>
            {!check.ready && state.phase === "editing" ? (
              <span className="text-xs text-muted-foreground">
                {check.edits.length === 0 && noProblems(check)
                  ? "还没有改动。"
                  : "请先修正标红的字段。"}
              </span>
            ) : null}
          </div>
        </>
      )}

      {state.preview && (state.phase === "previewed" || state.phase === "saving") ? (
        <PreviewDialog
          actions={actions}
          busy={state.phase === "saving"}
          preview={state.preview}
        />
      ) : null}
    </div>
  );
}

function noProblems(check: DraftCheck): boolean {
  return (
    Object.keys(check.problems.entries).length === 0 &&
    Object.keys(check.problems.additions).length === 0
  );
}

function Notice({ notice }: { notice: EditorNotice }) {
  return (
    <div
      className={classNames(
        "rounded-control border px-ui-lg py-ui-md text-sm",
        WRAP,
        notice.tone === "error" && "border-danger-border bg-danger-soft text-danger",
        notice.tone === "warning" && "border-transparent bg-warning-soft text-warning",
        notice.tone === "info" && "border-transparent bg-surface-muted text-muted-foreground",
      )}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <p className="m-0 font-medium">{notice.text}</p>
      {notice.detail ? <p className="m-0 mt-ui-xs text-xs">{notice.detail}</p> : null}
    </div>
  );
}

// ---- existing entries ------------------------------------------------------

function EntryList({
  check,
  disabled,
  onMode,
  onValue,
  rows,
  state,
}: {
  check: DraftCheck;
  disabled: boolean;
  onMode: DotenvEditorActions["setEntryMode"];
  onValue: DotenvEditorActions["setEntryValue"];
  rows: EntryRow[];
  state: EditorState;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">文件里还没有键值项。</p>;
  }
  return (
    <ul aria-label="已有的键" className="grid gap-ui-md">
      {rows.map((row) => {
        const editability = entryEditability(row);
        const draft = state.entryEdits[row.key];
        const removing = draft?.mode === "remove";
        const problem = check.problems.entries[row.key];
        return (
          <li
            className={classNames(
              "grid min-w-0 gap-ui-sm rounded-control bg-surface-muted px-ui-md py-ui-md",
              removing && "opacity-80",
            )}
            key={`${row.line}:${row.key}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {row.key}
              </code>
              {row.exported ? <StatusBadge>export</StatusBadge> : null}
              {row.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
              {removing ? <StatusBadge tone="warning">将删除</StatusBadge> : null}
              <span className="text-meta text-muted-foreground">第 {row.line} 行</span>
            </div>
            {editability.ok ? (
              <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
                {row.secret ? (
                  <SecretReplacementField
                    className="min-w-0 flex-1"
                    description="秘密不会显示。输入新值以替换；留空表示不修改。"
                    disabled={disabled || removing}
                    error={problem}
                    label={`${row.key} 的新值`}
                    onValueChange={(value) => onValue(row.key, value)}
                    value={draft?.mode === "set" ? draft.value : ""}
                  />
                ) : (
                  <TextField
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled || removing}
                    error={problem}
                    label={`${row.key} 的值`}
                    onValueChange={(value) => onValue(row.key, value)}
                    spellCheck={false}
                    value={draft?.mode === "set" ? draft.value : (row.value ?? "")}
                  />
                )}
                <Button
                  aria-label={removing ? `撤销删除 ${row.key}` : `删除 ${row.key}`}
                  aria-pressed={removing}
                  disabled={disabled}
                  onClick={() => onMode(row.key, removing ? "keep" : "remove")}
                  size="md"
                  variant={removing ? "secondary" : "ghost"}
                >
                  {removing ? "撤销删除" : "删除"}
                </Button>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-warning" role="note">
                <StatusBadge className="mr-ui-sm" tone="warning">
                  不可修改
                </StatusBadge>
                {editability.reason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---- new keys -----------------------------------------------------------------

function AdditionList({
  actions,
  check,
  disabled,
  state,
}: {
  actions: DotenvEditorActions;
  check: DraftCheck;
  disabled: boolean;
  state: EditorState;
}) {
  return (
    <section aria-labelledby="dotenv-additions-heading" className="grid gap-ui-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md">
        <h3 className="text-sm font-semibold" id="dotenv-additions-heading">
          新增键
        </h3>
        <Button disabled={disabled} onClick={actions.addRow} size="sm">
          新增一行
        </Button>
      </div>
      {state.additions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {state.target?.kind === "new"
            ? "新文件至少需要一个键。点击“新增一行”。"
            : "没有新增的键。新键会追加到文件末尾。"}
        </p>
      ) : (
        <ul aria-label="新增的键" className="grid gap-ui-md">
          {state.additions.map((row, index) => {
            const problem = check.problems.additions[row.id];
            const secret = looksLikeSecretName(row.key);
            const valueProps = {
              className: "min-w-0 flex-1",
              disabled,
              label: `第 ${index + 1} 行的值`,
              onValueChange: (value: string) => actions.updateRow(row.id, { value }),
              value: row.value,
            };
            return (
              <li
                className="grid min-w-0 gap-ui-sm rounded-control bg-surface-muted px-ui-md py-ui-md"
                key={row.id}
              >
                <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    label={`第 ${index + 1} 行的键名`}
                    onValueChange={(key) => actions.updateRow(row.id, { key })}
                    spellCheck={false}
                    value={row.key}
                  />
                  {secret ? (
                    <SecretReplacementField
                      {...valueProps}
                      description="键名像秘密，输入已遮盖。"
                    />
                  ) : (
                    <TextField {...valueProps} autoComplete="off" spellCheck={false} />
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-ui-md">
                  <CheckboxField
                    checked={row.exported}
                    disabled={disabled}
                    label="写成 export KEY=…"
                    onCheckedChange={(exported) => actions.updateRow(row.id, { exported })}
                  />
                  <Button
                    aria-label={`移除第 ${index + 1} 行`}
                    disabled={disabled}
                    onClick={() => actions.removeRow(row.id)}
                    size="sm"
                    variant="ghost"
                  >
                    移除该行
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- preview --------------------------------------------------------------------

const CHANGE_LABEL: Record<EnvChange["change"], string> = {
  ADD: "新增",
  MODIFY: "修改",
  REMOVE: "删除",
};

function ChangeValue({ change }: { change: EnvChange }) {
  if (change.secret) {
    return (
      <span className="text-xs text-muted-foreground">
        <code className="rounded-control bg-surface px-ui-md py-ui-xxs font-mono text-aux">
          <span aria-hidden="true">{SECRET_MASK}</span>
          <span className="sr-only">值已遮盖</span>
        </code>{" "}
        秘密值不在预览中显示
      </span>
    );
  }
  if (change.omitted) {
    return <span className="text-xs text-muted-foreground">（值过长，未显示）</span>;
  }
  const shown = (text: string) => (
    <code className={classNames("rounded-control bg-surface px-ui-md py-ui-xxs font-mono text-aux", WRAP)}>
      {text === "" ? "（空值）" : text}
    </code>
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-ui-sm">
      {change.before !== undefined ? shown(change.before) : null}
      {change.before !== undefined && change.after !== undefined ? (
        <span aria-label="改为">→</span>
      ) : null}
      {change.after !== undefined ? shown(change.after) : null}
    </span>
  );
}

function PreviewDialog({
  actions,
  busy,
  preview,
}: {
  actions: DotenvEditorActions;
  busy: boolean;
  preview: EnvEditPreview;
}) {
  const created = preview.kind === "CREATE";
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-ui-3xl"
      onCancel={actions.cancelPreview}
      titleId="dotenv-preview-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-ui-2xl">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            待确认写入
          </p>
          <h3 className={WRAP} id="dotenv-preview-heading">
            {previewHeadline(preview)}
          </h3>
        </div>
        <StatusBadge tone={created ? "success" : "warning"}>
          {created ? "创建" : "修改"}
        </StatusBadge>
      </div>

      <p className="text-sm">
        目标：<code className={classNames("font-mono", WRAP)}>{preview.target}</code>
        {preview.fileKind === "TEMPLATE" ? (
          <StatusBadge className="ml-ui-sm" tone="warning">
            模板文件
          </StatusBadge>
        ) : null}
      </p>
      {preview.fileKind === "TEMPLATE" ? (
        <p className="text-xs leading-relaxed text-warning">
          文件名是模板（如 .env.example）：模板只描述变量，不会与真实环境文件合并成运行时值。
        </p>
      ) : null}
      {created && !preview.matchesDefaultPatterns ? (
        <p className="text-xs leading-relaxed text-warning">
          该文件名不在默认 pattern（.env、.env.*、*.env）之内：可以创建，但默认扫描不会列出它。
        </p>
      ) : null}

      <section aria-labelledby="dotenv-changes-heading">
        <h4 className="text-sm font-semibold" id="dotenv-changes-heading">
          改动（{preview.changes.length} 项）
        </h4>
        <ul aria-label="本次改动" className="mt-ui-sm grid gap-ui-sm">
          {preview.changes.map((change) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-sm rounded-control bg-surface-muted px-ui-md py-ui-sm"
              key={change.key}
            >
              <StatusBadge tone={change.change === "REMOVE" ? "danger" : "neutral"}>
                {CHANGE_LABEL[change.change]}
              </StatusBadge>
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {change.key}
              </code>
              {change.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
              <ChangeValue change={change} />
            </li>
          ))}
        </ul>
        <p className="mt-ui-sm text-xs text-muted-foreground">
          其余内容（注释、空行、未识别行和未改动的键）保持原样；完整文本差异不显示，以免暴露秘密值。
        </p>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {recoveryText(preview.kind, preview.recoveryPoint)}
        写入后会重新读取并校验改动的键与其余行；校验失败会恢复并如实报告。
      </p>
      <p className="text-xs text-muted-foreground">
        到期时间：
        <time dateTime={preview.expiresAt}>
          {new Date(preview.expiresAt).toLocaleString("zh-CN")}
        </time>
        。文件在预览后被修改、授权失效或目标被替换时，会拒绝写入并要求重新预览。
      </p>

      {busy ? (
        <p className="text-sm text-warning" role="status" aria-live="polite">
          正在写入并校验…
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-ui-sm">
        <Button data-dialog-cancel disabled={busy} onClick={actions.cancelPreview}>
          返回修改
        </Button>
        <Button disabled={busy} onClick={() => void actions.confirm()} variant="primary">
          {created ? "确认创建" : "确认写入"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}

// ---- result -----------------------------------------------------------------------

function ResultPanel({
  actions,
  result,
}: {
  actions: DotenvEditorActions;
  result: SaveResult;
}) {
  const text = saveResultText(result);
  return (
    <section
      aria-labelledby="dotenv-result-heading"
      className={classNames(
        "grid gap-ui-sm rounded-control border px-ui-lg py-ui-md text-sm",
        WRAP,
        text.tone === "success" && "border-transparent bg-success-soft text-success",
        text.tone === "danger" && "border-danger-border bg-danger-soft text-danger",
        text.tone === "warning" && "border-transparent bg-warning-soft text-warning",
      )}
      role={text.tone === "success" ? "status" : "alert"}
    >
      <h3 className="m-0 text-sm font-semibold" id="dotenv-result-heading">
        {result.status === "SUCCEEDED" ? "保存结果" : "保存未完成"}
      </h3>
      <p className="m-0">{text.headline}</p>
      {text.detail ? <p className="m-0 text-xs">{text.detail}</p> : null}
      {result.recoveryPoint === "BACKUP" && result.backupId ? (
        <p className="m-0 text-xs">备份编号：{result.backupId}</p>
      ) : null}
      {result.errorMessage ? <p className="m-0 text-xs">原因：{result.errorMessage}</p> : null}
      <div className="flex flex-wrap gap-ui-md">
        <Button onClick={actions.close} variant={result.status === "SUCCEEDED" ? "primary" : "secondary"}>
          完成
        </Button>
        {result.status === "FAILED" && canResumeEditing(result) ? (
          <Button onClick={actions.resumeEditing}>返回继续编辑</Button>
        ) : null}
      </div>
    </section>
  );
}
