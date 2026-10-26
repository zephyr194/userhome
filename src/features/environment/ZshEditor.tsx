import type { Ref } from "react";
import { AsyncState } from "../../components/AsyncState";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ActionRow,
  Button,
  SecretReplacementField,
  StatusBadge,
  TextField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { SECRET_MASK } from "../../components/ui/secretMask";
import type { MessageKey } from "../../i18n";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type {
  ZshEditOutside,
  ZshEditPreview,
  ZshEditState,
  ZshVariableChange,
} from "../../ipc/environment";
import { ActionResultPanel } from "./ActionResultPanel";
import { recoveryText, type EditorNotice } from "./dotenvEditorModel";
import type { ZshEditorController, ZshEditorState } from "./zshEditorController";
import {
  editAvailability,
  fileImpact,
  looksLikeSecretName,
  managedVariables,
  notEnabledText,
  outsideConflicts,
  pathFormNote,
  previewKindText,
  startupFileName,
  valueFormNote,
  variableEditability,
  warningText,
  zshEffectNote,
  type ZshDraftCheck,
} from "./zshEditorModel";
import { pathSegmentText, reasonText, valueStateText, type ZshEditFocus } from "./zshModel";
import { useFocusRequest } from "./useFocusRequest";

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
  /** Where focus should go once the editor shows it: a variable, or the new row. */
  focus?: ZshEditFocus;
}

const WRAP = "break-words [overflow-wrap:anywhere]";
const NOTE_CLASSES = "text-xs leading-relaxed text-muted-foreground";
const CARD_CLASSES = "grid gap-ui-8 px-ui-12 py-ui-8";
const HEADER_CLASSES =
  "flex min-w-0 flex-wrap items-start justify-between gap-ui-8 px-ui-12 pt-ui-16 pb-ui-12";
const CHIP_CLASSES = "rounded-control bg-surface-muted px-ui-8 py-ui-2 font-mono text-aux";

/**
 * Editor for the UserHome managed block of one zsh startup file: variables as
 * single-quoted literals and the PATH list, inside two fixed marker lines.
 * Everything outside the markers is read-only and keeps its exact bytes; a
 * damaged block disables editing instead of being repaired. Secret values are
 * typed into masked inputs, are never shown in the preview, and nothing is
 * written until the preview dialog is confirmed.
 */
export function ZshEditor({ actions, check, focus, state }: ZshEditorProps) {
  const t = useT();
  const focusRef = useFocusRequest<HTMLInputElement>(focus);
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
            {t("env.editor.zsh.headingBefore")}
            <code className="font-mono">{name}</code>
            {t("env.editor.zsh.headingAfter")}
          </h2>
          <p className="mt-ui-4 text-xs text-muted-foreground">{t("env.editor.zsh.headerNote")}</p>
        </div>
        <Button disabled={busy} onClick={actions.close} size="sm" variant="secondary">
          {t("env.editor.zsh.backToReadOnly")}
        </Button>
      </header>
      <div className="grid gap-ui-12 px-ui-12 py-ui-8">
        <Body actions={actions} busy={busy} check={check} focus={focus} focusRef={focusRef} state={state} />
      </div>
    </section>
  );
}

function Body({
  actions,
  busy,
  check,
  focus,
  focusRef,
  state,
}: ZshEditorProps & { busy: boolean; focusRef: Ref<HTMLInputElement> }) {
  const t = useT();
  if (state.phase === "loading" && state.loaded === undefined) {
    return <AsyncState kind="loading">{t("env.editor.zsh.loading")}</AsyncState>;
  }
  if (state.loaded === undefined) {
    const problem = state.problem;
    return (
      <AsyncState kind={problem?.kind === "UNAVAILABLE" || problem?.kind === "ERROR" ? "error" : "partial"}>
        <span className={WRAP}>{problem?.message ?? t("env.editor.zsh.unreadable")}</span>{" "}
        {problem?.kind === "OUTSIDE_HOME" ? null : (
          <Button disabled={busy} onClick={() => void actions.reload()} size="sm" variant="secondary">
            {t("env.editor.zsh.readAgain")}
          </Button>
        )}
      </AsyncState>
    );
  }
  const loaded = state.loaded;
  const availability = editAvailability(loaded, t);
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
          {t("env.editor.zsh.previewGenerating")}
        </p>
      ) : null}
      {state.phase === "saved" && state.result ? (
        <ActionResultPanel
          actions={actions}
          note={state.result.status === "SUCCEEDED" ? zshEffectNote(t) : undefined}
          result={state.result}
          scope="zsh"
        />
      ) : (
        <>
          {editable && check ? (
            <>
              <VariablesSection
                actions={actions}
                check={check}
                disabled={locked}
                focus={focus}
                focusRef={focusRef}
                state={state}
              />
              <PathSection actions={actions} check={check} disabled={locked} state={state} />
              <ActionRow className="min-w-0">
                <Button
                  disabled={locked || !check.ready}
                  onClick={() => void actions.requestPreview()}
                  variant="primary"
                >
                  {state.phase === "previewing"
                    ? t("env.editor.zsh.previewButtonBusy")
                    : t("env.editor.zsh.previewButton")}
                </Button>
                <Button disabled={busy} onClick={actions.close} variant="secondary">
                  {t("env.editor.zsh.cancelEditing")}
                </Button>
                {state.notice ? (
                  <Button disabled={busy} onClick={() => void actions.reload()} variant="secondary">
                    {t("env.editor.zsh.reloadFile")}
                  </Button>
                ) : null}
                {!check.ready && state.phase === "editing" ? (
                  <span className="text-xs text-muted-foreground">
                    {check.changeCount === 0 && noProblems(check)
                      ? t("env.editor.zsh.noChanges")
                      : t("env.editor.zsh.fixFields")}
                  </span>
                ) : null}
              </ActionRow>
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
        "rounded-control border px-ui-8 py-ui-8 text-sm",
        WRAP,
        notice.tone === "error" && "border-danger-border bg-danger-soft text-danger",
        notice.tone === "warning" && "border-transparent bg-warning-soft text-warning",
        notice.tone === "info" && "border-transparent bg-surface-muted text-muted-foreground",
      )}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <p className="m-0 font-medium">{notice.text}</p>
      {notice.detail ? <p className="m-0 mt-ui-4 text-xs">{notice.detail}</p> : null}
    </div>
  );
}

// ---- target and authorization -----------------------------------------------------

function TargetPanel({ loaded }: { loaded: ZshEditState }) {
  const t = useT();
  const impact = fileImpact(loaded, t);
  return (
    <section aria-labelledby="zsh-editor-target-heading" className={CARD_CLASSES}>
      <h3 className="text-sm font-semibold" id="zsh-editor-target-heading">
        {t("env.editor.zsh.target.heading")}
      </h3>
      <p className="text-sm">
        {t("env.editor.zsh.target.fullPath")}
        <code className={classNames("font-mono", WRAP)}>{loaded.fullPath}</code>
        {loaded.exists ? null : (
          <StatusBadge className="ml-ui-8" tone="warning">
            {t("env.editor.zsh.target.missing")}
          </StatusBadge>
        )}
      </p>
      <p className={NOTE_CLASSES}>
        <StatusBadge className="mr-ui-8">{impact.label}</StatusBadge>
        {impact.detail}
      </p>
      <p className={NOTE_CLASSES}>{impact.order}</p>
      <p className={NOTE_CLASSES}>{t("env.editor.zsh.target.defaultNote")}</p>
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
  const t = useT();
  if (!loaded.enabled) {
    return (
      <section aria-labelledby="zsh-editor-auth-heading" className={CARD_CLASSES}>
        <h3 className="text-sm font-semibold" id="zsh-editor-auth-heading">
          {t("env.editor.zsh.auth.heading")}
        </h3>
        <p className={NOTE_CLASSES}>{notEnabledText(t)}</p>
        <p className={NOTE_CLASSES}>
          {t("env.editor.zsh.auth.scopeBefore")}
          <code className={classNames("mx-ui-4 font-mono", WRAP)}>{loaded.fullPath}</code>
          {t("env.editor.zsh.auth.scopeAfter")}
        </p>
        <div>
          <Button disabled={busy} onClick={() => void actions.enable()} variant="primary">
            {t("env.editor.zsh.auth.enable")}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
      <StatusBadge tone="success">{t("env.editor.zsh.auth.enabled")}</StatusBadge>
      <span>{t("env.editor.zsh.auth.enabledNote")}</span>
      <Button disabled={busy} onClick={() => void actions.disable()} size="sm" variant="ghost">
        {t("env.editor.zsh.auth.disable")}
      </Button>
    </div>
  );
}

// ---- variables ----------------------------------------------------------------------

function ConflictNotes({ loaded, name }: { loaded: ZshEditState; name: string }) {
  const t = useT();
  const conflicts = outsideConflicts(loaded, name, t);
  if (conflicts.length === 0) return null;
  return (
    <div className="grid gap-ui-4">
      {conflicts.map((conflict) => (
        <p className="text-xs leading-relaxed text-warning" key={conflict.line} role="note">
          <StatusBadge className="mr-ui-8" tone="warning">
            {t("env.editor.zsh.conflict.badge")}
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
  focus,
  focusRef,
  state,
}: {
  actions: ZshEditorActions;
  check: ZshDraftCheck;
  disabled: boolean;
  focus?: ZshEditFocus;
  focusRef: Ref<HTMLInputElement>;
  state: ZshEditorState;
}) {
  const t = useT();
  const loaded = state.loaded;
  if (loaded === undefined) return null;
  const variables = managedVariables(loaded);
  const target = focus?.target;
  const focusName = target?.kind === "variable" ? target.name : undefined;
  const focusAddition =
    target?.kind === "addition" ? state.drafts.additions[state.drafts.additions.length - 1]?.id : undefined;
  const outsideBlock =
    target?.kind === "variable" && !variables.some((variable) => variable.name === target.name);
  return (
    <section aria-labelledby="zsh-editor-variables-heading" className="grid gap-ui-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <h3 className="text-sm font-semibold" id="zsh-editor-variables-heading">
          {t("env.editor.zsh.var.heading")}
        </h3>
        <Button disabled={disabled} onClick={actions.addVariable} size="sm" variant="secondary">
          {t("env.editor.zsh.var.add")}
        </Button>
      </div>
      <p className={NOTE_CLASSES}>{valueFormNote(t)}</p>
      {outsideBlock && target?.kind === "variable" ? (
        <AsyncState kind="partial">
          <span className={WRAP}>
            {t("env.editor.zsh.var.outsideBlock", { name: target.name, line: target.line })}
          </span>
        </AsyncState>
      ) : null}
      {variables.length === 0 && state.drafts.additions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("env.editor.zsh.var.empty")}</p>
      ) : null}
      {variables.length > 0 ? (
        <ul aria-label={t("env.editor.zsh.var.listLabel")} className="grid gap-ui-8">
          {variables.map((variable) => {
            const editability = variableEditability(variable, t);
            const draft = state.drafts.variables[variable.name];
            const removing = draft?.mode === "remove";
            const problem = check.problems.variables[variable.name];
            return (
              <li
                className={classNames(CARD_CLASSES, "min-w-0", removing && "opacity-80")}
                key={variable.name}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                  <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                    {variable.name}
                  </code>
                  {variable.secret ? (
                    <StatusBadge tone="danger">{t("env.editor.zsh.var.secret")}</StatusBadge>
                  ) : null}
                  {removing ? (
                    <StatusBadge tone="warning">{t("env.editor.zsh.var.removing")}</StatusBadge>
                  ) : null}
                  <span className="text-meta text-muted-foreground">
                    {t("env.editor.zsh.var.line", { line: variable.line })}
                  </span>
                </div>
                {editability.ok ? (
                  <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
                    {variable.secret ? (
                      <SecretReplacementField
                        className="min-w-0 flex-1"
                        description={t("env.editor.zsh.var.secretDescription")}
                        disabled={disabled || removing}
                        error={problem}
                        inputRef={variable.name === focusName ? focusRef : undefined}
                        label={t("env.editor.zsh.var.newValueLabel", { name: variable.name })}
                        onValueChange={(value) => actions.setVariableValue(variable.name, value)}
                        value={draft?.mode === "set" ? draft.value : ""}
                      />
                    ) : (
                      <TextField
                        autoComplete="off"
                        className="min-w-0 flex-1"
                        disabled={disabled || removing}
                        error={problem}
                        inputRef={variable.name === focusName ? focusRef : undefined}
                        label={t("env.editor.zsh.var.valueLabel", { name: variable.name })}
                        onValueChange={(value) => actions.setVariableValue(variable.name, value)}
                        spellCheck={false}
                        value={draft?.mode === "set" ? draft.value : (variable.value ?? "")}
                      />
                    )}
                    <Button
                      aria-label={
                        removing
                          ? t("env.editor.zsh.var.undoRemoveAria", { name: variable.name })
                          : t("env.editor.zsh.var.removeAria", { name: variable.name })
                      }
                      aria-pressed={removing}
                      disabled={disabled}
                      onClick={() => actions.setVariableMode(variable.name, removing ? "keep" : "remove")}
                      size="md"
                      variant="ghost"
                    >
                      {removing
                        ? t("env.editor.zsh.var.undoRemove")
                        : t("env.editor.zsh.var.remove")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-warning" role="note">
                    <StatusBadge className="mr-ui-8" tone="warning">
                      {t("env.editor.zsh.var.notEditable")}
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
        <ul aria-label={t("env.editor.zsh.var.newListLabel")} className="grid gap-ui-8">
          {state.drafts.additions.map((row, index) => {
            const problem = check.problems.additions[row.id];
            const valueProps = {
              className: "min-w-0 flex-1",
              disabled,
              label: t("env.editor.zsh.var.newValueRowLabel", { n: index + 1 }),
              onValueChange: (value: string) => actions.updateVariable(row.id, { value }),
              value: row.value,
            };
            return (
              <li className={classNames(CARD_CLASSES, "min-w-0")} key={row.id}>
                <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    inputRef={row.id === focusAddition ? focusRef : undefined}
                    label={t("env.editor.zsh.var.newNameRowLabel", { n: index + 1 })}
                    onValueChange={(name) => actions.updateVariable(row.id, { name })}
                    spellCheck={false}
                    value={row.name}
                  />
                  {looksLikeSecretName(row.name) ? (
                    <SecretReplacementField
                      {...valueProps}
                      description={t("env.editor.zsh.var.nameLooksSecret")}
                    />
                  ) : (
                    <TextField {...valueProps} autoComplete="off" spellCheck={false} />
                  )}
                  <Button
                    aria-label={t("env.editor.zsh.var.removeRowAria", { n: index + 1 })}
                    disabled={disabled}
                    onClick={() => actions.removeVariable(row.id)}
                    size="md"
                    variant="ghost"
                  >
                    {t("env.editor.zsh.var.removeRow")}
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
  const t = useT();
  const items = state.drafts.path;
  return (
    <section aria-labelledby="zsh-editor-path-heading" className="grid gap-ui-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <h3 className="text-sm font-semibold" id="zsh-editor-path-heading">
          {t("env.editor.zsh.path.heading")}
        </h3>
        <Button disabled={disabled} onClick={actions.addPathItem} size="sm" variant="secondary">
          {t("env.editor.zsh.path.add")}
        </Button>
      </div>
      <p className={NOTE_CLASSES}>{pathFormNote(t)}</p>
      <p className={NOTE_CLASSES}>{t("env.editor.zsh.path.order")}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("env.editor.zsh.path.empty")}</p>
      ) : (
        <ol aria-label={t("env.editor.zsh.path.listLabel")} className="grid gap-ui-8">
          {items.map((item, index) => {
            const problem = check.problems.path[item.id];
            const mark = check.pathMarks[item.id];
            const position = index + 1;
            return (
              <li className={classNames(CARD_CLASSES, "min-w-0")} key={item.id}>
                <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    label={t("env.editor.zsh.path.itemLabel", { n: position })}
                    onValueChange={(text) => actions.updatePathItem(item.id, text)}
                    spellCheck={false}
                    value={item.text}
                  />
                  <ActionRow className="min-w-0">
                    <Button
                      aria-label={t("env.editor.zsh.path.upAria", { n: position })}
                      disabled={disabled || index === 0}
                      onClick={() => actions.movePathItem(item.id, -1)}
                      size="sm"
                      variant="ghost"
                    >
                      {t("env.editor.zsh.path.up")}
                    </Button>
                    <Button
                      aria-label={t("env.editor.zsh.path.downAria", { n: position })}
                      disabled={disabled || index === items.length - 1}
                      onClick={() => actions.movePathItem(item.id, 1)}
                      size="sm"
                      variant="ghost"
                    >
                      {t("env.editor.zsh.path.down")}
                    </Button>
                    <Button
                      aria-label={t("env.editor.zsh.path.deleteAria", { n: position })}
                      disabled={disabled}
                      onClick={() => actions.removePathItem(item.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {t("env.editor.zsh.path.delete")}
                    </Button>
                  </ActionRow>
                </div>
                {mark?.duplicate || mark?.outsideLine !== undefined ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                    {mark.duplicate ? (
                      <StatusBadge tone="warning">{t("env.editor.zsh.path.duplicate")}</StatusBadge>
                    ) : null}
                    {mark.outsideLine !== undefined ? (
                      <StatusBadge tone="warning">
                        {t("env.editor.zsh.path.outsideHas", { line: mark.outsideLine })}
                      </StatusBadge>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className={NOTE_CLASSES}>
        {t("env.editor.zsh.path.tailBefore")}
        <code className="font-mono">$path</code>
        {t("env.editor.zsh.path.tailAfter")}
      </p>
    </section>
  );
}

// ---- outside the block (read-only) --------------------------------------------------------

function OutsidePanel({ loaded }: { loaded: ZshEditState }) {
  const t = useT();
  const outside: ZshEditOutside = loaded.outside;
  const nothing =
    outside.path.length === 0 && outside.dynamicPathLines.length === 0;
  return (
    <section aria-labelledby="zsh-editor-outside-heading" className={CARD_CLASSES}>
      <h3 className="text-sm font-semibold" id="zsh-editor-outside-heading">
        {t("env.editor.zsh.outside.heading")}
      </h3>
      <p className={NOTE_CLASSES}>{t("env.editor.zsh.outside.note")}</p>
      {nothing ? (
        <p className="text-xs text-muted-foreground">{t("env.editor.zsh.outside.none")}</p>
      ) : (
        <ul aria-label={t("env.editor.zsh.outside.listLabel")} className="grid gap-ui-8">
          {outside.path.map((path) => (
            <li
              className="grid min-w-0 gap-ui-4 rounded-control bg-surface px-ui-8 py-ui-8"
              key={`${path.line}:path`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
                <span>{t("env.editor.zsh.outside.line", { line: path.line })}</span>
                <StatusBadge>
                  {path.beforeBlock
                    ? t("env.editor.zsh.outside.beforeBlock")
                    : t("env.editor.zsh.outside.afterBlock")}
                </StatusBadge>
                {path.operation === "APPEND" ? (
                  <StatusBadge>{t("env.editor.zsh.outside.append")}</StatusBadge>
                ) : null}
                <StatusBadge
                  title={valueStateText(path.state, t).hint}
                  tone={path.state === "DYNAMIC" ? "warning" : "neutral"}
                >
                  {valueStateText(path.state, t).label}
                </StatusBadge>
                {path.reason ? (
                  <StatusBadge title={reasonText(path.reason, t).hint} tone="warning">
                    {reasonText(path.reason, t).label}
                  </StatusBadge>
                ) : null}
              </div>
              <ol
                aria-label={t("env.editor.zsh.outside.pathItemsLabel", { line: path.line })}
                className="flex min-w-0 flex-wrap gap-ui-4"
              >
                {path.segments.map((segment, index) => (
                  <li key={`${index}:${segment.text}`}>
                    <code className={classNames(CHIP_CLASSES, WRAP)}>
                      {pathSegmentText(segment.text, t)}
                    </code>
                  </li>
                ))}
              </ol>
            </li>
          ))}
          {outside.dynamicPathLines.map((line) => (
            <li
              className="grid min-w-0 gap-ui-4 rounded-control bg-surface px-ui-8 py-ui-8"
              key={`${line.line}:dynamic`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
                <span>{t("env.editor.zsh.outside.line", { line: line.line })}</span>
                <StatusBadge>
                  {line.beforeBlock
                    ? t("env.editor.zsh.outside.beforeBlock")
                    : t("env.editor.zsh.outside.afterBlock")}
                </StatusBadge>
                <StatusBadge tone="warning">{t("env.editor.zsh.outside.dynamic")}</StatusBadge>
                {line.reason ? (
                  <StatusBadge title={reasonText(line.reason, t).hint} tone="warning">
                    {reasonText(line.reason, t).label}
                  </StatusBadge>
                ) : null}
              </div>
              {line.withheld || line.text === undefined ? (
                <p className="text-xs text-muted-foreground">{t("env.editor.zsh.outside.hidden")}</p>
              ) : (
                <code className={classNames("font-mono text-aux", WRAP)}>{line.text}</code>
              )}
            </li>
          ))}
        </ul>
      )}
      {outside.truncated ? (
        <p className="text-xs text-warning">{t("env.editor.zsh.outside.truncated")}</p>
      ) : null}
    </section>
  );
}

// ---- preview -----------------------------------------------------------------------------

const CHANGE_KEYS: Record<ZshVariableChange["change"], MessageKey> = {
  ADD: "env.editor.zsh.change.ADD",
  MODIFY: "env.editor.zsh.change.MODIFY",
  REMOVE: "env.editor.zsh.change.REMOVE",
};

function ChangeValue({ change }: { change: ZshVariableChange }) {
  const t = useT();
  if (change.secret) {
    return (
      <span className="text-xs text-muted-foreground">
        <code className={CHIP_CLASSES}>
          <span aria-hidden="true">{SECRET_MASK}</span>
          <span className="sr-only">{t("env.editor.zsh.value.masked")}</span>
        </code>{" "}
        {t("env.editor.zsh.value.secretNotShown")}
      </span>
    );
  }
  if (change.omitted) {
    return <span className="text-xs text-muted-foreground">{t("env.editor.zsh.value.omitted")}</span>;
  }
  const shown = (text: string) => (
    <code className={classNames(CHIP_CLASSES, WRAP)}>
      {text === "" ? t("env.editor.zsh.value.empty") : text}
    </code>
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-ui-8">
      {change.before !== undefined ? shown(change.before) : null}
      {change.before !== undefined && change.after !== undefined ? (
        <span aria-label={t("env.editor.zsh.value.changedTo")}>→</span>
      ) : null}
      {change.after !== undefined ? shown(change.after) : null}
    </span>
  );
}

function PathList({ items, label }: { items: readonly string[]; label: string }) {
  const t = useT();
  return items.length === 0 ? (
    <span className="text-xs text-muted-foreground">{t("env.editor.zsh.path.none")}</span>
  ) : (
    <ol aria-label={label} className="flex min-w-0 flex-wrap gap-ui-4">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>
          <code className={classNames(CHIP_CLASSES, WRAP)}>{item}</code>
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
  const t = useT();
  const locale = useLocale();
  const created = preview.kind === "CREATE";
  const impact = fileImpact(preview, t);
  const changeCount = preview.variableChanges.length + (preview.pathChange ? 1 : 0);
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-ui-16"
      onCancel={actions.cancelPreview}
      titleId="zsh-preview-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-ui-12">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            {t("env.editor.zsh.preview.eyebrow")}
          </p>
          <h3 className={WRAP} id="zsh-preview-heading">
            {previewKindText(preview, t)}
          </h3>
        </div>
        <StatusBadge tone={created ? "success" : "warning"}>
          {created ? t("env.editor.zsh.preview.badgeCreate") : t("env.editor.zsh.preview.badgeModify")}
        </StatusBadge>
      </div>

      <p className="text-sm">
        {t("env.editor.zsh.preview.target")}
        <code className={classNames("font-mono", WRAP)}>{preview.fullPath}</code>
      </p>
      <p className={NOTE_CLASSES}>
        <StatusBadge className="mr-ui-8">{impact.label}</StatusBadge>
        {impact.detail}
        {impact.order}
      </p>

      {preview.warnings.length > 0 ? (
        <section aria-labelledby="zsh-warnings-heading">
          <h4 className="text-sm font-semibold" id="zsh-warnings-heading">
            {t("env.editor.zsh.preview.warnings", { count: preview.warnings.length })}
          </h4>
          <ul aria-label={t("env.editor.zsh.preview.warningsLabel")} className="mt-ui-8 grid gap-ui-4">
            {preview.warnings.map((warning, index) => (
              <li
                className="rounded-control bg-warning-soft px-ui-8 py-ui-8 text-xs leading-relaxed text-warning"
                key={`${index}:${warning.kind}`}
                role="note"
              >
                {warningText(warning, t)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="zsh-changes-heading">
        <h4 className="text-sm font-semibold" id="zsh-changes-heading">
          {t("env.editor.zsh.preview.changes", { count: changeCount })}
        </h4>
        <ul aria-label={t("env.editor.zsh.preview.changesLabel")} className="mt-ui-8 grid gap-ui-8">
          {preview.variableChanges.map((change) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control bg-surface-muted px-ui-8 py-ui-8"
              key={change.name}
            >
              <StatusBadge tone={change.change === "REMOVE" ? "danger" : "neutral"}>
                {t(CHANGE_KEYS[change.change])}
              </StatusBadge>
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {change.name}
              </code>
              {change.secret ? (
                <StatusBadge tone="danger">{t("env.editor.zsh.var.secret")}</StatusBadge>
              ) : null}
              <ChangeValue change={change} />
            </li>
          ))}
          {preview.pathChange ? (
            <li className="grid min-w-0 gap-ui-4 rounded-control bg-surface-muted px-ui-8 py-ui-8">
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                <StatusBadge>PATH</StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {t("env.editor.zsh.path.blockItems")}
                </span>
              </div>
              <PathList
                items={preview.pathChange.before}
                label={t("env.editor.zsh.path.changeBefore")}
              />
              <span aria-label={t("env.editor.zsh.value.changedTo")} className="text-xs text-muted-foreground">
                ↓
              </span>
              <PathList
                items={preview.pathChange.after}
                label={t("env.editor.zsh.path.changeAfter")}
              />
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="zsh-diff-heading">
        <h4 className="text-sm font-semibold" id="zsh-diff-heading">
          {t("env.editor.zsh.preview.diffHeading")}
        </h4>
        <pre
          aria-label={t("env.editor.zsh.preview.diffHeading")}
          className={classNames(
            "mt-ui-8 max-h-48 overflow-auto rounded-control bg-surface-muted px-ui-8 py-ui-8 font-mono text-aux",
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
        <p className="mt-ui-8 text-xs text-muted-foreground">{t("env.editor.zsh.preview.diffNote")}</p>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("env.editor.zsh.preview.recoveryLine", {
          recovery: recoveryText(preview.kind, preview.recoveryPoint, t),
          check: t("env.editor.zsh.preview.afterWriteCheck"),
        })}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{zshEffectNote(t)}</p>
      <p className="text-xs text-muted-foreground">
        {t("env.editor.zsh.preview.expiresBefore")}
        <time dateTime={preview.expiresAt}>{formatDateTime(preview.expiresAt, locale)}</time>
        {t("env.editor.zsh.preview.expiresAfter")}
      </p>

      {busy ? (
        <p aria-live="polite" className="text-sm text-warning" role="status">
          {t("env.editor.zsh.preview.busy")}
        </p>
      ) : null}
      <ActionRow align="end">
        <Button data-dialog-cancel disabled={busy} onClick={actions.cancelPreview} variant="secondary">
          {t("env.editor.zsh.preview.back")}
        </Button>
        <Button disabled={busy} onClick={() => void actions.confirm()} variant="primary">
          {created ? t("env.editor.zsh.preview.confirmCreate") : t("env.editor.zsh.preview.confirmWrite")}
        </Button>
      </ActionRow>
    </ConfirmDialog>
  );
}
