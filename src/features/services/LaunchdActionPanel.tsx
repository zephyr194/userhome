import { useCallback, useEffect, useReducer, useRef } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { decodeAppError } from "../../ipc/core";
import { cancelOperation } from "../../ipc/operations";
import {
  executeLaunchdAction,
  previewLaunchdAction,
  type LaunchdAction,
  type LaunchdActionExecution,
  type LaunchdActionPreview,
  type LaunchdService,
} from "../../ipc/services";
import {
  ACTION_HINTS,
  INITIAL_ACTION_PANEL_STATE,
  actionLabel,
  actionPanelReducer,
  availableActions,
  noActionsReason,
  observedLines,
  presentOutcome,
  stepStatusText,
  type ActionPanelState,
} from "./launchdActionModel";

const WRAP = "break-words [overflow-wrap:anywhere]";

function TextList({ items, label }: { items: readonly string[]; label: string }) {
  return (
    <ul className="mt-ui-xs grid gap-ui-xs" aria-label={label}>
      {items.map((item) => (
        <li className={WRAP} key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function PreviewCard({
  busy,
  onCancel,
  onConfirm,
  preview,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  preview: LaunchdActionPreview;
}) {
  return (
    <div
      className="min-w-0 rounded-control bg-surface-muted px-ui-xl py-ui-lg text-xs"
      aria-label={`${actionLabel(preview.action)}预览`}
    >
      <p className="text-sm font-semibold">
        预览：{actionLabel(preview.action)}「{preview.label}」
      </p>
      <p className="mt-ui-md font-semibold">真实含义</p>
      <TextList items={preview.meaning} label="真实含义" />
      <p className="mt-ui-md font-semibold">持久化影响</p>
      <TextList items={preview.persistence} label="持久化影响" />
      <p className="mt-ui-md font-semibold">当前状态</p>
      <TextList items={observedLines(preview.current)} label="当前状态" />
      <p className="mt-ui-md font-semibold">将执行的命令</p>
      {preview.commands.length === 0 ? (
        <p className="mt-ui-xs">无需执行命令。</p>
      ) : (
        <ul className="mt-ui-xs grid gap-ui-xs" aria-label="将执行的命令">
          {preview.commands.map((command) => (
            <li className={`font-mono ${WRAP}`} key={command}>
              {command}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-ui-md text-muted-foreground">
        确认后会再次核对任务归属与当前状态，执行后读取 launchd 的真实状态来核对结果。
      </p>
      <div className="mt-ui-lg flex flex-wrap gap-ui-md">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={onConfirm}
        >
          确认{actionLabel(preview.action)}
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function ResultCard({
  execution,
  onDismiss,
  onRefresh,
}: {
  execution: LaunchdActionExecution;
  onDismiss: () => void;
  onRefresh: () => void;
}) {
  const result = presentOutcome(execution.outcome);
  return (
    <div
      className="min-w-0 rounded-control bg-surface-muted px-ui-xl py-ui-lg text-xs"
      role="status"
      aria-label={`${actionLabel(execution.action)}结果`}
    >
      <p className="flex flex-wrap items-center gap-ui-sm text-sm font-semibold">
        {actionLabel(execution.action)}：
        <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
      </p>
      <p className={`mt-ui-md leading-relaxed ${WRAP}`}>{execution.message}</p>
      {execution.steps.length > 0 ? (
        <ul className="mt-ui-md grid gap-ui-xs" aria-label="已执行的步骤">
          {execution.steps.map((step) => (
            <li className={WRAP} key={step.command}>
              <span className="font-mono">{step.command}</span>
              {"："}
              {stepStatusText(step.status)}
              {step.exitCode === undefined ? "" : `（退出码 ${step.exitCode}）`}
              {step.detail ? `，${step.detail}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-ui-md font-semibold">回读到的状态</p>
      <TextList items={observedLines(execution.observed)} label="回读到的状态" />
      {execution.cancelRequested ? (
        <p className="mt-ui-md text-muted-foreground">
          执行期间收到过取消请求；已开始的命令无法中途撤回。
        </p>
      ) : null}
      <div className="mt-ui-lg flex flex-wrap gap-ui-md">
        {result.needsRefresh ? (
          <Button size="sm" variant="primary" onClick={onRefresh}>
            刷新
          </Button>
        ) : null}
        <Button size="sm" onClick={onDismiss}>
          关闭
        </Button>
      </div>
    </div>
  );
}

/**
 * The lifecycle actions of one job the backend judged modifiable. Each action
 * is previewed first (real meaning, persistence, exact command) and runs only
 * after a confirmation; the result is what the backend read back from launchd.
 * The panel sends an action, a domain and a label, and later an operation id.
 */
export function LaunchdActionPanel({
  onChanged,
  service,
}: {
  /** Called when the job's state may have changed, so the list is read again. */
  onChanged?: () => void;
  service: LaunchdService;
}) {
  const [state, dispatch] = useReducer(
    actionPanelReducer,
    INITIAL_ACTION_PANEL_STATE,
  );
  const alive = useRef(true);
  const changedRef = useRef(onChanged);

  useEffect(() => {
    changedRef.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const preview = useCallback(
    (action: LaunchdAction) => {
      dispatch({ type: "previewStarted", action });
      previewLaunchdAction({ action, domain: "GUI", label: service.label })
        .then((result) => {
          if (alive.current) dispatch({ type: "previewed", preview: result });
        })
        .catch((error: unknown) => {
          if (alive.current) {
            dispatch({ type: "failed", error: decodeAppError(error) });
          }
        });
    },
    [service.label],
  );

  const confirm = useCallback((shown: LaunchdActionPreview) => {
    dispatch({ type: "executeStarted" });
    executeLaunchdAction(shown.operationId)
      .then((execution) => {
        if (alive.current) dispatch({ type: "executed", execution });
        changedRef.current?.();
      })
      .catch((error: unknown) => {
        if (alive.current) {
          dispatch({ type: "failed", error: decodeAppError(error) });
        }
        // The result is not known, so the list must not keep a stale state.
        changedRef.current?.();
      });
  }, []);

  const dismissPreview = useCallback((shown: LaunchdActionPreview) => {
    // Free the pending preview in the backend; its expiry would do it anyway.
    void cancelOperation(shown.operationId).catch(() => undefined);
    dispatch({ type: "dismissed" });
  }, []);

  const actions = availableActions(service);
  const reason = noActionsReason(service);
  const busy = state.phase === "previewing" || state.phase === "executing";

  return (
    <section
      className="border-b border-border px-ui-3xl py-ui-xl"
      aria-label="任务动作"
    >
      <h4 className="text-sm font-semibold">任务动作</h4>
      <p className="mt-ui-xs text-xs leading-relaxed text-muted-foreground">
        仅限加载、启动、停止、重启、禁用自启、启用自启与卸载；每个动作先预览再确认，不会删除配置文件。
      </p>
      {reason ? (
        <p className="mt-ui-md text-xs text-warning" role="status">
          {reason}
        </p>
      ) : (
        <ul className="mt-ui-md grid gap-ui-sm" aria-label="可用动作">
          {actions.map((action) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-md"
              key={action}
            >
              <Button
                size="sm"
                disabled={busy || state.phase === "previewed"}
                onClick={() => preview(action)}
              >
                {actionLabel(action)}
              </Button>
              <span className="text-xs text-muted-foreground">
                {ACTION_HINTS[action]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-ui-lg grid min-w-0 gap-ui-md">
        <PanelState
          dismissPreview={dismissPreview}
          confirm={confirm}
          onChanged={() => onChanged?.()}
          state={state}
          reset={() => dispatch({ type: "dismissed" })}
        />
      </div>
    </section>
  );
}

function PanelState({
  confirm,
  dismissPreview,
  onChanged,
  reset,
  state,
}: {
  confirm: (preview: LaunchdActionPreview) => void;
  dismissPreview: (preview: LaunchdActionPreview) => void;
  onChanged: () => void;
  reset: () => void;
  state: ActionPanelState;
}) {
  switch (state.phase) {
    case "idle":
      return null;
    case "previewing":
      return (
        <p className="text-xs text-muted-foreground" role="status">
          正在读取{actionLabel(state.action)}的预览…
        </p>
      );
    case "previewed":
    case "executing":
      return (
        <PreviewCard
          busy={state.phase === "executing"}
          preview={state.preview}
          onConfirm={() => confirm(state.preview)}
          onCancel={() => dismissPreview(state.preview)}
        />
      );
    case "done":
      return (
        <ResultCard
          execution={state.execution}
          onDismiss={reset}
          onRefresh={onChanged}
        />
      );
    case "error":
      return (
        <div
          className="min-w-0 rounded-control border border-danger-border bg-danger-soft px-ui-xl py-ui-lg text-xs text-danger"
          role="alert"
        >
          <p className={`font-semibold ${WRAP}`}>
            {state.during === "preview"
              ? `无法预览${actionLabel(state.action)}：${state.error.message}`
              : `${actionLabel(state.action)}的结果未知：${state.error.message}`}
          </p>
          {state.during === "execute" ? (
            <p className="mt-ui-xs">
              请求没有返回可信的结果，不能确认任务是否已变化；请刷新后核对真实状态。
            </p>
          ) : null}
          <div className="mt-ui-md flex flex-wrap gap-ui-md">
            {state.during === "execute" ? (
              <Button size="sm" variant="primary" onClick={onChanged}>
                刷新
              </Button>
            ) : null}
            <Button size="sm" onClick={reset}>
              关闭
            </Button>
          </div>
        </div>
      );
  }
}
