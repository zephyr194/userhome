import { useCallback, useMemo, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  CREATE_SERVICE_LIMITS,
  CREATE_SERVICE_NAMESPACE,
  executeCreateLaunchdService,
  previewCreateLaunchdService,
  type CreateServiceExecution,
  type CreateServicePreview,
} from "../../ipc/services";
import { ActionRow, Button, Modal, SwitchField, TextField } from "../../components/ui";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  ENVIRONMENT_NOTE,
  INITIAL_CREATE_DIALOG,
  INITIAL_CREATE_FORM,
  KEEP_ALIVE_IMPACT,
  RUN_AT_LOAD_IMPACT,
  addArgument,
  addEnvironment,
  buildCreateRequest,
  createDialogReducer,
  describeCreateOutcome,
  fullLabel,
  moveArgument,
  removeArgument,
  removeEnvironment,
  scrubSecrets,
  setFormField,
  updateArgument,
  updateEnvironmentKey,
  updateEnvironmentValue,
  validateCreateForm,
  type CreateDialogState,
  type CreateFormState,
} from "./createServiceModel";

const TITLE_ID = "create-service-heading";

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
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
  form,
  onFormChange,
  showErrors,
  disabled,
}: {
  form: CreateFormState;
  onFormChange: (next: CreateFormState) => void;
  showErrors: boolean;
  disabled: boolean;
}) {
  const t = useT();
  const errors = useMemo(() => validateCreateForm(form, t), [form, t]);
  const shown = showErrors ? errors : undefined;
  const label = fullLabel(form.labelSuffix);

  return (
    <div className="grid gap-ui-16">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("services.dialog.create.intro", { namespace: CREATE_SERVICE_NAMESPACE })}
      </p>

      <TextField
        autoComplete="off"
        description={
          label === undefined ? (
            t("services.dialog.create.labelHint")
          ) : (
            <>
              {t("services.dialog.create.actualLabel")}
              <Mono>{label}</Mono>
            </>
          )
        }
        disabled={disabled}
        error={shown?.label}
        label={t("services.dialog.create.taskName")}
        onValueChange={(value) => onFormChange(setFormField(form, "labelSuffix", value))}
        required
        spellCheck={false}
        value={form.labelSuffix}
      />
      <TextField
        autoComplete="off"
        description={t("services.dialog.field.executableHint")}
        disabled={disabled}
        error={shown?.executable}
        label={t("services.dialog.field.executable")}
        onValueChange={(value) => onFormChange(setFormField(form, "executable", value))}
        required
        spellCheck={false}
        value={form.executable}
      />

      <Section title={t("services.dialog.create.argumentsSection")}>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.argumentsNote", { limit: CREATE_SERVICE_LIMITS.arguments })}
        </p>
        {form.arguments.map((row, index) => (
          <div className="grid gap-ui-8" key={row.id}>
            <TextField
              autoComplete="off"
              disabled={disabled}
              error={shown?.arguments[row.id]}
              label={t("services.dialog.create.argumentLabel", { index: index + 1 })}
              onValueChange={(value) =>
                onFormChange(updateArgument(form, row.id, value))
              }
              spellCheck={false}
              value={row.value}
            />
            <ActionRow>
              <Button
                disabled={disabled || index === 0}
                onClick={() => onFormChange(moveArgument(form, row.id, -1))}
                size="sm"
              >
                {t("services.dialog.common.moveUp")}
              </Button>
              <Button
                disabled={disabled || index === form.arguments.length - 1}
                onClick={() => onFormChange(moveArgument(form, row.id, 1))}
                size="sm"
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
            disabled={disabled || form.arguments.length >= CREATE_SERVICE_LIMITS.arguments}
            onClick={() => onFormChange(addArgument(form))}
            size="sm"
          >
            {t("services.dialog.create.addArgument")}
          </Button>
        </div>
      </Section>

      <TextField
        autoComplete="off"
        description={t("services.dialog.create.workingDirectoryHint")}
        disabled={disabled}
        error={shown?.workingDirectory}
        label={t("services.dialog.field.workingDirectory")}
        onValueChange={(value) =>
          onFormChange(setFormField(form, "workingDirectory", value))
        }
        spellCheck={false}
        value={form.workingDirectory}
      />

      <Section title={t("services.dialog.common.environment")}>
        <p className="text-xs text-muted-foreground">{t(ENVIRONMENT_NOTE)}</p>
        {form.environment.map((row, index) => (
          <div className="grid gap-ui-8" key={row.id}>
            <div className="grid gap-ui-8 sm:grid-cols-2">
              <TextField
                autoComplete="off"
                disabled={disabled}
                error={shown?.environment[row.id]?.key}
                label={t("services.dialog.create.envKeyLabel", { index: index + 1 })}
                onValueChange={(value) =>
                  onFormChange(updateEnvironmentKey(form, row.id, value))
                }
                spellCheck={false}
                value={row.key}
              />
              <TextField
                autoComplete="off"
                description={t("services.dialog.field.secretHint")}
                disabled={disabled}
                error={shown?.environment[row.id]?.value}
                label={t("services.dialog.create.envValueLabel", { index: index + 1 })}
                onValueChange={(value) =>
                  onFormChange(updateEnvironmentValue(form, row.id, value))
                }
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
                {t("services.dialog.create.removeEnvironment")}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            disabled={
              disabled || form.environment.length >= CREATE_SERVICE_LIMITS.environmentEntries
            }
            onClick={() => onFormChange(addEnvironment(form))}
            size="sm"
          >
            {t("services.dialog.common.addEnvironment")}
          </Button>
        </div>
      </Section>

      <div className="grid gap-ui-12 sm:grid-cols-2">
        <TextField
          autoComplete="off"
          description={t("services.dialog.create.stdoutHint")}
          disabled={disabled}
          error={shown?.stdoutPath}
          label={t("services.dialog.field.stdoutPath")}
          onValueChange={(value) => onFormChange(setFormField(form, "stdoutPath", value))}
          spellCheck={false}
          value={form.stdoutPath}
        />
        <TextField
          autoComplete="off"
          description={t("services.dialog.create.stderrHint")}
          disabled={disabled}
          error={shown?.stderrPath}
          label={t("services.dialog.field.stderrPath")}
          onValueChange={(value) => onFormChange(setFormField(form, "stderrPath", value))}
          spellCheck={false}
          value={form.stderrPath}
        />
      </div>

      <Section title={t("services.dialog.create.persistenceSection")}>
        <SwitchField
          checked={form.runAtLoad}
          description={t(RUN_AT_LOAD_IMPACT)}
          disabled={disabled}
          label={t("services.dialog.field.runAtLoad")}
          onCheckedChange={(checked) =>
            onFormChange(setFormField(form, "runAtLoad", checked))
          }
        />
        <SwitchField
          checked={form.keepAlive}
          description={t(KEEP_ALIVE_IMPACT)}
          disabled={disabled}
          label={t("services.dialog.field.keepAlive")}
          onCheckedChange={(checked) =>
            onFormChange(setFormField(form, "keepAlive", checked))
          }
        />
      </Section>

      {shown?.general ? <ErrorText>{shown.general}</ErrorText> : null}
    </div>
  );
}

function PreviewBody({ preview }: { preview: CreateServicePreview }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="grid gap-ui-16">
      <Section title={t("services.dialog.create.previewFileSection")}>
        <p className="text-sm">
          <Mono>{preview.filePath}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.labelLine")}
          <Mono>{preview.label}</Mono>
        </p>
      </Section>

      <Section title={t("services.dialog.create.targetSection")}>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.targetNote")}
          {preview.argumentsRedacted
            ? t("services.dialog.create.argumentsRedacted")
            : t("services.dialog.create.argumentsClear")}
        </p>
        <ol className="grid gap-ui-4 text-sm">
          <li>
            <Mono>{preview.executable}</Mono>
          </li>
          {preview.arguments.map((argument, index) => (
            // The list is a fixed snapshot, so position is a stable key.
            <li key={index}>
              <Mono>
                {argument.length === 0 ? t("services.dialog.create.emptyArgument") : argument}
              </Mono>
            </li>
          ))}
        </ol>
        {preview.workingDirectory ? (
          <p className="text-xs text-muted-foreground">
            {t("services.dialog.create.workingDirectoryLine")}
            <Mono>{preview.workingDirectory}</Mono>
          </p>
        ) : null}
      </Section>

      <Section title={t("services.dialog.common.environment")}>
        {preview.environmentKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("services.dialog.create.noEnvironment")}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t("services.dialog.create.envNamesOnly")}
            </p>
            <ul className="flex flex-wrap gap-ui-8">
              {preview.environmentKeys.map((key) => (
                <li key={key}>
                  <Mono>{key}</Mono>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title={t("services.dialog.common.logs")}>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.stdoutLine")}
          <Mono>{preview.stdoutPath ?? t("services.dialog.common.notSet")}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.stderrLine")}
          <Mono>{preview.stderrPath ?? t("services.dialog.common.notSet")}</Mono>
        </p>
      </Section>

      <Section title={t("services.dialog.create.impactSection")}>
        <ul className="grid gap-ui-8 text-sm text-muted-foreground">
          {preview.persistenceNotes.map((note) => (
            <li className="flex gap-ui-8" key={note}>
              <span className="text-primary" aria-hidden="true">
                •
              </span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{note}</span>
            </li>
          ))}
        </ul>
      </Section>

      <p className="rounded-control bg-surface-muted px-ui-12 py-ui-8 text-sm font-medium">
        {preview.effectNote}
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
  dialog: Extract<CreateDialogState, { phase: "done" | "failed" }>;
  form: CreateFormState;
}) {
  const t = useT();
  if (dialog.phase === "done") {
    const outcome = describeCreateOutcome(dialog.execution, t);
    return (
      <div className="grid gap-ui-8" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-success">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.create.doneNote")}
        </p>
      </div>
    );
  }
  if (dialog.execution) {
    const outcome = describeCreateOutcome(dialog.execution, t);
    return (
      <div className="grid gap-ui-8" role="alert">
        <p className="text-sm font-semibold text-danger">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-ui-8" role="alert">
      <p className="text-sm font-semibold text-danger">
        {t("services.dialog.create.rejectedTitle")}
      </p>
      <p className="break-words text-sm text-muted-foreground">
        {scrubSecrets(dialog.error?.message ?? t("services.dialog.common.refused"), form, t)}
      </p>
    </div>
  );
}

/**
 * The whole dialog as a controlled view: the form, the preview, the busy state
 * and the result are all decided by `form` and `dialog`.
 */
export function CreateServiceDialogView({
  dialog,
  form,
  onClose,
  onConfirm,
  onEdit,
  onFormChange,
  onPreview,
  showErrors,
}: {
  dialog: CreateDialogState;
  form: CreateFormState;
  onClose: () => void;
  onConfirm: () => void;
  onEdit: () => void;
  onFormChange: (next: CreateFormState) => void;
  onPreview: () => void;
  showErrors: boolean;
}) {
  const t = useT();
  const busy = dialog.phase === "previewing" || dialog.phase === "creating";
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
            form={form}
            onFormChange={onFormChange}
            showErrors={showErrors}
          />
        </>
      );
      footer = (
        <>
          <Button data-modal-cancel disabled={busy} onClick={onClose}>
            {t("services.dialog.common.cancel")}
          </Button>
          <Button disabled={busy} onClick={onPreview} variant="primary">
            {t("services.dialog.common.preview")}
          </Button>
        </>
      );
      break;
    case "preview":
    case "creating":
      body = (
        <>
          <PreviewBody preview={dialog.preview} />
          {dialog.phase === "creating" ? (
            <p className="text-sm text-warning" role="status" aria-live="polite">
              {t("services.dialog.create.creatingNote")}
            </p>
          ) : null}
        </>
      );
      footer = (
        <>
          <Button
            data-modal-cancel
            disabled={dialog.phase === "creating"}
            onClick={onEdit}
          >
            {t("services.dialog.common.backToEdit")}
          </Button>
          <Button
            disabled={dialog.phase === "creating"}
            onClick={onConfirm}
            variant="primary"
          >
            {t("services.dialog.create.confirm")}
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
          <Button data-modal-cancel onClick={onClose}>
            {t("services.dialog.common.close")}
          </Button>
          <Button onClick={onEdit} variant="primary">
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
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {t("services.dialog.create.eyebrow")}
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          {t("services.dialog.create.title")}
        </h3>
      </div>
      {body}
    </Modal>
  );
}

/**
 * Create a UserHome-owned launchd job: fill the form, look at the preview,
 * confirm. Only the preview and the confirmation of the creation are wired; the
 * new task is neither loaded nor started.
 */
export function CreateServiceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (execution: CreateServiceExecution) => void;
}) {
  const [form, setForm] = useState<CreateFormState>(INITIAL_CREATE_FORM);
  const [dialog, dispatch] = useReducer(createDialogReducer, INITIAL_CREATE_DIALOG);
  const [showErrors, setShowErrors] = useState(false);
  const t = useT();

  const preview = useCallback(() => {
    setShowErrors(true);
    const built = buildCreateRequest(form, t);
    if (!built.ok) return;
    dispatch({ type: "previewRequested" });
    void previewCreateLaunchdService(built.request)
      .then((result) => dispatch({ type: "previewLoaded", preview: result }))
      .catch((error: unknown) =>
        dispatch({ type: "previewFailed", error: decodeAppError(error) as AppError }),
      );
  }, [form, t]);

  const confirm = useCallback(() => {
    if (dialog.phase !== "preview") return;
    const operationId = dialog.preview.operationId;
    dispatch({ type: "confirmRequested" });
    void executeCreateLaunchdService(operationId)
      .then((execution) => {
        dispatch({ type: "createFinished", execution });
        onCreated(execution);
      })
      .catch((error: unknown) =>
        dispatch({ type: "createFailed", error: decodeAppError(error) }),
      );
  }, [dialog, onCreated]);

  return (
    <CreateServiceDialogView
      dialog={dialog}
      form={form}
      onClose={onClose}
      onConfirm={confirm}
      onEdit={() => dispatch({ type: "editRequested" })}
      onFormChange={setForm}
      onPreview={preview}
      showErrors={showErrors}
    />
  );
}
