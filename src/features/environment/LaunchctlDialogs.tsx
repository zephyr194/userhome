import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionRow, Button, Modal, TextAreaField, TextField } from "../../components/ui";
import { decodeAppError } from "../../ipc/core";
import type {
  LaunchctlChange,
  LaunchctlEntry,
  LaunchctlSetPreview,
} from "../../ipc/environment";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VALUE_BYTES = 4096;
const LAUNCHCTL_SCOPE_NOTE = "只影响之后启动的应用，注销或重启后失效。";

export interface LaunchctlSetInput {
  key: string;
  value: string;
  expectedCurrent: string | null;
}

function nameProblem(name: string): string | null {
  if (name.length === 0) return "请输入变量名。";
  if (!NAME_PATTERN.test(name)) {
    return "变量名只能由字母、数字和下划线组成，不能以数字开头，最长 128 个字符。";
  }
  return null;
}

function valueProblem(value: string): string | null {
  if (value.length === 0) return "请输入值。要删除这个变量，请使用“移除”。";
  if (value.includes("\0")) return "值不能包含空字符。";
  if (value.startsWith("-")) return "值不能以 - 开头。请换一个值。";
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
    return "值不能超过 4096 字节。";
  }
  return null;
}

function currentStateText(preview: LaunchctlSetPreview): string {
  if (!preview.currentExists) return "未设置";
  return preview.currentSecret ? "已设置（已遮盖）" : "已设置";
}

/**
 * Sets a variable in two steps: the form, then a preview that states what will
 * change. The value is never shown in the preview. `entry` opens the modify
 * form: the name is fixed, and a secret value is not filled in.
 */
export function LaunchctlSetDialog({
  entry,
  onClose,
  onDone,
  onPreview,
  onSet,
}: {
  entry?: LaunchctlEntry;
  onClose: () => void;
  onDone: (change: LaunchctlChange, key: string) => void;
  onPreview: (key: string, value: string) => Promise<LaunchctlSetPreview>;
  onSet: (input: LaunchctlSetInput) => Promise<LaunchctlChange>;
}) {
  const formId = useId();
  const editing = entry !== undefined;
  const [name, setName] = useState(entry?.key ?? "");
  const [value, setValue] = useState(entry && !entry.secret ? (entry.value ?? "") : "");
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LaunchctlSetPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function previewChange(event: FormEvent) {
    event.preventDefault();
    const nameIssue = editing ? null : nameProblem(name);
    const valueIssue = valueProblem(value);
    setErrors({ name: nameIssue ?? undefined, value: valueIssue ?? undefined });
    if (nameIssue !== null || valueIssue !== null) return;
    setFormError(null);
    setBusy(true);
    try {
      setPreview(await onPreview(name, value));
    } catch (error) {
      setFormError(decodeAppError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (preview === null) return;
    setFormError(null);
    setBusy(true);
    try {
      const change = await onSet({ key: name, value, expectedCurrent: preview.expectedCurrent });
      onDone(change, name);
    } catch (error) {
      const failure = decodeAppError(error);
      // A value changed since the preview: go back to the form so it is previewed again.
      if (failure.code === "CONFLICT") setPreview(null);
      setFormError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? "修改变量" : "设置变量";

  if (preview !== null) {
    return (
      <Modal
        busy={busy}
        footer={
          <>
            <Button disabled={busy} onClick={() => setPreview(null)} variant="secondary">
              返回修改
            </Button>
            <Button disabled={busy} onClick={confirm} variant="primary">
              确认设置
            </Button>
          </>
        }
        onClose={onClose}
        open
        title={title}
      >
        <div className="grid min-w-0 gap-ui-8">
          <p className="font-semibold text-foreground">将设置 {name}</p>
          <p className="text-aux text-foreground">当前：{currentStateText(preview)}</p>
          <p className="text-aux text-muted-foreground">{LAUNCHCTL_SCOPE_NOTE}</p>
          {formError !== null ? (
            <p className="text-aux text-danger" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      busy={busy}
      footer={
        <>
          <Button data-modal-cancel="" disabled={busy} onClick={onClose} variant="secondary">
            取消
          </Button>
          <Button disabled={busy} form={formId} type="submit" variant="primary">
            预览设置
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={title}
    >
      <form className="grid min-w-0 gap-ui-16" id={formId} noValidate onSubmit={previewChange}>
        <TextField
          autoComplete="off"
          data-modal-initial-focus={editing ? undefined : ""}
          error={errors.name}
          label="变量名"
          onValueChange={setName}
          readOnly={editing}
          spellCheck={false}
          value={name}
        />
        <TextAreaField
          data-modal-initial-focus={editing ? "" : undefined}
          description={editing && entry?.secret ? "原值已隐藏，输入新值后才会替换。" : undefined}
          error={errors.value}
          label="值"
          onValueChange={setValue}
          rows={4}
          spellCheck={false}
          value={value}
        />
        <p className="text-aux text-muted-foreground">{LAUNCHCTL_SCOPE_NOTE}</p>
        {formError !== null ? (
          <p className="text-aux text-danger" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export function LaunchctlRemoveDialog({
  entryKey,
  onCancel,
  onDone,
  onPreview,
  onRemove,
}: {
  entryKey: string;
  onCancel: () => void;
  onDone: (change: LaunchctlChange, key: string) => void;
  onPreview: (key: string) => Promise<LaunchctlSetPreview>;
  onRemove: (key: string, expectedCurrent: string | null) => Promise<LaunchctlChange>;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const preview = await onPreview(entryKey);
      onDone(await onRemove(entryKey, preview.expectedCurrent), entryKey);
    } catch (failure) {
      setError(decodeAppError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-ui-16"
      onCancel={onCancel}
      titleId={titleId}
    >
      <h3 className="text-group font-semibold text-foreground" id={titleId}>
        移除 {entryKey}？
      </h3>
      <p className="text-body text-foreground">
        将从登录会话中移除 {entryKey}。已经运行的应用不受影响，之后启动的应用将不再收到这个变量。
      </p>
      {error !== null ? (
        <p className="text-aux text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <ActionRow align="end">
        <Button data-dialog-cancel="" disabled={busy} onClick={onCancel} variant="secondary">
          取消
        </Button>
        <Button disabled={busy} onClick={remove} variant="danger">
          移除变量
        </Button>
      </ActionRow>
    </ConfirmDialog>
  );
}
