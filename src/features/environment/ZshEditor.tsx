import { AsyncState } from "../../components/AsyncState";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  Button,
  SecretReplacementField,
  StatusBadge,
  TextField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { SECRET_MASK } from "../../components/ui/secretMask";
import type {
  ZshEditOutside,
  ZshEditPreview,
  ZshEditState,
  ZshVariableChange,
} from "../../ipc/environment";
import {
  canResumeEditing,
  recoveryText,
  saveResultText,
  type EditorNotice,
  type SaveResult,
} from "./dotenvEditorModel";
import type { ZshEditorController, ZshEditorState } from "./zshEditorController";
import {
  NOT_ENABLED_TEXT,
  PATH_FORM_NOTE,
  VALUE_FORM_NOTE,
  ZSH_EFFECT_NOTE,
  editAvailability,
  fileImpact,
  looksLikeSecretName,
  managedVariables,
  outsideConflicts,
  previewKindText,
  startupFileName,
  variableEditability,
  warningText,
  type ZshDraftCheck,
} from "./zshEditorModel";
import { pathSegmentText, reasonText, valueStateText } from "./zshModel";

export type ZshEditorActions = Pick<
  ZshEditorController,
  | "addPathItem"
  | "addVariable"
  | "cancelPreview"
  | "close"
  | "confirm"
  | "disable"
  | "enable"
  | "movePathItem"
  | "reload"
  | "removePathItem"
  | "removeVariable"
  | "requestPreview"
  | "resumeEditing"
  | "setVariableMode"
  | "setVariableValue"
  | "updatePathItem"
  | "updateVariable"
>;

export interface ZshEditorProps {
  state: ZshEditorState;
  /** The current drafts checked against the file (`controller.check()`). */
  check: ZshDraftCheck | undefined;
  actions: ZshEditorActions;
}

const WRAP = "break-words [overflow-wrap:anywhere]";
const NOTE_CLASSES = "text-xs leading-relaxed text-muted-foreground";
const CARD_CLASSES = "grid gap-ui-sm rounded-control bg-surface-muted px-ui-xl py-ui-md";
const HEADER_CLASSES =
  "flex min-w-0 flex-wrap items-start justify-between gap-ui-lg border-b border-border bg-surface-muted px-ui-xl py-ui-md";

/**
 * Editor for the UserHome managed block of one zsh startup file: variables as
 * single-quoted literals and the PATH list, inside two fixed marker lines.
 * Everything outside the markers is read-only and keeps its exact bytes; a
 * damaged block disables editing instead of being repaired. Secret values are
 * typed into masked inputs, are never shown in the preview, and nothing is
 * written until the preview dialog is confirmed.
 */
export function ZshEditor({ actions, check, state }: ZshEditorProps) {
  const busy =
    state.phase === "loading" ||
    state.phase === "enabling" ||
    state.phase === "previewing" ||
    state.phase === "saving";
  const name = state.loaded?.name ?? (state.target ? startupFileName(state.target.file) : "");
  return (
    <section
      aria-labelledby="zsh-editor-heading"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain"
    >
      <header className={HEADER_CLASSES}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" id="zsh-editor-heading">
            编辑 <code className="font-mono">{name}</code> 的 UserHome 专用块
          </h2>
          <p className="mt-ui-xs text-xs text-muted-foreground">
            只改动专用块里的变量与 PATH；块外的内容保持原样，不会被改写。
          </p>
        </div>
        <Button disabled={busy} onClick={actions.close} size="sm">
          返回只读视图
        </Button>
      </header>
      <div className="grid gap-ui-xl px-ui-xl py-ui-md">
        <Body actions={actions} busy={busy} check={check} state={state} />
      </div>
    </section>
  );
}

function Body({
  actions,
  busy,
  check,
  state,
}: ZshEditorProps & { busy: boolean }) {
  if (state.phase === "loading" && state.loaded === undefined) {
    return <AsyncState kind="loading">正在读取文件…</AsyncState>;
  }
  if (state.loaded === undefined) {
    const problem = state.problem;
    return (
      <AsyncState kind={problem?.kind === "UNAVAILABLE" || problem?.kind === "ERROR" ? "error" : "partial"}>
        <span className={WRAP}>{problem?.message ?? "无法读取该文件。"}</span>{" "}
        {problem?.kind === "OUTSIDE_HOME" ? null : (
          <Button disabled={busy} onClick={() => void actions.reload()} size="sm">
            重新读取
          </Button>
        )}
      </AsyncState>
    );
  }
  const loaded = state.loaded;
  const availability = editAvailability(loaded);
  const editable = availability.kind === "ready";
  const locked = state.phase !== "editing";
  return (
    <>
      <TargetPanel loaded={loaded} />
      <AuthorizationPanel actions={actions} busy={busy} loaded={loaded} />
      {state.notice ? <Notice notice={state.notice} /> : null}
      {availability.kind === "blocked" ? (
        <AsyncState kind="error">
          <span className={WRAP}>{availability.reason}</span>
        </AsyncState>
      ) : null}
      {state.phase === "previewing" ? (
        <p className="text-xs text-muted-foreground" role="status">
          正在生成预览…
        </p>
      ) : null}
      {state.phase === "saved" && state.result ? (
        <ResultPanel actions={actions} result={state.result} />
      ) : (
        <>
          {editable && check ? (
            <>
              <VariablesSection actions={actions} check={check} disabled={locked} state={state} />
              <PathSection actions={actions} check={check} disabled={locked} state={state} />
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
                {state.notice ? (
                  <Button disabled={busy} onClick={() => void actions.reload()}>
                    重新读取文件
                  </Button>
                ) : null}
                {!check.ready && state.phase === "editing" ? (
                  <span className="text-xs text-muted-foreground">
                    {check.changeCount === 0 && noProblems(check)
                      ? "还没有改动。"
                      : "请先修正标红的字段。"}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
          <OutsidePanel loaded={loaded} />
        </>
      )}
      {state.preview && (state.phase === "previewed" || state.phase === "saving") ? (
        <PreviewDialog
          actions={actions}
          busy={state.phase === "saving"}
          preview={state.preview}
        />
      ) : null}
    </>
  );
}

function noProblems(check: ZshDraftCheck): boolean {
  return (
    Object.keys(check.problems.variables).length === 0 &&
    Object.keys(check.problems.additions).length === 0 &&
    Object.keys(check.problems.path).length === 0
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

// ---- target and authorization -----------------------------------------------------

function TargetPanel({ loaded }: { loaded: ZshEditState }) {
  const impact = fileImpact(loaded);
  return (
    <section aria-labelledby="zsh-editor-target-heading" className={CARD_CLASSES}>
      <h3 className="text-sm font-semibold" id="zsh-editor-target-heading">
        目标文件与影响范围
      </h3>
      <p className="text-sm">
        完整路径：<code className={classNames("font-mono", WRAP)}>{loaded.fullPath}</code>
        {loaded.exists ? null : (
          <StatusBadge className="ml-ui-sm" tone="warning">
            文件不存在，保存时创建
          </StatusBadge>
        )}
      </p>
      <p className={NOTE_CLASSES}>
        <StatusBadge className="mr-ui-sm">{impact.label}</StatusBadge>
        {impact.detail}
      </p>
      <p className={NOTE_CLASSES}>{impact.order}</p>
      <p className={NOTE_CLASSES}>
        默认编辑 .zshrc；.zshenv、.zprofile、.zlogin 需要你在只读视图里逐次选择它们的“编辑专用块”。专用块之外的内容永远不会被改写。
      </p>
    </section>
  );
}

function AuthorizationPanel({
  actions,
  busy,
  loaded,
}: {
  actions: ZshEditorActions;
  busy: boolean;
  loaded: ZshEditState;
}) {
  if (!loaded.enabled) {
    return (
      <section aria-labelledby="zsh-editor-auth-heading" className={CARD_CLASSES}>
        <h3 className="text-sm font-semibold" id="zsh-editor-auth-heading">
          启用编辑
        </h3>
        <p className={NOTE_CLASSES}>{NOT_ENABLED_TEXT}</p>
        <p className={NOTE_CLASSES}>
          授权只针对这个具体文件
          <code className={classNames("mx-ui-xs font-mono", WRAP)}>{loaded.fullPath}</code>
          ，不是整个主目录，也可以随时撤销（启用后可在这里的按钮或授权列表里操作）。
        </p>
        <div>
          <Button disabled={busy} onClick={() => void actions.enable()} variant="primary">
            启用编辑
          </Button>
        </div>
      </section>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-ui-md text-xs text-muted-foreground">
      <StatusBadge tone="success">已启用编辑</StatusBadge>
      <span>这个文件的授权可以撤销；撤销后不能再保存。</span>
      <Button disabled={busy} onClick={() => void actions.disable()} size="sm" variant="ghost">
        停用编辑
      </Button>
    </div>
  );
}

// ---- variables ----------------------------------------------------------------------

function ConflictNotes({ loaded, name }: { loaded: ZshEditState; name: string }) {
  const conflicts = outsideConflicts(loaded, name);
  if (conflicts.length === 0) return null;
  return (
    <div className="grid gap-ui-xs">
      {conflicts.map((conflict) => (
        <p className="text-xs leading-relaxed text-warning" key={conflict.line} role="note">
          <StatusBadge className="mr-ui-sm" tone="warning">
            块外同名
          </StatusBadge>
          {conflict.text}
        </p>
      ))}
    </div>
  );
}

function VariablesSection({
  actions,
  check,
  disabled,
  state,
}: {
  actions: ZshEditorActions;
  check: ZshDraftCheck;
  disabled: boolean;
  state: ZshEditorState;
}) {
  const loaded = state.loaded;
  if (loaded === undefined) return null;
  const variables = managedVariables(loaded);
  return (
    <section aria-labelledby="zsh-editor-variables-heading" className="grid gap-ui-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md">
        <h3 className="text-sm font-semibold" id="zsh-editor-variables-heading">
          变量（export NAME='字面量'）
        </h3>
        <Button disabled={disabled} onClick={actions.addVariable} size="sm">
          新增变量
        </Button>
      </div>
      <p className={NOTE_CLASSES}>{VALUE_FORM_NOTE}</p>
      {variables.length === 0 && state.drafts.additions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          专用块里还没有变量。块外的同名赋值不会被读取为专用块的变量，也不会被删除。
        </p>
      ) : null}
      {variables.length > 0 ? (
        <ul aria-label="专用块里的变量" className="grid gap-ui-md">
          {variables.map((variable) => {
            const editability = variableEditability(variable);
            const draft = state.drafts.variables[variable.name];
            const removing = draft?.mode === "remove";
            const problem = check.problems.variables[variable.name];
            return (
              <li
                className={classNames(CARD_CLASSES, "min-w-0", removing && "opacity-80")}
                key={variable.name}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
                  <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                    {variable.name}
                  </code>
                  {variable.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
                  {removing ? <StatusBadge tone="warning">将删除</StatusBadge> : null}
                  <span className="text-meta text-muted-foreground">第 {variable.line} 行</span>
                </div>
                {editability.ok ? (
                  <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
                    {variable.secret ? (
                      <SecretReplacementField
                        className="min-w-0 flex-1"
                        description="秘密不会显示。输入新值以替换；留空表示不修改。"
                        disabled={disabled || removing}
                        error={problem}
                        label={`${variable.name} 的新值`}
                        onValueChange={(value) => actions.setVariableValue(variable.name, value)}
                        value={draft?.mode === "set" ? draft.value : ""}
                      />
                    ) : (
                      <TextField
                        autoComplete="off"
                        className="min-w-0 flex-1"
                        disabled={disabled || removing}
                        error={problem}
                        label={`${variable.name} 的值`}
                        onValueChange={(value) => actions.setVariableValue(variable.name, value)}
                        spellCheck={false}
                        value={draft?.mode === "set" ? draft.value : (variable.value ?? "")}
                      />
                    )}
                    <Button
                      aria-label={removing ? `撤销删除 ${variable.name}` : `删除 ${variable.name}`}
                      aria-pressed={removing}
                      disabled={disabled}
                      onClick={() => actions.setVariableMode(variable.name, removing ? "keep" : "remove")}
                      size="sm"
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
                <ConflictNotes loaded={loaded} name={variable.name} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {state.drafts.additions.length > 0 ? (
        <ul aria-label="新增的变量" className="grid gap-ui-md">
          {state.drafts.additions.map((row, index) => {
            const problem = check.problems.additions[row.id];
            const valueProps = {
              className: "min-w-0 flex-1",
              disabled,
              label: `新增第 ${index + 1} 行的值`,
              onValueChange: (value: string) => actions.updateVariable(row.id, { value }),
              value: row.value,
            };
            return (
              <li className={classNames(CARD_CLASSES, "min-w-0")} key={row.id}>
                <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    label={`新增第 ${index + 1} 行的变量名`}
                    onValueChange={(name) => actions.updateVariable(row.id, { name })}
                    spellCheck={false}
                    value={row.name}
                  />
                  {looksLikeSecretName(row.name) ? (
                    <SecretReplacementField {...valueProps} description="变量名像秘密，输入已遮盖。" />
                  ) : (
                    <TextField {...valueProps} autoComplete="off" spellCheck={false} />
                  )}
                  <Button
                    aria-label={`移除新增第 ${index + 1} 行`}
                    disabled={disabled}
                    onClick={() => actions.removeVariable(row.id)}
                    size="sm"
                    variant="ghost"
                  >
                    移除该行
                  </Button>
                </div>
                {problem === undefined ? <ConflictNotes loaded={loaded} name={row.name} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

// ---- PATH -------------------------------------------------------------------------------

function PathSection({
  actions,
  check,
  disabled,
  state,
}: {
  actions: ZshEditorActions;
  check: ZshDraftCheck;
  disabled: boolean;
  state: ZshEditorState;
}) {
  const items = state.drafts.path;
  return (
    <section aria-labelledby="zsh-editor-path-heading" className="grid gap-ui-md">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md">
        <h3 className="text-sm font-semibold" id="zsh-editor-path-heading">
          PATH（专用块里的项）
        </h3>
        <Button disabled={disabled} onClick={actions.addPathItem} size="sm">
          新增 PATH 项
        </Button>
      </div>
      <p className={NOTE_CLASSES}>{PATH_FORM_NOTE}</p>
      <p className={NOTE_CLASSES}>
        列表自上而下优先级由高到低；用“上移／下移”按钮调整顺序，不需要拖拽。
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          专用块里还没有 PATH 项。新增的项会放在原有 PATH 之前。
        </p>
      ) : (
        <ol aria-label="专用块的 PATH 项（优先级由高到低）" className="grid gap-ui-md">
          {items.map((item, index) => {
            const problem = check.problems.path[item.id];
            const mark = check.pathMarks[item.id];
            const position = index + 1;
            return (
              <li className={classNames(CARD_CLASSES, "min-w-0")} key={item.id}>
                <div className="flex min-w-0 flex-wrap items-end gap-ui-md">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    label={`PATH 第 ${position} 项`}
                    onValueChange={(text) => actions.updatePathItem(item.id, text)}
                    spellCheck={false}
                    value={item.text}
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
                    <Button
                      aria-label={`上移 PATH 第 ${position} 项`}
                      disabled={disabled || index === 0}
                      onClick={() => actions.movePathItem(item.id, -1)}
                      size="sm"
                    >
                      上移
                    </Button>
                    <Button
                      aria-label={`下移 PATH 第 ${position} 项`}
                      disabled={disabled || index === items.length - 1}
                      onClick={() => actions.movePathItem(item.id, 1)}
                      size="sm"
                    >
                      下移
                    </Button>
                    <Button
                      aria-label={`删除 PATH 第 ${position} 项`}
                      disabled={disabled}
                      onClick={() => actions.removePathItem(item.id)}
                      size="sm"
                      variant="ghost"
                    >
                      删除
                    </Button>
                  </div>
                </div>
                {mark?.duplicate || mark?.outsideLine !== undefined ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
                    {mark.duplicate ? <StatusBadge tone="warning">重复项</StatusBadge> : null}
                    {mark.outsideLine !== undefined ? (
                      <StatusBadge tone="warning">块外第 {mark.outsideLine} 行已有</StatusBadge>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className={NOTE_CLASSES}>
        其后固定接着原有的 <code className="font-mono">$path</code>（块之前和块之后的 PATH 设置不受影响）。
      </p>
    </section>
  );
}

// ---- outside the block (read-only) --------------------------------------------------------

function OutsidePanel({ loaded }: { loaded: ZshEditState }) {
  const outside: ZshEditOutside = loaded.outside;
  const nothing =
    outside.path.length === 0 && outside.dynamicPathLines.length === 0;
  return (
    <section aria-labelledby="zsh-editor-outside-heading" className={CARD_CLASSES}>
      <h3 className="text-sm font-semibold" id="zsh-editor-outside-heading">
        块外的 PATH（只读）
      </h3>
      <p className={NOTE_CLASSES}>
        这些是专用块之外的内容：按原文显示，不展开、不覆盖、不据猜测值改写，保存后每个字节保持不变。动态／未解析的写法不会被推断成有效值。
      </p>
      {nothing ? (
        <p className="text-xs text-muted-foreground">专用块之外没有 PATH 设置。</p>
      ) : (
        <ul aria-label="块外的 PATH 设置" className="grid gap-ui-sm">
          {outside.path.map((path) => (
            <li
              className="grid min-w-0 gap-ui-xs rounded-control bg-surface px-ui-md py-ui-sm"
              key={`${path.line}:path`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-sm text-xs text-muted-foreground">
                <span>第 {path.line} 行</span>
                <StatusBadge>{path.beforeBlock ? "在专用块之前" : "在专用块之后"}</StatusBadge>
                {path.operation === "APPEND" ? <StatusBadge>追加</StatusBadge> : null}
                <StatusBadge
                  title={valueStateText(path.state).hint}
                  tone={path.state === "DYNAMIC" ? "warning" : "neutral"}
                >
                  {valueStateText(path.state).label}
                </StatusBadge>
                {path.reason ? (
                  <StatusBadge title={reasonText(path.reason).hint} tone="warning">
                    {reasonText(path.reason).label}
                  </StatusBadge>
                ) : null}
              </div>
              <ol aria-label={`第 ${path.line} 行的 PATH 项`} className="flex min-w-0 flex-wrap gap-ui-xs">
                {path.segments.map((segment, index) => (
                  <li key={`${index}:${segment.text}`}>
                    <code
                      className={classNames(
                        "rounded-control bg-surface-muted px-ui-md py-ui-xxs font-mono text-aux",
                        WRAP,
                      )}
                    >
                      {pathSegmentText(segment.text)}
                    </code>
                  </li>
                ))}
              </ol>
            </li>
          ))}
          {outside.dynamicPathLines.map((line) => (
            <li
              className="grid min-w-0 gap-ui-xs rounded-control bg-surface px-ui-md py-ui-sm"
              key={`${line.line}:dynamic`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-sm text-xs text-muted-foreground">
                <span>第 {line.line} 行</span>
                <StatusBadge>{line.beforeBlock ? "在专用块之前" : "在专用块之后"}</StatusBadge>
                <StatusBadge tone="warning">动态／未解析</StatusBadge>
                {line.reason ? (
                  <StatusBadge title={reasonText(line.reason).hint} tone="warning">
                    {reasonText(line.reason).label}
                  </StatusBadge>
                ) : null}
              </div>
              {line.withheld || line.text === undefined ? (
                <p className="text-xs text-muted-foreground">（疑似含秘密，内容已隐藏）</p>
              ) : (
                <code className={classNames("font-mono text-aux", WRAP)}>{line.text}</code>
              )}
            </li>
          ))}
        </ul>
      )}
      {outside.truncated ? (
        <p className="text-xs text-warning">块外内容过多，只显示了一部分。</p>
      ) : null}
    </section>
  );
}

// ---- preview -----------------------------------------------------------------------------

const CHANGE_LABEL: Record<ZshVariableChange["change"], string> = {
  ADD: "新增",
  MODIFY: "修改",
  REMOVE: "删除",
};

function ChangeValue({ change }: { change: ZshVariableChange }) {
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

function PathList({ items, label }: { items: readonly string[]; label: string }) {
  return items.length === 0 ? (
    <span className="text-xs text-muted-foreground">（没有 PATH 项）</span>
  ) : (
    <ol aria-label={label} className="flex min-w-0 flex-wrap gap-ui-xs">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>
          <code className={classNames("rounded-control bg-surface px-ui-md py-ui-xxs font-mono text-aux", WRAP)}>
            {item}
          </code>
        </li>
      ))}
    </ol>
  );
}

function PreviewDialog({
  actions,
  busy,
  preview,
}: {
  actions: ZshEditorActions;
  busy: boolean;
  preview: ZshEditPreview;
}) {
  const created = preview.kind === "CREATE";
  const impact = fileImpact(preview);
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={actions.cancelPreview}
      titleId="zsh-preview-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            待确认写入
          </p>
          <h3 className={WRAP} id="zsh-preview-heading">
            {previewKindText(preview)}
          </h3>
        </div>
        <StatusBadge tone={created ? "success" : "warning"}>
          {created ? "创建" : "修改"}
        </StatusBadge>
      </div>

      <p className="text-sm">
        目标：<code className={classNames("font-mono", WRAP)}>{preview.fullPath}</code>
      </p>
      <p className={NOTE_CLASSES}>
        <StatusBadge className="mr-ui-sm">{impact.label}</StatusBadge>
        {impact.detail}
        {impact.order}
      </p>

      {preview.warnings.length > 0 ? (
        <section aria-labelledby="zsh-warnings-heading">
          <h4 className="text-sm font-semibold" id="zsh-warnings-heading">
            需要留意（{preview.warnings.length}）
          </h4>
          <ul aria-label="预览提示" className="mt-ui-sm grid gap-ui-xs">
            {preview.warnings.map((warning, index) => (
              <li
                className="rounded-control bg-warning-soft px-ui-md py-ui-sm text-xs leading-relaxed text-warning"
                key={`${index}:${warning.kind}`}
                role="note"
              >
                {warningText(warning)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="zsh-changes-heading">
        <h4 className="text-sm font-semibold" id="zsh-changes-heading">
          改动（{preview.variableChanges.length + (preview.pathChange ? 1 : 0)} 项）
        </h4>
        <ul aria-label="本次改动" className="mt-ui-sm grid gap-ui-sm">
          {preview.variableChanges.map((change) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-sm rounded-control bg-surface-muted px-ui-md py-ui-sm"
              key={change.name}
            >
              <StatusBadge tone={change.change === "REMOVE" ? "danger" : "neutral"}>
                {CHANGE_LABEL[change.change]}
              </StatusBadge>
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {change.name}
              </code>
              {change.secret ? <StatusBadge tone="danger">秘密</StatusBadge> : null}
              <ChangeValue change={change} />
            </li>
          ))}
          {preview.pathChange ? (
            <li className="grid min-w-0 gap-ui-xs rounded-control bg-surface-muted px-ui-md py-ui-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-ui-sm">
                <StatusBadge>PATH</StatusBadge>
                <span className="text-xs text-muted-foreground">
                  专用块里的 PATH 项（其后仍是原有 PATH）
                </span>
              </div>
              <PathList items={preview.pathChange.before} label="改动前的 PATH 项" />
              <span aria-label="改为" className="text-xs text-muted-foreground">
                ↓
              </span>
              <PathList items={preview.pathChange.after} label="改动后的 PATH 项" />
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="zsh-diff-heading">
        <h4 className="text-sm font-semibold" id="zsh-diff-heading">
          专用块的行变化
        </h4>
        <pre
          aria-label="专用块的行变化"
          className={classNames(
            "mt-ui-sm max-h-48 overflow-auto rounded-control bg-surface-muted px-ui-md py-ui-sm font-mono text-aux",
            WRAP,
          )}
          // The block can be long, so keyboard users must be able to scroll it.
          tabIndex={0}
        >
          {preview.blockDiff.map((line, index) => (
            <div
              className={line.kind === "ADDED" ? "text-success" : "text-danger"}
              key={`${index}:${line.kind}`}
            >
              {line.kind === "ADDED" ? "+ " : "- "}
              {line.text}
            </div>
          ))}
        </pre>
        <p className="mt-ui-sm text-xs text-muted-foreground">
          只显示专用块的行，秘密值已遮盖。完整文本差异不显示（块外可能有秘密）；块外的每个字节保持不变，写入后会读回校验。
        </p>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {recoveryText(preview.kind, preview.recoveryPoint)}
        写入后会重新读取并校验：专用块的内容与预览一致、块外字节不变、每个值读回为同样的字面量；校验失败会恢复并如实报告。
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{ZSH_EFFECT_NOTE}</p>
      <p className="text-xs text-muted-foreground">
        到期时间：
        <time dateTime={preview.expiresAt}>
          {new Date(preview.expiresAt).toLocaleString("zh-CN")}
        </time>
        。文件在预览后被修改、授权被撤销或目标被替换时，会拒绝写入并要求重新预览。
      </p>

      {busy ? (
        <p aria-live="polite" className="text-sm text-warning" role="status">
          正在写入并校验…
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
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

// ---- result -------------------------------------------------------------------------------

function ResultPanel({
  actions,
  result,
}: {
  actions: ZshEditorActions;
  result: SaveResult;
}) {
  const text = saveResultText(result);
  return (
    <section
      aria-labelledby="zsh-result-heading"
      className={classNames(
        "grid gap-ui-sm rounded-control border px-ui-lg py-ui-md text-sm",
        WRAP,
        text.tone === "success" && "border-transparent bg-success-soft text-success",
        text.tone === "danger" && "border-danger-border bg-danger-soft text-danger",
        text.tone === "warning" && "border-transparent bg-warning-soft text-warning",
      )}
      role={text.tone === "success" ? "status" : "alert"}
    >
      <h3 className="m-0 text-sm font-semibold" id="zsh-result-heading">
        {result.status === "SUCCEEDED" ? "保存结果" : "保存未完成"}
      </h3>
      <p className="m-0">{text.headline}</p>
      {text.detail ? <p className="m-0 text-xs">{text.detail}</p> : null}
      {result.status === "SUCCEEDED" ? <p className="m-0 text-xs">{ZSH_EFFECT_NOTE}</p> : null}
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
