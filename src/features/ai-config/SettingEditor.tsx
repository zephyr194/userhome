import { useReducer, useState } from "react";
import { Button } from "../../components/ui";
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
} from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  buildEditRequest,
  diffSymbol,
  editBlockedReason,
  editControl,
  editReducer,
  initialDraft,
  recoveryNote,
  resultMessage,
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
      className="grid min-w-0 gap-ui-sm"
    >
      <p className="m-0 text-aux text-muted-foreground">
        保存只修改该键，其余内容（包括未知键与键序）原样保留。
      </p>
      {blocked ? (
        <p className="m-0 text-aux text-destructive" role="status">
          {blocked}
        </p>
      ) : null}

      {control === "boolean" ? (
        <CheckboxField
          label="开启"
          checked={draft === true}
          disabled={blocked !== null || busy}
          onCheckedChange={(checked) => setDraft(checked)}
        />
      ) : null}
      {control === "enum" ? (
        <SelectField<string>
          label="取值"
          value={typeof draft === "string" ? draft : ""}
          disabled={blocked !== null || busy}
          options={item.allowedValues.map((value) => ({ value, label: value }))}
          onValueChange={(value) => setDraft(value)}
        />
      ) : null}
      {control === "string" ? (
        <TextField
          label="文本值"
          value={typeof draft === "string" ? draft : ""}
          maxLength={256}
          disabled={blocked !== null || busy}
          onValueChange={(value) => setDraft(value)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-ui-sm">
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
        <p className="m-0 text-aux text-destructive" role="alert">
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
    <div aria-label="修改预览" className="grid min-w-0 gap-ui-xs">
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
      <pre className="m-0 max-h-48 overflow-auto rounded-control bg-surface-muted px-ui-lg py-ui-md font-mono text-aux">
        {preview.diff.lines.map((line, index) => (
          <span key={index} className="block">
            {diffSymbol(line)} {line.text}
          </span>
        ))}
      </pre>
      <p className="m-0 text-aux text-muted-foreground">{preview.reloadNote}</p>
      <div className="flex flex-wrap items-center gap-ui-sm">
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
    <div className="grid justify-items-start gap-ui-xs">
      <p className="m-0 text-aux text-destructive" role="alert">
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
  readonly onChooseSettingsFile: () => void;
  readonly onSaved: () => void;
}

export function EditPanel({
  catalog,
  settingsFile,
  choosing,
  chooseError,
  onChooseSettingsFile,
  onSaved,
}: EditPanelProps) {
  const [selectedKey, setSelectedKey] = useState("");
  const item =
    catalog?.items.find((candidate) => candidate.keyPath === selectedKey) ??
    null;

  return (
    <section
      aria-label="编辑设置"
      className="grid min-w-0 gap-ui-sm border-t border-border pt-ui-md"
    >
      <h3 className="m-0 text-aux font-semibold">编辑（用户设置文件）</h3>
      <p className="m-0 text-aux text-muted-foreground">
        编辑入口存在，但在版本区间核实前整体禁用；保存前会显示预览，需你确认后才写入。
        {catalog?.detectedVersion
          ? `本机版本：${catalog.detectedVersion}。`
          : "未检测到本机版本。"}
      </p>
      <div className="flex flex-wrap items-center gap-ui-sm">
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
        <p role="alert" className="m-0 text-aux text-destructive">
          {chooseError.message}
        </p>
      ) : null}
      {catalog === null ? (
        <p className="m-0 text-aux text-muted-foreground">编辑定义不可用。</p>
      ) : (
        <SelectField<string>
          label="选择要编辑的键"
          value={selectedKey}
          options={[
            { value: "", label: "请选择" },
            ...catalog.items.map((candidate) => ({
              value: candidate.keyPath,
              label: candidate.editable
                ? candidate.keyPath
                : `${candidate.keyPath}（仅展示）`,
            })),
          ]}
          onValueChange={setSelectedKey}
        />
      )}
      {item ? (
        <SettingEditor
          key={item.keyPath}
          item={item}
          settingsGrantId={settingsFile?.id ?? null}
          onSaved={onSaved}
        />
      ) : null}
    </section>
  );
}
