import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActionRow, Button, Modal, SwitchField, TextField } from "../../components/ui";
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
  return (
    <div className="grid gap-ui-16">
      <p className="text-xs leading-relaxed text-muted-foreground">
        只修改下列字段，其余内容保持原样。保存只改写这个任务的配置文件，编辑后需重新加载任务才生效；本页不会加载或重启任务。
      </p>

      <Section title="程序与参数">
        <TextField
          autoComplete="off"
          description="绝对路径；shell 与 env、sudo 等包装器会被拒绝。"
          disabled={disabled}
          error={errors?.executable}
          label="可执行文件路径"
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
              label={`参数 ${index + 1}`}
              onValueChange={(value) => onFormChange(updateArgument(form, row.id, value))}
              spellCheck={false}
              value={row.value}
            />
            <ActionRow>
              <Button
                disabled={disabled || index === 0}
                onClick={() => onFormChange(moveArgument(form, row.id, -1))}
                size="sm"
              >
                上移
              </Button>
              <Button
                disabled={disabled || index === form.arguments.length - 1}
                onClick={() => onFormChange(moveArgument(form, row.id, 1))}
                size="sm"
              >
                下移
              </Button>
              <Button
                disabled={disabled}
                onClick={() => onFormChange(removeArgument(form, row.id))}
                size="sm"
                variant="ghost"
              >
                删除参数
              </Button>
            </ActionRow>
          </div>
        ))}
        <div>
          <Button
            disabled={disabled}
            onClick={() => onFormChange(addArgument(form))}
            size="sm"
          >
            添加参数
          </Button>
        </div>
      </Section>

      <Section title="工作目录">
        <p className="text-xs text-muted-foreground">
          当前工作目录不在这里显示；留空表示不修改。要移除它，请勾选下方的清除选项。
        </p>
        <TextField
          autoComplete="off"
          description="可选；绝对路径，目录必须已存在。"
          disabled={disabled || form.clearWorkingDirectory}
          error={errors?.workingDirectory}
          label="新的工作目录"
          onValueChange={(value) => onFormChange({ ...form, workingDirectory: value })}
          spellCheck={false}
          value={form.workingDirectory}
        />
        <SwitchField
          checked={form.clearWorkingDirectory}
          description="勾选后，保存时会从配置中移除工作目录。"
          disabled={disabled}
          label="清除工作目录"
          onCheckedChange={(checked) =>
            onFormChange({ ...form, clearWorkingDirectory: checked })
          }
        />
      </Section>

      <Section title="环境变量">
        <p className="text-xs text-muted-foreground">{ENVIRONMENT_NOTE}</p>
        <p className="text-xs text-muted-foreground">
          已有的变量只显示名称，它们的值无法在这里看到。输入同名变量会覆盖其值。
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
                    {removed ? "撤销移除" : "移除"}
                  </Button>
                  {removed ? (
                    <span className="text-xs text-warning">保存时将被移除</span>
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
                label={`变量名 ${index + 1}`}
                onValueChange={(value) => onFormChange(updateEnvironmentKey(form, row.id, value))}
                spellCheck={false}
                value={row.key}
              />
              <TextField
                autoComplete="off"
                description="可能包含密钥，输入已隐藏。"
                disabled={disabled}
                error={errors?.environment[row.id]?.value}
                label={`变量值 ${index + 1}`}
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
                删除此行
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            disabled={disabled}
            onClick={() => onFormChange(addEnvironment(form))}
            size="sm"
          >
            添加环境变量
          </Button>
        </div>
      </Section>

      <div className="grid gap-ui-12 sm:grid-cols-2">
        <TextField
          autoComplete="off"
          description="留空表示不修改；清空已有的值会移除该项。"
          disabled={disabled}
          error={errors?.stdoutPath}
          label="标准输出日志路径"
          onValueChange={(value) => onFormChange({ ...form, stdoutPath: value })}
          spellCheck={false}
          value={form.stdoutPath}
        />
        <TextField
          autoComplete="off"
          description="留空表示不修改；清空已有的值会移除该项。"
          disabled={disabled}
          error={errors?.stderrPath}
          label="标准错误日志路径"
          onValueChange={(value) => onFormChange({ ...form, stderrPath: value })}
          spellCheck={false}
          value={form.stderrPath}
        />
      </div>

      <Section title="持久化选项">
        <SwitchField
          checked={form.runAtLoad}
          description={RUN_AT_LOAD_IMPACT}
          disabled={disabled}
          label="登录后自动启动"
          onCheckedChange={(checked) => onFormChange({ ...form, runAtLoad: checked })}
        />
        <SwitchField
          checked={form.keepAlive}
          description={
            original.keepAliveLocked ? KEEP_ALIVE_CONDITIONAL_NOTE : KEEP_ALIVE_IMPACT
          }
          disabled={disabled || original.keepAliveLocked}
          label="退出后自动重启"
          onCheckedChange={(checked) => onFormChange({ ...form, keepAlive: checked })}
        />
      </Section>

      {errors?.general ? <ErrorText>{errors.general}</ErrorText> : null}
    </div>
  );
}

function PreviewBody({ preview }: { preview: EditPreview }) {
  return (
    <div className="grid gap-ui-16">
      <Section title="将保存的文件">
        <p className="text-sm">
          <Mono>{preview.filePath}</Mono>
        </p>
      </Section>

      <Section title="变更字段">
        <ul className="flex flex-wrap gap-ui-8 text-sm">
          {preview.changes.map((change) => (
            <li key={change}>{changeLabel(change)}</li>
          ))}
        </ul>
      </Section>

      {preview.executable === undefined ? null : (
        <Section title="实际执行目标">
          <p className="text-xs text-muted-foreground">
            程序与参数逐项如下，不经 shell；敏感参数已隐藏。
          </p>
          <ol className="grid gap-ui-4 text-sm">
            <li>
              <Mono>{preview.executable}</Mono>
            </li>
            {(preview.arguments ?? []).map((argument, index) => (
              <li key={index}>
                <Mono>{argument.length === 0 ? "（空参数）" : argument}</Mono>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {preview.environmentSet.length + preview.environmentRemoved.length === 0 ? null : (
        <Section title="环境变量">
          <p className="text-xs text-muted-foreground">只显示变量名，值不会显示。</p>
          {preview.environmentSet.length === 0 ? null : (
            <p className="text-sm">
              设置：
              {preview.environmentSet.map((name) => (
                <span className="mr-ui-8" key={name}>
                  <Mono>{name}</Mono>
                </span>
              ))}
            </p>
          )}
          {preview.environmentRemoved.length === 0 ? null : (
            <p className="text-sm">
              移除：
              {preview.environmentRemoved.map((name) => (
                <span className="mr-ui-8" key={name}>
                  <Mono>{name}</Mono>
                </span>
              ))}
            </p>
          )}
        </Section>
      )}

      <Section title="备份">
        <p className="text-sm text-muted-foreground">{preview.backup}</p>
      </Section>

      <p className="rounded-control bg-surface-muted px-ui-12 py-ui-8 text-sm font-medium">
        {preview.reloadNote}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        预览到期：
        <time dateTime={preview.expiresAt}>
          {new Date(preview.expiresAt).toLocaleString("zh-CN")}
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
  if (dialog.phase === "done") {
    const outcome = describeEditOutcome(dialog.execution);
    const grant = grantNotice(dialog.execution);
    return (
      <div className="grid gap-ui-8" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-success">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
        {grant ? <p className="text-xs text-warning">{grant}</p> : null}
      </div>
    );
  }
  if (dialog.execution) {
    const outcome = describeEditOutcome(dialog.execution);
    return (
      <div className="grid gap-ui-8" role="alert">
        <p className="text-sm font-semibold text-danger">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
      </div>
    );
  }
  const notice = dialog.error
    ? describeEditFailure(dialog.error)
    : { title: "编辑未完成", detail: "请重新预览后再保存。" };
  return (
    <div className="grid gap-ui-8" role="alert">
      <p className="text-sm font-semibold text-danger">{notice.title}</p>
      <p className="break-words text-sm text-muted-foreground">
        {scrubSecrets(notice.detail, form)}
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
  const busy = dialog.phase === "previewing" || dialog.phase === "saving";
  let body: ReactNode;
  let footer: ReactNode;

  switch (dialog.phase) {
    case "editing":
    case "previewing":
      body = (
        <>
          {dialog.phase === "editing" && dialog.error ? (
            <ErrorText>{scrubSecrets(dialog.error.message, form)}</ErrorText>
          ) : null}
          {dialog.phase === "previewing" ? (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              正在生成预览…
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
          <Button data-modal-cancel disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={onPreview} variant="primary">
            预览
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
              正在保存配置文件，完成后显示结果。
            </p>
          ) : null}
        </>
      );
      footer = (
        <>
          <Button data-modal-cancel disabled={dialog.phase === "saving"} onClick={onEdit}>
            返回修改
          </Button>
          <Button disabled={dialog.phase === "saving"} onClick={onConfirm} variant="primary">
            确认保存
          </Button>
        </>
      );
      break;
    case "done":
      body = <ResultBody dialog={dialog} form={form} />;
      footer = (
        <Button data-modal-cancel onClick={onClose} variant="primary">
          完成
        </Button>
      );
      break;
    case "failed":
      body = <ResultBody dialog={dialog} form={form} />;
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose}>
            关闭
          </Button>
          <Button onClick={onEdit} variant="primary">
            返回修改
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
          UserHome 已接管的任务
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          编辑任务配置
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
    () => buildEditRequest(original, form),
    [original, form],
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
