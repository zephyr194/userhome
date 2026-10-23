import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button, StatusBadge } from "../../components/ui";
import type { Locale, MessageKey, TranslateFunction } from "../../i18n";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
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

const PROBLEM_KEYS: Record<GrantStoreProblem, MessageKey> = {
  CORRUPT: "grants.problem.CORRUPT",
  NEWER_VERSION: "grants.problem.NEWER_VERSION",
  NOT_REGULAR_FILE: "grants.problem.NOT_REGULAR_FILE",
  IO: "grants.problem.IO",
};

const FAILURE_HEADLINE_KEYS: Partial<Record<AppErrorCode, MessageKey>> = {
  CONFLICT: "grants.failure.CONFLICT",
  NOT_SUPPORTED: "grants.failure.NOT_SUPPORTED",
  PERMISSION_DENIED: "grants.failure.PERMISSION_DENIED",
  PARTIAL_FAILURE: "grants.failure.PARTIAL_FAILURE",
  INTERNAL: "grants.failure.INTERNAL",
};

function failureText(
  failure: ResetFailure,
  t: TranslateFunction,
  locale: Locale,
): {
  headline: string;
  detail?: string;
} {
  const headlineKey = FAILURE_HEADLINE_KEYS[failure.code] ?? "grants.failure.default";
  const headline = t(headlineKey);
  return failure.code === "INTERNAL"
    ? { headline }
    : { headline, detail: localizeError(failure, locale) };
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
      className="r12-shell-notice flex min-w-0 flex-wrap items-center gap-ui-8 rounded-control border border-line px-ui-12 py-ui-8 text-xs"
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
  const t = useT();
  const locale = useLocale();
  const { dialog } = state;
  const busy = dialog.phase === "resetting";
  const failure =
    dialog.phase === "failed" ? failureText(dialog.failure, t, locale) : null;
  return (
    <ConfirmDialog
      busy={busy}
      className="space-y-ui-16"
      onCancel={onCancel}
      titleId="grant-store-reset-heading"
    >
      <h3 className={WRAP} id="grant-store-reset-heading">
        {t("grants.reset.title")}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("grants.reset.description")}
      </p>
      {reason === "NEWER_VERSION" ? (
        <p className="text-sm leading-relaxed text-warning">
          {t("grants.reset.newerNote")}
        </p>
      ) : null}
      {busy ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {t("grants.reset.running")}
        </p>
      ) : null}
      {failure ? (
        <div
          className={`rounded-control border border-danger-border bg-danger-soft px-ui-12 py-ui-12 text-sm text-danger ${WRAP}`}
          role="alert"
        >
          <p className="m-0 font-medium">
            {t("grants.failure.headline", { headline: failure.headline })}
          </p>
          {failure.detail ? (
            <p className="m-0 mt-ui-4">{failure.detail}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-ui-8">
        <Button data-dialog-cancel disabled={busy} onClick={onCancel} variant="secondary">
          {t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {dialog.phase === "failed"
            ? t("grants.reset.retry")
            : t("grants.reset.confirm")}
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
  const t = useT();
  const { check, completed, dialog } = state;
  const recheck = (
    <Button
      className="shrink-0"
      disabled={state.rechecking || dialog.phase === "resetting"}
      onClick={onRecheck}
      size="sm"
      variant="secondary"
    >
      {state.rechecking
        ? t("grants.recheck.busy")
        : t("grants.recheck.label")}
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
                  {t("grants.reset.confirm")}
                </Button>
              ) : null}
              {recheck}
            </>
          }
          badge={t("grants.notice.unavailable")}
          busy={state.rechecking}
          role="alert"
          tone="danger"
        >
          {t(PROBLEM_KEYS[check.reason])}
          {isResettable(check.reason) ? t("grants.notice.resettable") : ""}
        </NoticeRow>
      ) : null}
      {check.phase === "check-failed" ? (
        <NoticeRow
          actions={recheck}
          badge={t("grants.notice.unknown")}
          busy={state.rechecking}
          role="alert"
          tone="warning"
        >
          {t("grants.recheck.unknownStatus")}
        </NoticeRow>
      ) : null}
      {completed ? (
        <NoticeRow
          actions={
            <Button className="shrink-0" onClick={onDismissCompleted} size="sm" variant="secondary">
              {t("grants.notice.gotIt")}
            </Button>
          }
          badge={t("grants.notice.reset")}
          role="status"
          tone="success"
        >
          {t(
            completed.previousReason === "NEWER_VERSION"
              ? "grants.notice.completedNewer"
              : "grants.notice.completed",
            { file: completed.quarantineFileName },
          )}
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
