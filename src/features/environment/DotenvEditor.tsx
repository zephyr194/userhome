import type { Ref } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ActionRow,
  Button,
  CheckboxField,
  SecretReplacementField,
  StatusBadge,
  TextField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { SECRET_MASK } from "../../components/ui/secretMask";
import type { MessageKey } from "../../i18n";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type { EnvChange, EnvEditPreview } from "../../ipc/environment";
import { ActionResultPanel } from "./ActionResultPanel";
import type { DotenvEditorController, EditorState } from "./dotenvEditorController";
import {
  entryEditability,
  looksLikeSecretName,
  previewHeadline,
  recoveryText,
  type DraftCheck,
  type EditorNotice,
  type EntryRow,
} from "./dotenvEditorModel";
import type { DotenvEditFocus } from "./environmentModel";
import { useFocusRequest } from "./useFocusRequest";

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
  /** Where focus should go once the editor shows it: a line, or the new row. */
  focus?: DotenvEditFocus;
}

const WRAP = "break-words [overflow-wrap:anywhere]";
const CHIP_CLASSES = "rounded-control bg-surface px-ui-8 py-ui-2 font-mono text-aux";

const CHANGE_KEYS: Record<EnvChange["change"], MessageKey> = {
  ADD: "env.editor.dotenv.change.ADD",
  MODIFY: "env.editor.dotenv.change.MODIFY",
  REMOVE: "env.editor.dotenv.change.REMOVE",
};

/**
 * Key-level editor for one dotenv file, or for a new file. Only the values
 * the user changes are sent; comments, blank lines, unknown lines and every
 * untouched key keep their exact bytes. Secret values are typed into masked
 * inputs, are never shown in the preview, and nothing is written until the
 * preview dialog is confirmed.
 */
export function DotenvEditor({ actions, check, focus, state }: DotenvEditorProps) {
  const t = useT();
  const focusRef = useFocusRequest<HTMLInputElement>(focus);
  const { target } = state;
  if (target === undefined) return null;
  const busy = state.phase === "previewing" || state.phase === "saving";
  const locked = state.phase !== "editing";
  const rows =
    target.kind === "existing"
      ? target.file.rows.filter((row): row is EntryRow => row.kind === "ENTRY")
      : [];
  const focusTarget = {
    line: focus?.target.kind === "entry" ? focus.target.line : undefined,
    addition:
      focus?.target.kind === "addition"
        ? state.additions[state.additions.length - 1]?.id
        : undefined,
  };

  return (
    <div className="grid gap-ui-8">
      <div className="grid gap-ui-4 text-xs leading-relaxed text-muted-foreground">
        {target.kind === "new" ? (
          <p>
            {t("env.editor.dotenv.newFile.before")}
            <code className={classNames("font-mono", WRAP)}>{target.displayPath}</code>
            {t("env.editor.dotenv.newFile.after")}
          </p>
        ) : (
          <p>
            {t("env.editor.dotenv.editFile.before")}
            <code className={classNames("font-mono", WRAP)}>{target.path}</code>
            {t("env.editor.dotenv.editFile.after")}
          </p>
        )}
        <p>{t("env.editor.dotenv.literalNote")}</p>
      </div>

      {state.notice ? <Notice notice={state.notice} /> : null}
      {state.phase === "previewing" ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("env.editor.dotenv.previewing")}
        </p>
      ) : null}

      {state.phase === "saved" && state.result ? (
        <ActionResultPanel actions={actions} result={state.result} scope="dotenv" />
      ) : (
        <>
          {target.kind === "existing" ? (
            <EntryList
              check={check}
              disabled={locked}
              focusLine={focusTarget.line}
              focusRef={focusRef}
              onMode={actions.setEntryMode}
              onValue={actions.setEntryValue}
              rows={rows}
              state={state}
            />
          ) : null}
          <AdditionList
            actions={actions}
            check={check}
            disabled={locked}
            focusId={focusTarget.addition}
            focusRef={focusRef}
            state={state}
          />
          <ActionRow className="min-w-0">
            <Button
              disabled={locked || !check.ready}
              onClick={() => void actions.requestPreview()}
              variant="primary"
            >
              {state.phase === "previewing"
                ? t("env.editor.dotenv.action.previewBusy")
                : t("env.editor.dotenv.action.preview")}
            </Button>
            <Button disabled={busy} onClick={actions.close} variant="secondary">
              {t("env.editor.dotenv.action.cancel")}
            </Button>
            {!check.ready && state.phase === "editing" ? (
              <span className="text-xs text-muted-foreground">
                {check.edits.length === 0 && noProblems(check)
                  ? t("env.editor.dotenv.action.noChanges")
                  : t("env.editor.dotenv.action.fixFields")}
              </span>
            ) : null}
          </ActionRow>
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

// ---- existing entries ------------------------------------------------------

function EntryList({
  check,
  disabled,
  focusLine,
  focusRef,
  onMode,
  onValue,
  rows,
  state,
}: {
  check: DraftCheck;
  disabled: boolean;
  focusLine?: number;
  focusRef: Ref<HTMLInputElement>;
  onMode: DotenvEditorActions["setEntryMode"];
  onValue: DotenvEditorActions["setEntryValue"];
  rows: EntryRow[];
  state: EditorState;
}) {
  const t = useT();
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("env.editor.dotenv.entries.empty")}</p>;
  }
  return (
    <ul aria-label={t("env.editor.dotenv.entries.listLabel")} className="grid gap-ui-8">
      {rows.map((row) => {
        const editability = entryEditability(row, t);
        const draft = state.entryEdits[row.key];
        const removing = draft?.mode === "remove";
        const problem = check.problems.entries[row.key];
        const inputRef = row.line === focusLine ? focusRef : undefined;
        return (
          <li
            className={classNames(
              "grid min-w-0 gap-ui-8 rounded-control bg-surface-muted px-ui-8 py-ui-8",
              removing && "opacity-80",
            )}
            key={`${row.line}:${row.key}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {row.key}
              </code>
              {row.exported ? <StatusBadge>export</StatusBadge> : null}
              {row.secret ? (
                <StatusBadge tone="danger">{t("env.editor.dotenv.entry.secret")}</StatusBadge>
              ) : null}
              {removing ? (
                <StatusBadge tone="warning">{t("env.editor.dotenv.entry.removing")}</StatusBadge>
              ) : null}
              <span className="text-meta text-muted-foreground">
                {t("env.editor.dotenv.entry.line", { line: row.line })}
              </span>
            </div>
            {editability.ok ? (
              <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
                {row.secret ? (
                  <SecretReplacementField
                    className="min-w-0 flex-1"
                    description={t("env.editor.dotenv.entry.secretDescription")}
                    disabled={disabled || removing}
                    error={problem}
                    inputRef={inputRef}
                    label={t("env.editor.dotenv.entry.newValueLabel", { key: row.key })}
                    onValueChange={(value) => onValue(row.key, value)}
                    value={draft?.mode === "set" ? draft.value : ""}
                  />
                ) : (
                  <TextField
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled || removing}
                    error={problem}
                    inputRef={inputRef}
                    label={t("env.editor.dotenv.entry.valueLabel", { key: row.key })}
                    onValueChange={(value) => onValue(row.key, value)}
                    spellCheck={false}
                    value={draft?.mode === "set" ? draft.value : (row.value ?? "")}
                  />
                )}
                <Button
                  aria-label={
                    removing
                      ? t("env.editor.dotenv.entry.undoRemoveAria", { key: row.key })
                      : t("env.editor.dotenv.entry.removeAria", { key: row.key })
                  }
                  aria-pressed={removing}
                  disabled={disabled}
                  onClick={() => onMode(row.key, removing ? "keep" : "remove")}
                  size="md"
                  variant="ghost"
                >
                  {removing
                    ? t("env.editor.dotenv.entry.undoRemove")
                    : t("env.editor.dotenv.entry.remove")}
                </Button>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-warning" role="note">
                <StatusBadge className="mr-ui-8" tone="warning">
                  {t("env.editor.dotenv.entry.notEditable")}
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
  focusId,
  focusRef,
  state,
}: {
  actions: DotenvEditorActions;
  check: DraftCheck;
  disabled: boolean;
  focusId?: number;
  focusRef: Ref<HTMLInputElement>;
  state: EditorState;
}) {
  const t = useT();
  return (
    <section aria-labelledby="dotenv-additions-heading" className="grid gap-ui-8">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
        <h3 className="text-sm font-semibold" id="dotenv-additions-heading">
          {t("env.editor.dotenv.additions.heading")}
        </h3>
        <Button disabled={disabled} onClick={actions.addRow} size="sm" variant="secondary">
          {t("env.editor.dotenv.additions.addRow")}
        </Button>
      </div>
      {state.additions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {state.target?.kind === "new"
            ? t("env.editor.dotenv.additions.emptyNew")
            : t("env.editor.dotenv.additions.emptyExisting")}
        </p>
      ) : (
        <ul aria-label={t("env.editor.dotenv.additions.listLabel")} className="grid gap-ui-8">
          {state.additions.map((row, index) => {
            const problem = check.problems.additions[row.id];
            const secret = looksLikeSecretName(row.key);
            const valueProps = {
              className: "min-w-0 flex-1",
              disabled,
              label: t("env.editor.dotenv.additions.valueRowLabel", { n: index + 1 }),
              onValueChange: (value: string) => actions.updateRow(row.id, { value }),
              value: row.value,
            };
            return (
              <li
                className="grid min-w-0 gap-ui-8 rounded-control bg-surface-muted px-ui-8 py-ui-8"
                key={row.id}
              >
                <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
                  <TextField
                    autoCapitalize="off"
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    disabled={disabled}
                    error={problem}
                    inputRef={row.id === focusId ? focusRef : undefined}
                    label={t("env.editor.dotenv.additions.keyRowLabel", { n: index + 1 })}
                    onValueChange={(key) => actions.updateRow(row.id, { key })}
                    spellCheck={false}
                    value={row.key}
                  />
                  {secret ? (
                    <SecretReplacementField
                      {...valueProps}
                      description={t("env.editor.dotenv.additions.keyLooksSecret")}
                    />
                  ) : (
                    <TextField {...valueProps} autoComplete="off" spellCheck={false} />
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                  <CheckboxField
                    checked={row.exported}
                    disabled={disabled}
                    label={t("env.editor.dotenv.additions.exportLabel")}
                    onCheckedChange={(exported) => actions.updateRow(row.id, { exported })}
                  />
                  <Button
                    aria-label={t("env.editor.dotenv.additions.removeAria", { n: index + 1 })}
                    disabled={disabled}
                    onClick={() => actions.removeRow(row.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {t("env.editor.dotenv.additions.removeRow")}
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

function ChangeValue({ change }: { change: EnvChange }) {
  const t = useT();
  if (change.secret) {
    return (
      <span className="text-xs text-muted-foreground">
        <code className={CHIP_CLASSES}>
          <span aria-hidden="true">{SECRET_MASK}</span>
          <span className="sr-only">{t("env.editor.dotenv.value.masked")}</span>
        </code>{" "}
        {t("env.editor.dotenv.value.secretNotShown")}
      </span>
    );
  }
  if (change.omitted) {
    return <span className="text-xs text-muted-foreground">{t("env.editor.dotenv.value.omitted")}</span>;
  }
  const shown = (text: string) => (
    <code className={classNames(CHIP_CLASSES, WRAP)}>
      {text === "" ? t("env.editor.dotenv.value.empty") : text}
    </code>
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-ui-8">
      {change.before !== undefined ? shown(change.before) : null}
      {change.before !== undefined && change.after !== undefined ? (
        <span aria-label={t("env.editor.dotenv.value.changedTo")}>→</span>
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
  const t = useT();
  const locale = useLocale();
  const created = preview.kind === "CREATE";
  return (
    <ConfirmDialog
      busy={busy}
      bodyClassName="space-y-ui-16"
      onCancel={actions.cancelPreview}
      titleId="dotenv-preview-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-ui-12">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">
            {t("env.editor.dotenv.preview.eyebrow")}
          </p>
          <h3 className={WRAP} id="dotenv-preview-heading">
            {previewHeadline(preview, t)}
          </h3>
        </div>
        <StatusBadge tone={created ? "success" : "warning"}>
          {created
            ? t("env.editor.dotenv.preview.badgeCreate")
            : t("env.editor.dotenv.preview.badgeModify")}
        </StatusBadge>
      </div>

      <p className="text-sm">
        {t("env.editor.dotenv.preview.target")}
        <code className={classNames("font-mono", WRAP)}>{preview.target}</code>
        {preview.fileKind === "TEMPLATE" ? (
          <StatusBadge className="ml-ui-8" tone="warning">
            {t("env.editor.dotenv.preview.template")}
          </StatusBadge>
        ) : null}
      </p>
      {preview.fileKind === "TEMPLATE" ? (
        <p className="text-xs leading-relaxed text-warning">
          {t("env.editor.dotenv.preview.templateNote")}
        </p>
      ) : null}
      {created && !preview.matchesDefaultPatterns ? (
        <p className="text-xs leading-relaxed text-warning">
          {t("env.editor.dotenv.preview.defaultPattern")}
        </p>
      ) : null}

      <section aria-labelledby="dotenv-changes-heading">
        <h4 className="text-sm font-semibold" id="dotenv-changes-heading">
          {t("env.editor.dotenv.preview.changes", { count: preview.changes.length })}
        </h4>
        <ul aria-label={t("env.editor.dotenv.preview.changesLabel")} className="mt-ui-8 grid gap-ui-8">
          {preview.changes.map((change) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control bg-surface-muted px-ui-8 py-ui-8"
              key={change.key}
            >
              <StatusBadge tone={change.change === "REMOVE" ? "danger" : "neutral"}>
                {t(CHANGE_KEYS[change.change])}
              </StatusBadge>
              <code className={classNames("font-mono text-aux font-semibold", WRAP)}>
                {change.key}
              </code>
              {change.secret ? (
                <StatusBadge tone="danger">{t("env.editor.dotenv.entry.secret")}</StatusBadge>
              ) : null}
              <ChangeValue change={change} />
            </li>
          ))}
        </ul>
        <p className="mt-ui-8 text-xs text-muted-foreground">
          {t("env.editor.dotenv.preview.restNote")}
        </p>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("env.editor.dotenv.preview.recoveryLine", {
          recovery: recoveryText(preview.kind, preview.recoveryPoint, t),
          check: t("env.editor.dotenv.preview.afterWriteCheck"),
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("env.editor.dotenv.preview.expiresBefore")}
        <time dateTime={preview.expiresAt}>{formatDateTime(preview.expiresAt, locale)}</time>
        {t("env.editor.dotenv.preview.expiresAfter")}
      </p>

      {busy ? (
        <p className="text-sm text-warning" role="status" aria-live="polite">
          {t("env.editor.dotenv.preview.busy")}
        </p>
      ) : null}
      <ActionRow align="end">
        <Button data-dialog-cancel disabled={busy} onClick={actions.cancelPreview} variant="secondary">
          {t("env.editor.dotenv.preview.back")}
        </Button>
        <Button disabled={busy} onClick={() => void actions.confirm()} variant="primary">
          {created
            ? t("env.editor.dotenv.preview.confirmCreate")
            : t("env.editor.dotenv.preview.confirmWrite")}
        </Button>
      </ActionRow>
    </ConfirmDialog>
  );
}
