import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionRow, Button, Modal, TextAreaField, TextField } from "../../components/ui";
import type { TranslateFunction } from "../../i18n";
import { useT } from "../../i18n/useLocale";
import { decodeAppError } from "../../ipc/core";
import type {
  LaunchctlChange,
  LaunchctlEntry,
  LaunchctlSetPreview,
} from "../../ipc/environment";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_VALUE_BYTES = 4096;

export interface LaunchctlSetInput {
  key: string;
  value: string;
  expectedCurrent: string | null;
}

function nameProblem(name: string, t: TranslateFunction): string | null {
  if (name.length === 0) return t("env.editor.launchctl.name.empty");
  if (!NAME_PATTERN.test(name)) return t("env.editor.launchctl.name.pattern");
  return null;
}

function valueProblem(value: string, t: TranslateFunction): string | null {
  if (value.length === 0) return t("env.editor.launchctl.value.empty");
  if (value.includes("\0")) return t("env.editor.launchctl.value.nul");
  if (value.startsWith("-")) return t("env.editor.launchctl.value.dash");
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
    return t("env.editor.launchctl.value.tooLong", { max: MAX_VALUE_BYTES });
  }
  return null;
}

interface PreviewedChange {
  readonly key: string;
  readonly value: string;
  readonly preview: LaunchctlSetPreview;
}

function currentStateText(preview: LaunchctlSetPreview, t: TranslateFunction): string {
  if (!preview.currentExists) return t("env.editor.launchctl.current.unset");
  return preview.currentSecret
    ? t("env.editor.launchctl.current.setMasked")
    : t("env.editor.launchctl.current.set");
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
  const t = useT();
  const formId = useId();
  const editing = entry !== undefined;
  const [name, setName] = useState(entry?.key ?? "");
  const [value, setValue] = useState(entry && !entry.secret ? (entry.value ?? "") : "");
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  // The name and value that were previewed; the confirmation uses only this copy.
  const [previewed, setPreviewed] = useState<PreviewedChange | null>(null);
  const [busy, setBusy] = useState(false);

  async function previewChange(event: FormEvent) {
    event.preventDefault();
    const nameIssue = editing ? null : nameProblem(name, t);
    const valueIssue = valueProblem(value, t);
    setErrors({ name: nameIssue ?? undefined, value: valueIssue ?? undefined });
    if (nameIssue !== null || valueIssue !== null) return;
    setFormError(null);
    setBusy(true);
    try {
      const preview = await onPreview(name, value);
      setPreviewed({ key: name, value, preview });
    } catch (error) {
      setFormError(decodeAppError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (previewed === null) return;
    setFormError(null);
    setBusy(true);
    try {
      const change = await onSet({
        key: previewed.key,
        value: previewed.value,
        expectedCurrent: previewed.preview.expectedCurrent,
      });
      onDone(change, previewed.key);
    } catch (error) {
      const failure = decodeAppError(error);
      // A value changed since the preview: go back to the form so it is previewed again.
      if (failure.code === "CONFLICT") setPreviewed(null);
      setFormError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? t("env.editor.launchctl.titleEdit") : t("env.editor.launchctl.titleSet");
  const scopeNote = t("env.editor.launchctl.scopeNote");

  if (previewed !== null) {
    return (
      <Modal
        busy={busy}
        footer={
          <>
            <Button disabled={busy} onClick={() => setPreviewed(null)} variant="default">
              {t("env.editor.launchctl.preview.back")}
            </Button>
            <Button disabled={busy} onClick={confirm} variant="primary">
              {t("env.editor.launchctl.preview.confirm")}
            </Button>
          </>
        }
        onClose={onClose}
        open
        title={title}
      >
        <div className="grid min-w-0 gap-ui-8">
          <p className="font-semibold text-foreground">
            {t("env.editor.launchctl.preview.willSet", { key: previewed.key })}
          </p>
          <p className="text-aux text-foreground">
            {t("env.editor.launchctl.preview.current", {
              state: currentStateText(previewed.preview, t),
            })}
          </p>
          <p className="text-aux text-muted-foreground">{scopeNote}</p>
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
          <Button data-modal-cancel="" disabled={busy} onClick={onClose} variant="default">
            {t("env.editor.launchctl.cancel")}
          </Button>
          <Button disabled={busy} form={formId} type="submit" variant="primary">
            {t("env.editor.launchctl.form.preview")}
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
          label={t("env.editor.launchctl.form.name")}
          onValueChange={setName}
          readOnly={editing || busy}
          spellCheck={false}
          value={name}
        />
        <TextAreaField
          data-modal-initial-focus={editing ? "" : undefined}
          description={
            editing && entry?.secret ? t("env.editor.launchctl.form.secretHidden") : undefined
          }
          error={errors.value}
          label={t("env.editor.launchctl.form.value")}
          onValueChange={setValue}
          readOnly={busy}
          rows={4}
          spellCheck={false}
          value={value}
        />
        <p className="text-aux text-muted-foreground">{scopeNote}</p>
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
  const t = useT();
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
      bodyClassName="space-y-ui-16"
      onCancel={onCancel}
      titleId={titleId}
    >
      <h3 className="text-group font-semibold text-foreground" id={titleId}>
        {t("env.editor.launchctl.remove.title", { key: entryKey })}
      </h3>
      <p className="text-body text-foreground">
        {t("env.editor.launchctl.remove.body", { key: entryKey })}
      </p>
      {error !== null ? (
        <p className="text-aux text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <ActionRow align="end">
        <Button data-dialog-cancel="" disabled={busy} onClick={onCancel} variant="default">
          {t("env.editor.launchctl.cancel")}
        </Button>
        <Button disabled={busy} onClick={remove} variant="danger">
          {t("env.editor.launchctl.remove.confirm")}
        </Button>
      </ActionRow>
    </ConfirmDialog>
  );
}
