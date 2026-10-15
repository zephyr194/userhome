import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge } from "../../components/ui";
import type { AppErrorCode } from "../../ipc/core";
import type { GrantStoreProblem } from "../../ipc/grants";
import {
  isResettable,
  type GrantStoreController,
  type GrantStoreNoticeState,
  type ResetFailure,
} from "./grantStoreController";
import { restoreFocus } from "./restoreFocus";

const WRAP = "break-words [overflow-wrap:anywhere]";

const PROBLEM_COPY: Record<GrantStoreProblem, string> = {
  CORRUPT: "授权文件已损坏，授权相关操作暂时不可用。",
  NEWER_VERSION:
    "授权文件由较新版本的 UserHome 写入，当前版本无法读取，授权相关操作暂时不可用。重置会使新版本的授权失效。",
  NOT_REGULAR_FILE:
    "授权存储位置不是常规文件（例如目录或链接），UserHome 不会改动它。请手动处理后点击“重新检测”。",
  IO: "无法访问授权文件（权限或读写错误），重置无法解决此问题，需要手动处理（检查文件权限等），然后点击“重新检测”。",
};

const FAILURE_HEADLINE: Partial<Record<AppErrorCode, string>> = {
  CONFLICT: "授权存储当前无需重置，未做任何更改。",
  NOT_SUPPORTED: "授权存储不是常规文件，需要手动处理，未做任何更改。",
  PERMISSION_DENIED: "无法隔离授权存储，已回滚，未做任何更改。",
  PARTIAL_FAILURE:
    "原文件已改名保留，但未能建立新的授权库；当前没有授权库文件。关闭后可重新检测。",
  INTERNAL: "无法确认重置结果。请关闭后重新检测授权存储状态。",
};

function failureText(failure: ResetFailure): {
  headline: string;
  detail?: string;
} {
  const headline = FAILURE_HEADLINE[failure.code] ?? "授权存储未能重置。";
  return failure.code === "INTERNAL"
    ? { headline }
    : { headline, detail: failure.message };
}

function NoticeRow({
  actions,
  badge,
  children,
  role,
  tone,
  busy,
}: {
  actions?: ReactNode;
  badge: string;
  busy?: boolean;
  children: ReactNode;
  role: "alert" | "status";
  tone: "danger" | "success" | "warning";
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-ui-md px-ui-3xl py-ui-md text-xs"
      role={role}
      aria-busy={busy || undefined}
    >
      <StatusBadge className="shrink-0" tone={tone}>
        {badge}
      </StatusBadge>
      <p
        className={`m-0 min-w-0 flex-1 leading-relaxed ${WRAP} ${
          tone === "danger"
            ? "text-danger"
            : tone === "success"
              ? "text-muted-foreground"
              : "text-warning"
        }`}
      >
        {children}
      </p>
      {actions}
    </div>
  );
}

function ResetDialog({
  onCancel,
  onConfirm,
  reason,
  state,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  reason: GrantStoreProblem | undefined;
  state: GrantStoreNoticeState;
}) {
  const { dialog } = state;
  const busy = dialog.phase === "resetting";
  const failure = dialog.phase === "failed" ? failureText(dialog.failure) : null;
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-4"
      onCancel={onCancel}
      titleId="grant-store-reset-heading"
    >
      <h3 className={WRAP} id="grant-store-reset-heading">
        隔离并重置授权存储？
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        UserHome 会把无法使用的授权文件改名后留在原目录，并建立一个空的授权存储。
        所有授权需重新选择；原文件会改名保留，不会被删除。“取消”不会改变任何内容。
      </p>
      {reason === "NEWER_VERSION" ? (
        <p className="text-sm leading-relaxed text-warning">
          该文件由较新版本的 UserHome 写入，重置会使新版本的授权失效。
        </p>
      ) : null}
      {busy ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          正在隔离并重置授权存储…
        </p>
      ) : null}
      {failure ? (
        <div
          className={`rounded-control border border-danger-border bg-danger-soft px-3 py-2.5 text-sm text-danger ${WRAP}`}
          role="alert"
        >
          <p className="m-0 font-medium">重置未完成：{failure.headline}</p>
          {failure.detail ? (
            <p className="m-0 mt-1">{failure.detail}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-dialog-cancel disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {dialog.phase === "failed" ? "重试隔离并重置" : "隔离并重置"}
        </Button>
      </div>
    </ConfirmDialog>
  );
}

export function GrantStoreNoticeView({
  onCancel,
  onConfirm,
  onDismissCompleted,
  onRecheck,
  onRequestReset,
  resetButtonRef,
  state,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  onDismissCompleted: () => void;
  onRecheck: () => void;
  onRequestReset: () => void;
  resetButtonRef?: Ref<HTMLButtonElement>;
  state: GrantStoreNoticeState;
}) {
  const { check, completed, dialog } = state;
  const recheck = (
    <Button
      className="shrink-0"
      disabled={state.rechecking || dialog.phase === "resetting"}
      onClick={onRecheck}
      size="sm"
    >
      {state.rechecking ? "检测中…" : "重新检测"}
    </Button>
  );
  const reason = check.phase === "unavailable" ? check.reason : undefined;

  return (
    <>
      {check.phase === "unavailable" ? (
        <NoticeRow
          actions={
            <>
              {isResettable(check.reason) ? (
                <Button
                  className="shrink-0"
                  disabled={state.rechecking || dialog.phase !== "closed"}
                  onClick={onRequestReset}
                  ref={resetButtonRef}
                  size="sm"
                  variant="danger"
                >
                  隔离并重置
                </Button>
              ) : null}
              {recheck}
            </>
          }
          badge="授权存储不可用"
          busy={state.rechecking}
          role="alert"
          tone="danger"
        >
          {PROBLEM_COPY[check.reason]}
          {isResettable(check.reason)
            ? "重置后所有授权需重新选择，原文件会改名保留，不会被删除。"
            : ""}
        </NoticeRow>
      ) : null}
      {check.phase === "check-failed" ? (
        <NoticeRow
          actions={recheck}
          badge="授权状态未知"
          busy={state.rechecking}
          role="alert"
          tone="warning"
        >
          无法检测授权存储状态，授权相关操作可能不可用。
        </NoticeRow>
      ) : null}
      {completed ? (
        <NoticeRow
          actions={
            <Button className="shrink-0" onClick={onDismissCompleted} size="sm">
              知道了
            </Button>
          }
          badge="授权存储已重置"
          role="status"
          tone="success"
        >
          原文件已改名保留为 {completed.quarantineFileName}，不会被删除。所有授权需重新选择
          {completed.previousReason === "NEWER_VERSION"
            ? "；此前由较新版本写入的授权已失效"
            : ""}
          。
        </NoticeRow>
      ) : null}
      {dialog.phase !== "closed" ? (
        <ResetDialog
          onCancel={onCancel}
          onConfirm={onConfirm}
          reason={reason}
          state={state}
        />
      ) : null}
    </>
  );
}

/**
 * Start-up notice for an unusable authorization store. Mounted by AppShell
 * only while there is something to show; the reset happens solely through the
 * confirmation dialog.
 */
export function GrantStoreNotice({
  controller,
  state,
}: {
  controller: GrantStoreController;
  state: GrantStoreNoticeState;
}) {
  const resetButton = useRef<HTMLButtonElement | null>(null);
  const dialogOpen = state.dialog.phase !== "closed";
  const wasOpen = useRef(false);

  // Whatever closes the dialog (cancel, Escape, success, a closed failure),
  // focus goes back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) {
      restoreFocus(resetButton.current);
    }
    wasOpen.current = dialogOpen;
  }, [dialogOpen]);

  return (
    <GrantStoreNoticeView
      onCancel={controller.closeDialog}
      onConfirm={() => void controller.confirmReset()}
      onDismissCompleted={controller.dismissCompleted}
      onRecheck={() => void controller.refresh()}
      onRequestReset={controller.openDialog}
      resetButtonRef={resetButton}
      state={state}
    />
  );
}
