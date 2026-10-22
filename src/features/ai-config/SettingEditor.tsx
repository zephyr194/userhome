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

const ACTION_LABELS: Record<ClaudeEditAction, string> = {
  set: "预览修改",
  restoreDefault: "恢复默认（移除该键）",
  setNull: "设为 null",
};

export function SettingEditor({
  item,
  settingsGrantId,
  onSaved,
}: SettingEditorProps) {
  const [draft, setDraft] = useState<EditDraft>(() => initialDraft(item));
  const [phase, dispatch] = useReducer(editReducer, {
    status: "idle",
  } as EditPhase);
  const blocked = editBlockedReason(item, settingsGrantId);
  const control = editControl(item);
  const busy = phase.status === "previewing" || phase.status === "confirming";

  const runPreview = (action: ClaudeEditAction) => {
    if (settingsGrantId === null) return;
    const built = buildEditRequest(item, settingsGrantId, action, draft);
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
      aria-label={`编辑 ${item.keyPath}`}
      className="grid min-w-0 gap-ui-8"
    >
      {blocked ? (
        <p className="m-0 text-aux text-danger" role="status">
          {blocked}
        </p>
      ) : null}

      {control === "boolean" ? (
        <CheckboxField
          label="开启"
          description={item.description}
          checked={draft === true}
          disabled={blocked !== null || busy}
          onCheckedChange={(checked) => setDraft(checked)}
        />
      ) : null}
      {control === "enum" ? (
        <SelectField<string>
          label="取值"
          description={item.description}
          value={typeof draft === "string" ? draft : ""}
          disabled={blocked !== null || busy}
          options={item.allowedValues.map((value) => ({ value, label: value }))}
          onValueChange={(value) => setDraft(value)}
        />
      ) : null}
      {control === "string" ? (
        <TextField
          label="文本值"
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
            {ACTION_LABELS[action]}
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
  switch (phase.status) {
    case "idle":
      return null;
    case "previewing":
      return (
        <p className="m-0 text-aux text-muted-foreground" role="status">
          正在生成预览…
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
          {resultMessage(phase.result)}
        </p>
      );
    case "writeFailed":
      return (
        <p className="m-0 text-aux text-danger" role="alert">
          {resultMessage(phase.result)}
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
  return (
    <div aria-label="修改预览" className="grid min-w-0 gap-ui-4">
      <p className="m-0 text-aux text-foreground">{preview.summary}</p>
      {preview.effects.map((effect) => (
        <p key={effect} className="m-0 text-aux text-muted-foreground">
          {effect}
        </p>
      ))}
      <p className="m-0 text-aux text-muted-foreground">
        {recoveryNote(preview)}
      </p>
      {preview.diff.redacted ? (
        <p className="m-0 text-aux text-muted-foreground">
          内容已遮盖，不显示差异。
        </p>
      ) : null}
      {preview.diff.truncated ? (
        <p className="m-0 text-aux text-muted-foreground">差异过长，已截断。</p>
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
          确认写入
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        {busy ? (
          <span className="text-aux text-muted-foreground" role="status">
            正在写入…
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
  return (
    <div className="grid justify-items-start gap-ui-4">
      <p className="m-0 text-aux text-danger" role="alert">
        {error.message}
      </p>
      <Button variant="ghost" onClick={onCancel}>
        关闭
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
  onChooseSettingsFile,
  onSaved,
}: EditPanelProps) {
  const [jumpKey, setJumpKey] = useState("");
  const [query, setQuery] = useState("");
  const [editableOnly, setEditableOnly] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const groups = catalog
    ? groupSettings(catalog.items, { query, editableOnly })
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
      aria-label="编辑设置"
      className="grid min-w-0 gap-ui-8 border-t border-border pt-ui-8"
    >
      <h3 className="m-0 text-aux font-semibold">编辑（用户设置文件）</h3>
      <p className="m-0 text-aux text-muted-foreground">
        编辑项由后端逐项决定是否可写。保存只修改该键，其余内容（包括未知键与键序）原样保留；保存前会显示预览，需你确认后才写入。
        {versionNoteText(catalog?.detectedVersion ?? null, catalog?.items ?? [])}
      </p>
      <div className="flex flex-wrap items-center gap-ui-8">
        <span className="text-aux text-muted-foreground">
          文件：{settingsFile ? settingsFile.displayPath : "未选择"}
        </span>
        <Button
          variant="secondary"
          disabled={choosing}
          onClick={onChooseSettingsFile}
        >
          {settingsFile ? "更换文件" : "选择设置文件"}
        </Button>
      </div>
      {chooseError ? (
        <p role="alert" className="m-0 text-aux text-danger">
          {chooseError.message}
        </p>
      ) : null}
      {catalog === null || groups === null ? (
        <p className="m-0 text-aux text-muted-foreground">编辑定义不可用。</p>
      ) : (
        <>
          <SelectField<string>
            label="选择要编辑的键"
            description="选择后定位到该设置；仅展示项会展开下方的分组。"
            value={jumpKey}
            options={[
              { value: "", label: "请选择" },
              ...catalog.items.map((candidate) => ({
                value: candidate.keyPath,
                label: candidate.editable
                  ? candidate.keyPath
                  : `${candidate.keyPath}（仅展示）`,
              })),
            ]}
            onValueChange={jumpTo}
          />
          <TextField
            label="搜索键名或描述"
            value={query}
            onValueChange={setQuery}
          />
          <CheckboxField
            label="仅显示可编辑"
            checked={editableOnly}
            onCheckedChange={setEditableOnly}
          />
          <div className="grid min-w-0 gap-ui-8">
            {groups.editable.length === 0 ? (
              <p className="m-0 text-aux text-muted-foreground">
                没有匹配的可编辑设置。
              </p>
            ) : (
              <ul
                aria-label="可编辑设置"
                className="m-0 grid list-none gap-ui-8 p-0"
              >
                {groups.editable.map((candidate) => (
                  <SettingRow
                    key={candidate.keyPath}
                    item={candidate}
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
                  {`仅展示（${groups.displayOnly.length}）`}
                </summary>
                <ul
                  aria-label="仅展示设置"
                  className="m-0 mt-ui-8 grid list-none gap-ui-8 p-0"
                >
                  {groups.displayOnly.map((candidate) => (
                    <SettingRow
                      key={candidate.keyPath}
                      item={candidate}
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
  view,
  detectedVersion,
  settingsGrantId,
  onSaved,
}: {
  readonly item: ClaudeEditItem;
  readonly view: ClaudeReadView | null;
  readonly detectedVersion: string | null;
  readonly settingsGrantId: string | null;
  readonly onSaved: () => void;
}) {
  const descriptionVisible = !item.editable || editControl(item) === "none";
  return (
    <li
      id={settingRowId(item.keyPath)}
      tabIndex={-1}
      className="grid min-w-0 gap-ui-8 border-t border-border pt-ui-8"
    >
      <div className="flex flex-wrap items-center gap-ui-8">
        <code className="min-w-0 break-all font-mono text-aux font-semibold">
          {item.keyPath}
        </code>
        {settingBadges(item, detectedVersion).map((badge) => (
          <StatusBadge key={badge.label} tone={badge.tone}>
            {badge.label}
          </StatusBadge>
        ))}
      </div>
      {descriptionVisible ? (
        <p className="m-0 break-words text-aux text-foreground">
          {item.description}
        </p>
      ) : null}
      {item.descriptionTruncated ? (
        <p className="m-0 text-aux text-muted-foreground">
          官方描述超过长度上限已截断，完整说明见官方文档。
        </p>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        {`默认值：${item.defaultNote}`}
      </p>
      <p className="m-0 text-aux text-muted-foreground">
        {`当前用户值：${userLevelText(item.keyPath, view)}`}
      </p>
      <p className="m-0 break-all text-aux text-muted-foreground">
        {`来源：${item.sourceUrl}（抓取日期 ${item.sourceRetrievedOn}）`}
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
