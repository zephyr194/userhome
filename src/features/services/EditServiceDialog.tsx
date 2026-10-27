import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActionRow, Button, Modal, SwitchField, TextField } from "../../components/ui";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import { decodeAppError } from "../../ipc/core";
import {
  discardEditLaunchdService,
  executeEditLaunchdService,
  previewEditLaunchdService,
  type EditExecution,
  type EditPreview,
} from "../../ipc/servicesAdopt";
import type { LaunchdService } from "../../ipc/services";
import {
  ENVIRONMENT_NOTE,
  KEEP_ALIVE_IMPACT,
  RUN_AT_LOAD_IMPACT,
  addArgument,
  addEnvironment,
  moveArgument,
  removeArgument,
  removeEnvironment,
  updateArgument,
  updateEnvironmentKey,
  updateEnvironmentValue,
  type FormErrors,
  scrubSecrets,
} from "./createServiceModel";
import {
  KEEP_ALIVE_CONDITIONAL_NOTE,
  INITIAL_EDIT_DIALOG,
  buildEditRequest,
  changeLabel,
  describeEditFailure,
  describeEditOutcome,
  discardTarget,
  editDialogReducer,
  editOriginalOf,
  grantNotice,
  initialEditForm,
  toggleEnvironmentRemoval,
  type EditDialogState,
  type EditFormState,
  type EditOriginal,
} from "./editServiceModel";
import { createSequenceGate } from "./sequenceGate";

const TITLE_ID = "edit-service-heading";

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-ui-8 rounded-control bg-surface-muted px-ui-12 py-ui-12">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="break-all font-mono text-xs [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="break-words text-sm text-danger" role="alert">
      {children}
    </p>
  );
}

function FormBody({
  disabled,
  errors,
  form,
  onFormChange,
  original,
}: {
  disabled: boolean;
  errors: FormErrors | undefined;
  form: EditFormState;
  onFormChange: (next: EditFormState) => void;
  original: EditOriginal;
}) {
  const t = useT();
  return (
    <div className="grid gap-ui-16">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("services.dialog.edit.intro")}
      </p>

      <Section title={t("services.dialog.edit.programSection")}>
        <TextField
          autoComplete="off"
          description={t("services.dialog.field.executableHint")}
          disabled={disabled}
          error={errors?.executable}
          label={t("services.dialog.field.executable")}
          onValueChange={(value) => onFormChange({ ...form, executable: value })}
          spellCheck={false}
          value={form.executable}
        />
        {form.arguments.map((row, index) => (
          <div className="grid gap-ui-8" key={row.id}>
            <TextField
              autoComplete="off"
              disabled={disabled}
              error={errors?.arguments[row.id]}
              label={t("services.dialog.create.argumentLabel", { index: index + 1 })}
              onValueChange={(value) => onFormChange(updateArgument(form, row.id, value))}
              spellCheck={false}
              value={row.value}
            />
            <ActionRow>
              <Button
                disabled={disabled || index === 0}
                onClick={() => onFormChange(moveArgument(form, row.id, -1))}
                size="sm"
                variant="ghost"
              >
                {t("services.dialog.common.moveUp")}
              </Button>
              <Button
                disabled={disabled || index === form.arguments.length - 1}
                onClick={() => onFormChange(moveArgument(form, row.id, 1))}
                size="sm"
                variant="ghost"
              >
                {t("services.dialog.common.moveDown")}
              </Button>
              <Button
                disabled={disabled}
                onClick={() => onFormChange(removeArgument(form, row.id))}
                size="sm"
                variant="ghost"
              >
                {t("services.dialog.create.removeArgument")}
              </Button>
            </ActionRow>
          </div>
        ))}
        <div>
          <Button
            disabled={disabled}
            onClick={() => onFormChange(addArgument(form))}
            size="sm"
            variant="secondary"
          >
            {t("services.dialog.create.addArgument")}
          </Button>
        </div>
      </Section>

      <Section title={t("services.dialog.edit.workingDirectorySection")}>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.edit.workingDirectoryNote")}
        </p>
        <TextField
          autoComplete="off"
          description={t("services.dialog.create.workingDirectoryHint")}
          disabled={disabled || form.clearWorkingDirectory}
          error={errors?.workingDirectory}
          label={t("services.dialog.edit.newWorkingDirectory")}
          onValueChange={(value) => onFormChange({ ...form, workingDirectory: value })}
          spellCheck={false}
          value={form.workingDirectory}
        />
        <SwitchField
          checked={form.clearWorkingDirectory}
          description={t("services.dialog.edit.clearWorkingDirectoryHint")}
          disabled={disabled}
          label={t("services.dialog.edit.clearWorkingDirectory")}
          onCheckedChange={(checked) =>
            onFormChange({ ...form, clearWorkingDirectory: checked })
          }
        />
      </Section>

      <Section title={t("services.dialog.common.environment")}>
        <p className="text-xs text-muted-foreground">{t(ENVIRONMENT_NOTE)}</p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.edit.existingNote")}
        </p>
        {original.environmentKeys.length === 0 ? null : (
          <ul className="grid gap-ui-8">
            {original.environmentKeys.map((name) => {
              const removed = form.removedEnvironment.includes(name);
              return (
                <li className="flex flex-wrap items-center gap-ui-8" key={name}>
                  <Mono>{name}</Mono>
                  <Button
                    disabled={disabled}
                    onClick={() => onFormChange(toggleEnvironmentRemoval(form, name))}
                    size="sm"
                    variant="ghost"
                  >
                    {removed
                      ? t("services.dialog.edit.undoRemove")
                      : t("services.dialog.edit.remove")}
                  </Button>
                  {removed ? (
                    <span className="text-xs text-warning">
                      {t("services.dialog.edit.removedOnSave")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {form.environment.map((row, index) => (
          <div className="grid gap-ui-8" key={row.id}>
            <div className="grid gap-ui-8 sm:grid-cols-2">
              <TextField
                autoComplete="off"
                disabled={disabled}
                error={errors?.environment[row.id]?.key}
                label={t("services.dialog.create.envKeyLabel", { index: index + 1 })}
                onValueChange={(value) => onFormChange(updateEnvironmentKey(form, row.id, value))}
                spellCheck={false}
                value={row.key}
              />
              <TextField
                autoComplete="off"
                description={t("services.dialog.field.secretHint")}
                disabled={disabled}
                error={errors?.environment[row.id]?.value}
                label={t("services.dialog.create.envValueLabel", { index: index + 1 })}
                onValueChange={(value) => onFormChange(updateEnvironmentValue(form, row.id, value))}
                spellCheck={false}
                type="password"
                value={row.value}
              />
            </div>
            <div>
              <Button
                disabled={disabled}
                onClick={() => onFormChange(removeEnvironment(form, row.id))}
                size="sm"
                variant="ghost"
              >
                {t("services.dialog.edit.removeRow")}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            disabled={disabled}
            onClick={() => onFormChange(addEnvironment(form))}
            size="sm"
            variant="secondary"
          >
            {t("services.dialog.common.addEnvironment")}
          </Button>
        </div>
      </Section>

      <div className="grid gap-ui-12 sm:grid-cols-2">
        <TextField
          autoComplete="off"
          description={t("services.dialog.edit.pathHint")}
          disabled={disabled}
          error={errors?.stdoutPath}
          label={t("services.dialog.field.stdoutPath")}
          onValueChange={(value) => onFormChange({ ...form, stdoutPath: value })}
          spellCheck={false}
          value={form.stdoutPath}
        />
        <TextField
          autoComplete="off"
          description={t("services.dialog.edit.pathHint")}
          disabled={disabled}
          error={errors?.stderrPath}
          label={t("services.dialog.field.stderrPath")}
          onValueChange={(value) => onFormChange({ ...form, stderrPath: value })}
          spellCheck={false}
          value={form.stderrPath}
        />
      </div>

      <Section title={t("services.dialog.edit.persistenceSection")}>
        <SwitchField
          checked={form.runAtLoad}
          description={t(RUN_AT_LOAD_IMPACT)}
          disabled={disabled}
          label={t("services.dialog.field.runAtLoad")}
          onCheckedChange={(checked) => onFormChange({ ...form, runAtLoad: checked })}
        />
        <SwitchField
          checked={form.keepAlive}
          description={t(
            original.keepAliveLocked ? KEEP_ALIVE_CONDITIONAL_NOTE : KEEP_ALIVE_IMPACT,
          )}
          disabled={disabled || original.keepAliveLocked}
          label={t("services.dialog.field.keepAlive")}
          onCheckedChange={(checked) => onFormChange({ ...form, keepAlive: checked })}
        />
      </Section>

      {errors?.general ? <ErrorText>{errors.general}</ErrorText> : null}
    </div>
  );
}

function PreviewBody({ preview }: { preview: EditPreview }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="grid gap-ui-16">
      <Section title={t("services.dialog.edit.previewFileSection")}>
        <p className="text-sm">
          <Mono>{preview.filePath}</Mono>
        </p>
      </Section>

      <Section title={t("services.dialog.edit.changesSection")}>
        <ul className="flex flex-wrap gap-ui-8 text-sm">
          {preview.changes.map((change) => (
            <li key={change}>{changeLabel(change, t)}</li>
          ))}
        </ul>
      </Section>

      {preview.executable === undefined ? null : (
        <Section title={t("services.dialog.create.targetSection")}>
          <p className="text-xs text-muted-foreground">
            {t("services.dialog.edit.targetNote")}
          </p>
          <ol className="grid gap-ui-4 text-sm">
            <li>
              <Mono>{preview.executable}</Mono>
            </li>
            {(preview.arguments ?? []).map((argument, index) => (
              <li key={index}>
                <Mono>
                  {argument.length === 0 ? t("services.dialog.create.emptyArgument") : argument}
                </Mono>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {preview.environmentSet.length + preview.environmentRemoved.length === 0 ? null : (
        <Section title={t("services.dialog.common.environment")}>
          <p className="text-xs text-muted-foreground">{t("services.dialog.edit.envNamesOnly")}</p>
          {preview.environmentSet.length === 0 ? null : (
            <p className="text-sm">
              {t("services.dialog.edit.setLine")}
              {preview.environmentSet.map((name) => (
                <span className="mr-ui-8" key={name}>
                  <Mono>{name}</Mono>
                </span>
              ))}
            </p>
          )}
          {preview.environmentRemoved.length === 0 ? null : (
            <p className="text-sm">
              {t("services.dialog.edit.removeLine")}
              {preview.environmentRemoved.map((name) => (
                <span className="mr-ui-8" key={name}>
                  <Mono>{name}</Mono>
                </span>
              ))}
            </p>
          )}
        </Section>
      )}

      <Section title={t("services.dialog.common.backup")}>
        <p className="text-sm text-muted-foreground">{preview.backup}</p>
      </Section>

      <p className="rounded-control bg-surface-muted px-ui-12 py-ui-8 text-sm font-medium">
        {preview.reloadNote}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        {t("services.dialog.common.previewExpires")}
        <time dateTime={preview.expiresAt}>
          {formatDateTime(preview.expiresAt, locale)}
        </time>
      </p>
    </div>
  );
}

function ResultBody({
  dialog,
  form,
}: {
  dialog: Extract<EditDialogState, { phase: "done" | "failed" }>;
  form: EditFormState;
}) {
  const t = useT();
  if (dialog.phase === "done") {
    const outcome = describeEditOutcome(dialog.execution, t);
    const grant = grantNotice(dialog.execution, t);
    return (
      <div className="grid gap-ui-8" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-success">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
        {grant ? <p className="text-xs text-warning">{grant}</p> : null}
      </div>
    );
  }
  if (dialog.execution) {
    const outcome = describeEditOutcome(dialog.execution, t);
    return (
      <div className="grid gap-ui-8" role="alert">
        <p className="text-sm font-semibold text-danger">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
      </div>
    );
  }
  const notice = dialog.error
    ? describeEditFailure(dialog.error, t)
    : {
        title: t("services.dialog.edit.incomplete.title"),
        detail: t("services.dialog.edit.conflict.detail"),
      };
  return (
    <div className="grid gap-ui-8" role="alert">
      <p className="text-sm font-semibold text-danger">{notice.title}</p>
      <p className="break-words text-sm text-muted-foreground">
        {scrubSecrets(notice.detail, form, t)}
      </p>
    </div>
  );
}

/**
 * The whole edit dialog as a controlled view: the form, the preview, the busy
 * state and the result are all decided by `form` and `dialog`.
 */
export function EditServiceDialogView({
  dialog,
  errors,
  form,
  onClose,
  onConfirm,
  onEdit,
  onFormChange,
  onPreview,
  original,
}: {
  dialog: EditDialogState;
  errors: FormErrors | undefined;
  form: EditFormState;
  onClose: () => void;
  onConfirm: () => void;
  onEdit: () => void;
  onFormChange: (next: EditFormState) => void;
  onPreview: () => void;
  original: EditOriginal;
}) {
  const t = useT();
  const busy = dialog.phase === "previewing" || dialog.phase === "saving";
  let body: ReactNode;
  let footer: ReactNode;

  switch (dialog.phase) {
    case "editing":
    case "previewing":
      body = (
        <>
          {dialog.phase === "editing" && dialog.error ? (
            <ErrorText>{scrubSecrets(dialog.error.message, form, t)}</ErrorText>
          ) : null}
          {dialog.phase === "previewing" ? (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {t("services.dialog.common.previewing")}
            </p>
          ) : null}
          <FormBody
            disabled={dialog.phase === "previewing"}
            errors={errors}
            form={form}
            onFormChange={onFormChange}
            original={original}
          />
        </>
      );
      footer = (
        <>
          <Button data-modal-cancel disabled={busy} onClick={onClose} variant="secondary">
            {t("services.dialog.common.cancel")}
          </Button>
          <Button disabled={busy} onClick={onPreview} variant="primary">
            {t("services.dialog.common.preview")}
          </Button>
        </>
      );
      break;
    case "preview":
    case "saving":
      body = (
        <>
          <PreviewBody preview={dialog.preview} />
          {dialog.phase === "saving" ? (
            <p className="text-sm text-warning" role="status" aria-live="polite">
              {t("services.dialog.edit.savingNote")}
            </p>
          ) : null}
        </>
      );
      footer = (
        <>
          <Button
            data-modal-cancel
            disabled={dialog.phase === "saving"}
            onClick={onEdit}
            variant="secondary"
          >
            {t("services.dialog.common.backToEdit")}
          </Button>
          <Button disabled={dialog.phase === "saving"} onClick={onConfirm} variant="primary">
            {t("services.dialog.edit.confirm")}
          </Button>
        </>
      );
      break;
    case "done":
      body = <ResultBody dialog={dialog} form={form} />;
      footer = (
        <Button data-modal-cancel onClick={onClose} variant="primary">
          {t("services.dialog.common.done")}
        </Button>
      );
      break;
    case "failed":
      body = <ResultBody dialog={dialog} form={form} />;
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose} variant="secondary">
            {t("services.dialog.common.close")}
          </Button>
          <Button onClick={onEdit} variant="secondary">
            {t("services.dialog.common.backToEdit")}
          </Button>
        </>
      );
      break;
  }

  return (
    <Modal
      bodyClassName="grid gap-ui-16"
      busy={busy}
      className="max-w-[720px]"
      footer={footer}
      onClose={busy ? () => undefined : onClose}
      open
      titleId={TITLE_ID}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-primary">
          {t("services.dialog.edit.eyebrow")}
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          {t("services.dialog.edit.title")}
        </h3>
      </div>
      {body}
    </Modal>
  );
}

/**
 * Edits one adopted job's configuration: fill the changes, look at the
 * preview, save. A preview that is left behind (closed, returned from, or the
 * panel moved to another job) is given up on the backend; a late answer from a
 * preview that is no longer wanted is given up as it arrives.
 */
export function EditServiceDialog({
  onClose,
  onSaved,
  service,
}: {
  onClose: () => void;
  onSaved: (execution: EditExecution) => void;
  service: LaunchdService;
}) {
  const original = useMemo(() => editOriginalOf(service), [service]);
  const t = useT();
  const [form, setForm] = useState<EditFormState>(() => initialEditForm(original));
  const [dialog, dispatch] = useReducer(editDialogReducer, INITIAL_EDIT_DIALOG);
  const [showErrors, setShowErrors] = useState(false);
  const [gate] = useState(createSequenceGate);
  const pendingRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    pendingRef.current = discardTarget(dialog);
  }, [dialog]);

  const discardPending = useCallback(() => {
    const operationId = pendingRef.current;
    pendingRef.current = undefined;
    if (operationId !== undefined) {
      void discardEditLaunchdService(operationId).catch(() => undefined);
    }
  }, []);

  useEffect(() => () => {
    gate.cancel();
    discardPending();
  }, [discardPending, gate]);

  const checked = useMemo(
    () => buildEditRequest(original, form, t),
    [original, form, t],
  );
  const errors = showErrors && !checked.ok ? checked.errors : undefined;

  const preview = () => {
    setShowErrors(true);
    if (!checked.ok) return;
    const request = checked.request;
    const sequence = gate.next();
    dispatch({ type: "previewRequested" });
    void previewEditLaunchdService(request)
      .then((result) => {
        if (!gate.isCurrent(sequence)) {
          void discardEditLaunchdService(result.operationId).catch(() => undefined);
          return;
        }
        dispatch({ type: "previewLoaded", preview: result });
      })
      .catch((error: unknown) => {
        if (gate.isCurrent(sequence)) {
          dispatch({ type: "previewFailed", error: decodeAppError(error) });
        }
      });
  };

  const confirm = () => {
    if (dialog.phase !== "preview") return;
    const operationId = dialog.preview.operationId;
    const sequence = gate.next();
    dispatch({ type: "saveRequested" });
    void executeEditLaunchdService(operationId)
      .then((execution) => {
        onSaved(execution);
        if (gate.isCurrent(sequence)) dispatch({ type: "saveFinished", execution });
      })
      .catch((error: unknown) => {
        if (gate.isCurrent(sequence)) {
          dispatch({ type: "saveFailed", error: decodeAppError(error) });
        }
      });
  };

  const close = () => {
    discardPending();
    onClose();
  };

  const edit = () => {
    discardPending();
    dispatch({ type: "editRequested" });
  };

  return (
    <EditServiceDialogView
      dialog={dialog}
      errors={errors}
      form={form}
      onClose={close}
      onConfirm={confirm}
      onEdit={edit}
      onFormChange={setForm}
      onPreview={preview}
      original={original}
    />
  );
}
