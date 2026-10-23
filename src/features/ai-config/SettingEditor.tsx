import { useReducer, useState } from "react";
import { Button, StatusBadge } from "../../components/ui";
import {
  CheckboxField,
  SelectField,
  TextField,
} from "../../components/ui/forms";
import {
  confirmClaudeEdit,
  previewClaudeEdit,
  type ClaudeEditAction,
  type ClaudeEditCatalog,
  type ClaudeEditItem,
  type ClaudeEditPreview,
  type ClaudeReadView,
} from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import { localizeError } from "../../i18n/errors";
import type { MessageKey } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import { HighlightText } from "./ConfigSearchControls";
import { configSearchItem, matchesSearch, searchTerms } from "./configSearch";
import {
  buildEditRequest,
  diffSymbol,
  editBlockedReason,
  editControl,
  editReducer,
  groupSettings,
  initialDraft,
  recoveryNote,
  resultMessage,
  settingBadges,
  userLevelText,
  versionNoteText,
  type EditDraft,
  type EditPhase,
} from "./claudeEditModel";

export interface SettingsFileSelection {
  readonly id: string;
  readonly displayPath: string;
}

export interface SettingEditorProps {
  readonly item: ClaudeEditItem;
  readonly settingsGrantId: string | null;
  readonly onSaved: () => void;
}

const ACTION_LABEL_KEYS: Record<ClaudeEditAction, MessageKey> = {
  set: "aiConfig.edit.action.set",
  restoreDefault: "aiConfig.edit.action.restoreDefault",
  setNull: "aiConfig.edit.action.setNull",
};

export function SettingEditor({
  item,
  settingsGrantId,
  onSaved,
}: SettingEditorProps) {
  const t = useT();
  const [draft, setDraft] = useState<EditDraft>(() => initialDraft(item));
  const [phase, dispatch] = useReducer(editReducer, {
    status: "idle",
  } as EditPhase);
  const blocked = editBlockedReason(item, settingsGrantId, t);
  const control = editControl(item);
  const busy = phase.status === "previewing" || phase.status === "confirming";

  const runPreview = (action: ClaudeEditAction) => {
    if (settingsGrantId === null) return;
    const built = buildEditRequest(item, settingsGrantId, action, draft, t);
    if (!built.ok) {
      dispatch({
        type: "failed",
        error: {
          code: "INVALID_INPUT",
          message: built.reason,
          retryable: false,
        },
      });
      return;
    }
    dispatch({ type: "previewStart", action });
    previewClaudeEdit(built.request).then(
      (preview) => dispatch({ type: "previewReady", preview }),
      (error: unknown) =>
        dispatch({ type: "failed", error: decodeAppError(error) }),
    );
  };

  const runConfirm = (operationId: string) => {
    if (settingsGrantId === null) return;
    dispatch({ type: "confirmStart" });
    confirmClaudeEdit({ operationId, grantId: settingsGrantId }).then(
      (result) => {
        dispatch({ type: "confirmDone", result });
        if (result.outcome.status === "SUCCEEDED") onSaved();
      },
      (error: unknown) =>
        dispatch({ type: "failed", error: decodeAppError(error) }),
    );
  };

  return (
    <section
      aria-label={t("aiConfig.edit.rowLabel", { key: item.keyPath })}
      className="grid min-w-0 gap-ui-8"
    >
      {blocked ? (
        <p className="m-0 text-aux text-danger" role="status">
          {blocked}
        </p>
      ) : null}

      {control === "boolean" ? (
        <CheckboxField
          label={t("aiConfig.edit.switchOn")}
          description={item.description}
          checked={draft === true}
          disabled={blocked !== null || busy}
          onCheckedChange={(checked) => setDraft(checked)}
        />
      ) : null}
      {control === "enum" ? (
        <SelectField<string>
          label={t("aiConfig.edit.valueLabel")}
          description={item.description}
          value={typeof draft === "string" ? draft : ""}
          disabled={blocked !== null || busy}
          options={item.allowedValues.map((value) => ({ value, label: value }))}
          onValueChange={(value) => setDraft(value)}
        />
      ) : null}
      {control === "string" ? (
        <TextField
          label={t("aiConfig.edit.textLabel")}
          description={item.description}
          value={typeof draft === "string" ? draft : ""}
          maxLength={256}
          disabled={blocked !== null || busy}
          onValueChange={(value) => setDraft(value)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-ui-8">
        {(["set", "restoreDefault", "setNull"] as const).map((action) => (
          <Button
            key={action}
            variant="secondary"
            disabled={
              blocked !== null ||
              busy ||
              (action === "set" && control === "none")
            }
            onClick={() => runPreview(action)}
          >
            {t(ACTION_LABEL_KEYS[action])}
          </Button>
        ))}
      </div>

      <PhaseView
        phase={phase}
        onConfirm={runConfirm}
        onCancel={() => dispatch({ type: "cancel" })}
      />
    </section>
  );
}

export function PhaseView({
  phase,
  onConfirm,
  onCancel,
}: {
  readonly phase: EditPhase;
  readonly onConfirm: (operationId: string) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  switch (phase.status) {
    case "idle":
      return null;
    case "previewing":
      return (
        <p className="m-0 text-aux text-muted-foreground" role="status">
          {t("aiConfig.edit.previewing")}
        </p>
      );
    case "previewed":
      return (
        <PreviewBlock
          preview={phase.preview}
          busy={false}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "confirming":
      return (
        <PreviewBlock
          preview={phase.preview}
          busy
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "saved":
      return (
        <p className="m-0 text-aux text-foreground" role="status">
          {resultMessage(phase.result, t)}
        </p>
      );
    case "writeFailed":
      return (
        <p className="m-0 text-aux text-danger" role="alert">
          {resultMessage(phase.result, t)}
        </p>
      );
    case "failed":
      return <ErrorLine error={phase.error} onCancel={onCancel} />;
    default:
      return null;
  }
}

function PreviewBlock({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly preview: ClaudeEditPreview;
  readonly busy: boolean;
  readonly onConfirm: (operationId: string) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  return (
    <div aria-label={t("aiConfig.edit.previewLabel")} className="grid min-w-0 gap-ui-4">
      <p className="m-0 text-aux text-foreground">{preview.summary}</p>
      {preview.effects.map((effect) => (
        <p key={effect} className="m-0 text-aux text-muted-foreground">
          {effect}
        </p>
      ))}
      <p className="m-0 text-aux text-muted-foreground">
        {recoveryNote(preview, t)}
      </p>
      {preview.diff.redacted ? (
        <p className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.edit.previewRedacted")}
        </p>
      ) : null}
      {preview.diff.truncated ? (
        <p className="m-0 text-aux text-muted-foreground">{t("aiConfig.edit.previewTruncated")}</p>
      ) : null}
      <pre className="m-0 max-h-48 overflow-auto rounded-control bg-surface-muted px-ui-8 py-ui-8 font-mono text-aux">
        {preview.diff.lines.map((line, index) => (
          <span key={index} className="block">
            {diffSymbol(line)} {line.text}
          </span>
        ))}
      </pre>
      <p className="m-0 text-aux text-muted-foreground">{preview.reloadNote}</p>
      <div className="flex flex-wrap items-center gap-ui-8">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => onConfirm(preview.operationId)}
        >
          {t("aiConfig.edit.confirmWrite")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {busy ? (
          <span className="text-aux text-muted-foreground" role="status">
            {t("aiConfig.edit.writing")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ErrorLine({
  error,
  onCancel,
}: {
  readonly error: AppError;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="grid justify-items-start gap-ui-4">
      <p className="m-0 text-aux text-danger" role="alert">
        {localizeError(error, locale)}
      </p>
      <Button variant="secondary" onClick={onCancel}>
        {t("common.close")}
      </Button>
    </div>
  );
}

export interface EditPanelProps {
  readonly catalog: ClaudeEditCatalog | null;
  readonly settingsFile: SettingsFileSelection | null;
  readonly choosing: boolean;
  readonly chooseError: AppError | null;
  readonly view?: ClaudeReadView | null;
  readonly query?: string;
  readonly onChooseSettingsFile: () => void;
  readonly onSaved: () => void;
}

function settingRowId(keyPath: string): string {
  return `setting-${keyPath}`;
}

export function EditPanel({
  catalog,
  settingsFile,
  choosing,
  chooseError,
  view = null,
  query: searchQuery = "",
  onChooseSettingsFile,
  onSaved,
}: EditPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [jumpKey, setJumpKey] = useState("");
  const [query, setQuery] = useState("");
  const [editableOnly, setEditableOnly] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const terms = searchTerms(searchQuery);
  const scopedItems = catalog?.items.filter((item) =>
    matchesSearch(configSearchItem(item), terms),
  ) ?? [];
  const groups = catalog
    ? groupSettings(scopedItems, { query, editableOnly })
    : null;

  const jumpTo = (keyPath: string) => {
    setJumpKey(keyPath);
    const target = catalog?.items.find((candidate) => candidate.keyPath === keyPath);
    if (!target) return;
    setQuery("");
    setEditableOnly(false);
    if (!target.editable) setDisplayOpen(true);
    window.setTimeout(() => {
      const row = document.getElementById(settingRowId(keyPath));
      row?.scrollIntoView({ block: "center" });
      row?.focus({ preventScroll: true });
    }, 0);
  };

  return (
    <section
      aria-label={t("aiConfig.edit.sectionLabel")}
      className="grid min-w-0 gap-ui-8 border-t border-border pt-ui-8"
    >
      <h3 className="m-0 text-aux font-semibold">{t("aiConfig.edit.heading")}</h3>
      <p className="m-0 text-aux text-muted-foreground">
        {t("aiConfig.edit.intro")}
        {versionNoteText(catalog?.detectedVersion ?? null, catalog?.items ?? [], t)}
      </p>
      <div className="flex flex-wrap items-center gap-ui-8">
        <span className="text-aux text-muted-foreground">
          {t("aiConfig.edit.file", {
            path: settingsFile ? settingsFile.displayPath : t("aiConfig.edit.noFile"),
          })}
        </span>
        <Button
          variant="secondary"
          disabled={choosing}
          onClick={onChooseSettingsFile}
        >
          {settingsFile ? t("aiConfig.edit.changeFile") : t("aiConfig.edit.chooseFile")}
        </Button>
      </div>
      {chooseError ? (
        <p role="alert" className="m-0 text-aux text-danger">
          {localizeError(chooseError, locale)}
        </p>
      ) : null}
      {catalog === null || groups === null ? (
        <p className="m-0 text-aux text-muted-foreground">{t("aiConfig.edit.unavailable")}</p>
      ) : (
        <>
          <SelectField<string>
            label={t("aiConfig.edit.jumpLabel")}
            description={t("aiConfig.edit.jumpDescription")}
            value={jumpKey}
            options={[
              { value: "", label: t("aiConfig.edit.choose") },
              ...scopedItems.map((candidate) => ({
                value: candidate.keyPath,
                label: candidate.editable
                  ? candidate.keyPath
                  : t("aiConfig.edit.displayOnlyOption", { key: candidate.keyPath }),
              })),
            ]}
            onValueChange={jumpTo}
          />
          <TextField
            label={t("aiConfig.edit.searchLabel")}
            value={query}
            onValueChange={setQuery}
          />
          <CheckboxField
            label={t("aiConfig.edit.editableOnly")}
            checked={editableOnly}
            onCheckedChange={setEditableOnly}
          />
          <div className="grid min-w-0 gap-ui-8">
            {groups.editable.length === 0 ? (
              <p className="m-0 text-aux text-muted-foreground">
                {t("aiConfig.edit.noEditable")}
              </p>
            ) : (
              <ul
                aria-label={t("aiConfig.edit.editableList")}
                className="m-0 grid list-none gap-ui-8 p-0"
              >
                {groups.editable.map((candidate) => (
                  <SettingRow
                    key={candidate.keyPath}
                    item={candidate}
                    terms={terms}
                    view={view}
                    detectedVersion={catalog.detectedVersion}
                    settingsGrantId={settingsFile?.id ?? null}
                    onSaved={onSaved}
                  />
                ))}
              </ul>
            )}
            {editableOnly ? null : (
              <details
                open={displayOpen}
                onToggle={(event) => setDisplayOpen(event.currentTarget.open)}
                className="grid min-w-0 gap-ui-8"
              >
                <summary className="text-aux font-semibold">
                  {t("aiConfig.edit.displayOnlyGroup", { count: groups.displayOnly.length })}
                </summary>
                <ul
                  aria-label={t("aiConfig.edit.displayOnlyList")}
                  className="m-0 mt-ui-8 grid list-none gap-ui-8 p-0"
                >
                  {groups.displayOnly.map((candidate) => (
                    <SettingRow
                      key={candidate.keyPath}
                      item={candidate}
                      terms={terms}
                      view={view}
                      detectedVersion={catalog.detectedVersion}
                      settingsGrantId={settingsFile?.id ?? null}
                      onSaved={onSaved}
                    />
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SettingRow({
  item,
  terms,
  view,
  detectedVersion,
  settingsGrantId,
  onSaved,
}: {
  readonly item: ClaudeEditItem;
  readonly terms: readonly string[];
  readonly view: ClaudeReadView | null;
  readonly detectedVersion: string | null;
  readonly settingsGrantId: string | null;
  readonly onSaved: () => void;
}) {
  const t = useT();
  const descriptionVisible = !item.editable || editControl(item) === "none";
  return (
    <li
      id={settingRowId(item.keyPath)}
      tabIndex={-1}
      className="grid min-w-0 gap-ui-8 border-t border-border pt-ui-8"
    >
      <div className="flex flex-wrap items-center gap-ui-8">
        <code className="min-w-0 break-all font-mono text-aux font-semibold">
          <HighlightText text={item.keyPath} terms={terms} />
        </code>
        {settingBadges(item, detectedVersion, t).map((badge) => (
          <StatusBadge key={badge.label} tone={badge.tone}>
            {badge.label}
          </StatusBadge>
        ))}
      </div>
      {descriptionVisible ? (
        <p className="m-0 break-words text-aux text-foreground">
          <HighlightText text={item.description} terms={terms} />
        </p>
      ) : null}
      {item.descriptionTruncated ? (
        <p className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.edit.descriptionTruncated")}
        </p>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        {t("aiConfig.edit.rowDefault", { value: item.defaultNote })}
      </p>
      <p className="m-0 text-aux text-muted-foreground">
        {t("aiConfig.edit.rowCurrentUser", { value: userLevelText(item.keyPath, view, t) })}
      </p>
      <p className="m-0 break-all text-aux text-muted-foreground">
        {t("aiConfig.edit.rowSource", { url: item.sourceUrl, date: item.sourceRetrievedOn })}
      </p>
      {item.editable ? (
        <SettingEditor
          item={item}
          settingsGrantId={settingsGrantId}
          onSaved={onSaved}
        />
      ) : (
        <p className="m-0 text-aux text-danger" role="status">
          {item.reason}
        </p>
      )}
    </li>
  );
}
