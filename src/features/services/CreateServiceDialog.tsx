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
import { Button, Modal, SwitchField, TextField } from "../../components/ui";
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
    <section className="grid gap-ui-sm rounded-control bg-surface-muted px-ui-2xl py-ui-2xl">
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
  const errors = useMemo(() => validateCreateForm(form), [form]);
  const shown = showErrors ? errors : undefined;
  const label = fullLabel(form.labelSuffix);

  return (
    <div className="grid gap-ui-3xl">
      <p className="text-xs leading-relaxed text-muted-foreground">
        仅创建配置文件，不会加载或启动任务。文件固定为 ~/Library/LaunchAgents/
        &lt;label&gt;.plist，label 固定在 {CREATE_SERVICE_NAMESPACE} 之下；程序直接运行，不经 shell。
      </p>

      <TextField
        autoComplete="off"
        description={
          label === undefined ? (
            "只填后缀，或填写命名空间内的完整 label。"
          ) : (
            <>
              实际 label：<Mono>{label}</Mono>
            </>
          )
        }
        disabled={disabled}
        error={shown?.label}
        label="任务名称"
        onValueChange={(value) => onFormChange(setFormField(form, "labelSuffix", value))}
        required
        spellCheck={false}
        value={form.labelSuffix}
      />
      <TextField
        autoComplete="off"
        description="绝对路径；shell 与 env、sudo 等包装器会被拒绝。"
        disabled={disabled}
        error={shown?.executable}
        label="可执行文件路径"
        onValueChange={(value) => onFormChange(setFormField(form, "executable", value))}
        required
        spellCheck={false}
        value={form.executable}
      />

      <Section title="参数">
        <p className="text-xs text-muted-foreground">
          每一项是独立的一个参数，不会拼接成命令行，也不会被 shell 再次解析（最多 {CREATE_SERVICE_LIMITS.arguments} 项）。
        </p>
        {form.arguments.map((row, index) => (
          <div className="grid gap-ui-md" key={row.id}>
            <TextField
              autoComplete="off"
              disabled={disabled}
              error={shown?.arguments[row.id]}
              label={`参数 ${index + 1}`}
              onValueChange={(value) =>
                onFormChange(updateArgument(form, row.id, value))
              }
              spellCheck={false}
              value={row.value}
            />
            <div className="flex flex-wrap gap-ui-sm">
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
            </div>
          </div>
        ))}
        <div>
          <Button
            disabled={disabled || form.arguments.length >= CREATE_SERVICE_LIMITS.arguments}
            onClick={() => onFormChange(addArgument(form))}
            size="sm"
          >
            添加参数
          </Button>
        </div>
      </Section>

      <TextField
        autoComplete="off"
        description="可选；绝对路径，目录必须已存在。"
        disabled={disabled}
        error={shown?.workingDirectory}
        label="工作目录"
        onValueChange={(value) =>
          onFormChange(setFormField(form, "workingDirectory", value))
        }
        spellCheck={false}
        value={form.workingDirectory}
      />

      <Section title="环境变量">
        <p className="text-xs text-muted-foreground">{ENVIRONMENT_NOTE}</p>
        {form.environment.map((row, index) => (
          <div className="grid gap-ui-md" key={row.id}>
            <div className="grid gap-ui-sm sm:grid-cols-2">
              <TextField
                autoComplete="off"
                disabled={disabled}
                error={shown?.environment[row.id]?.key}
                label={`变量名 ${index + 1}`}
                onValueChange={(value) =>
                  onFormChange(updateEnvironmentKey(form, row.id, value))
                }
                spellCheck={false}
                value={row.key}
              />
              <TextField
                autoComplete="off"
                description="可能包含密钥，输入已隐藏。"
                disabled={disabled}
                error={shown?.environment[row.id]?.value}
                label={`变量值 ${index + 1}`}
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
                删除环境变量
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
            添加环境变量
          </Button>
        </div>
      </Section>

      <div className="grid gap-ui-2xl sm:grid-cols-2">
        <TextField
          autoComplete="off"
          description="可选；绝对路径，所在目录必须已存在。"
          disabled={disabled}
          error={shown?.stdoutPath}
          label="标准输出日志路径"
          onValueChange={(value) => onFormChange(setFormField(form, "stdoutPath", value))}
          spellCheck={false}
          value={form.stdoutPath}
        />
        <TextField
          autoComplete="off"
          description="可选；可与标准输出相同。"
          disabled={disabled}
          error={shown?.stderrPath}
          label="标准错误日志路径"
          onValueChange={(value) => onFormChange(setFormField(form, "stderrPath", value))}
          spellCheck={false}
          value={form.stderrPath}
        />
      </div>

      <Section title="持久化选项（默认关闭）">
        <SwitchField
          checked={form.runAtLoad}
          description={RUN_AT_LOAD_IMPACT}
          disabled={disabled}
          label="登录后自动启动"
          onCheckedChange={(checked) =>
            onFormChange(setFormField(form, "runAtLoad", checked))
          }
        />
        <SwitchField
          checked={form.keepAlive}
          description={KEEP_ALIVE_IMPACT}
          disabled={disabled}
          label="退出后自动重启"
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
  return (
    <div className="grid gap-ui-3xl">
      <Section title="将创建的文件">
        <p className="text-sm">
          <Mono>{preview.filePath}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          label：<Mono>{preview.label}</Mono>
        </p>
      </Section>

      <Section title="实际执行目标">
        <p className="text-xs text-muted-foreground">
          程序与参数逐项如下，不经 shell；
          {preview.argumentsRedacted
            ? "敏感参数已隐藏，但会按原值写入配置文件。"
            : "没有识别到敏感参数。"}
        </p>
        <ol className="grid gap-ui-xs text-sm">
          <li>
            <Mono>{preview.executable}</Mono>
          </li>
          {preview.arguments.map((argument, index) => (
            // The list is a fixed snapshot, so position is a stable key.
            <li key={index}>
              <Mono>{argument.length === 0 ? "（空参数）" : argument}</Mono>
            </li>
          ))}
        </ol>
        {preview.workingDirectory ? (
          <p className="text-xs text-muted-foreground">
            工作目录：<Mono>{preview.workingDirectory}</Mono>
          </p>
        ) : null}
      </Section>

      <Section title="环境变量">
        {preview.environmentKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有设置环境变量。</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              只显示变量名，值不会显示，仅写入这个任务自己的配置文件。
            </p>
            <ul className="flex flex-wrap gap-ui-sm">
              {preview.environmentKeys.map((key) => (
                <li key={key}>
                  <Mono>{key}</Mono>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="日志">
        <p className="text-xs text-muted-foreground">
          标准输出：<Mono>{preview.stdoutPath ?? "未设置"}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          标准错误：<Mono>{preview.stderrPath ?? "未设置"}</Mono>
        </p>
      </Section>

      <Section title="持久化影响">
        <ul className="grid gap-ui-md text-sm text-muted-foreground">
          {preview.persistenceNotes.map((note) => (
            <li className="flex gap-ui-sm" key={note}>
              <span className="text-primary" aria-hidden="true">
                •
              </span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{note}</span>
            </li>
          ))}
        </ul>
      </Section>

      <p className="rounded-control bg-surface-muted px-ui-2xl py-ui-sm text-sm font-medium">
        {preview.effectNote}
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
  dialog: Extract<CreateDialogState, { phase: "done" | "failed" }>;
  form: CreateFormState;
}) {
  if (dialog.phase === "done") {
    const outcome = describeCreateOutcome(dialog.execution);
    return (
      <div className="grid gap-ui-sm" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-success">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
        <p className="text-xs text-muted-foreground">
          新任务尚未加载：列表中会显示这个任务，但需要另外确认才能加载或启动。
        </p>
      </div>
    );
  }
  if (dialog.execution) {
    const outcome = describeCreateOutcome(dialog.execution);
    return (
      <div className="grid gap-ui-sm" role="alert">
        <p className="text-sm font-semibold text-danger">{outcome.title}</p>
        <p className="text-sm text-muted-foreground">{outcome.detail}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-ui-sm" role="alert">
      <p className="text-sm font-semibold text-danger">创建被拒绝，没有写入任何文件。</p>
      <p className="break-words text-sm text-muted-foreground">
        {scrubSecrets(dialog.error?.message ?? "操作被拒绝。", form)}
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
  const busy = dialog.phase === "previewing" || dialog.phase === "creating";
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
            form={form}
            onFormChange={onFormChange}
            showErrors={showErrors}
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
    case "creating":
      body = (
        <>
          <PreviewBody preview={dialog.preview} />
          {dialog.phase === "creating" ? (
            <p className="text-sm text-warning" role="status" aria-live="polite">
              正在创建配置文件，窗口会在完成后显示结果。
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
            返回修改
          </Button>
          <Button
            disabled={dialog.phase === "creating"}
            onClick={onConfirm}
            variant="primary"
          >
            确认创建
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
      bodyClassName="grid gap-ui-3xl"
      busy={busy}
      className="max-w-[720px]"
      footer={footer}
      onClose={busy ? () => undefined : onClose}
      open
      titleId={TITLE_ID}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          UserHome 自建任务
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          创建 UserHome 自建任务
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

  const preview = useCallback(() => {
    setShowErrors(true);
    const built = buildCreateRequest(form);
    if (!built.ok) return;
    dispatch({ type: "previewRequested" });
    void previewCreateLaunchdService(built.request)
      .then((result) => dispatch({ type: "previewLoaded", preview: result }))
      .catch((error: unknown) =>
        dispatch({ type: "previewFailed", error: decodeAppError(error) as AppError }),
      );
  }, [form]);

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
