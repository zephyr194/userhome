import { useCallback, useEffect, useReducer, useRef } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { localizedErrorMessage } from "../../i18n/errors";
import { useT } from "../../i18n/useLocale";
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
  actionHint,
  actionLabel,
  actionPanelReducer,
  availableActions,
  INITIAL_ACTION_PANEL_STATE,
  noActionsReason,
  observedLines,
  presentOutcome,
  stepStatusText,
  type ActionPanelState,
} from "./launchdActionModel";

const WRAP = "break-words [overflow-wrap:anywhere]";

function TextList({ items, label }: { items: readonly string[]; label: string }) {
  return (
    <ul className="mt-ui-4 grid gap-ui-4" aria-label={label}>
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
  const t = useT();
  const action = actionLabel(preview.action, t);
  return (
    <div
      className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs"
      aria-label={t("services.action.previewLabel", { action })}
    >
      <p className="text-sm font-semibold">
        {t("services.action.previewTitle", { action, label: preview.label })}
      </p>
      <p className="mt-ui-8 font-semibold">{t("services.action.meaning")}</p>
      <TextList items={preview.meaning} label={t("services.action.meaning")} />
      <p className="mt-ui-8 font-semibold">{t("services.action.persistence")}</p>
      <TextList items={preview.persistence} label={t("services.action.persistence")} />
      <p className="mt-ui-8 font-semibold">{t("services.action.currentState")}</p>
      <TextList
        items={observedLines(preview.current, t)}
        label={t("services.action.currentState")}
      />
      <p className="mt-ui-8 font-semibold">{t("services.action.commands")}</p>
      {preview.commands.length === 0 ? (
        <p className="mt-ui-4">{t("services.action.noCommands")}</p>
      ) : (
        <ul className="mt-ui-4 grid gap-ui-4" aria-label={t("services.action.commands")}>
          {preview.commands.map((command) => (
            <li className={`font-mono ${WRAP}`} key={command}>
              {command}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-ui-8 text-muted-foreground">
        {t("services.action.verifyNote")}
      </p>
      <div className="mt-ui-8 flex flex-wrap gap-ui-8">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={onConfirm}
        >
          {t("services.action.confirm", { action })}
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
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
  const t = useT();
  const result = presentOutcome(execution.outcome, t);
  const action = actionLabel(execution.action, t);
  return (
    <div
      className="min-w-0 rounded-control bg-surface-muted px-ui-12 py-ui-8 text-xs"
      role="status"
      aria-label={t("services.action.resultLabel", { action })}
    >
      <p className="flex flex-wrap items-center gap-ui-8 text-sm font-semibold">
        {t("services.action.resultTitle", { action })}
        <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
      </p>
      <p className={`mt-ui-8 leading-relaxed ${WRAP}`}>{execution.message}</p>
      {execution.steps.length > 0 ? (
        <ul className="mt-ui-8 grid gap-ui-4" aria-label={t("services.action.steps")}>
          {execution.steps.map((step) => (
            <li className={WRAP} key={step.command}>
              <span className="font-mono">{step.command}</span>
              {t("services.step.separator")}
              {stepStatusText(step.status, t)}
              {step.exitCode === undefined
                ? ""
                : t("services.step.exitCode", { code: step.exitCode })}
              {step.detail ? t("services.step.detail", { detail: step.detail }) : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-ui-8 font-semibold">{t("services.action.readBack")}</p>
      <TextList
        items={observedLines(execution.observed, t)}
        label={t("services.action.readBack")}
      />
      {execution.cancelRequested ? (
        <p className="mt-ui-8 text-muted-foreground">
          {t("services.action.cancelNote")}
        </p>
      ) : null}
      <div className="mt-ui-8 flex flex-wrap gap-ui-8">
        {result.needsRefresh ? (
          <Button size="sm" variant="primary" onClick={onRefresh}>
            {t("common.refresh")}
          </Button>
        ) : null}
        <Button size="sm" onClick={onDismiss}>
          {t("common.close")}
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
  const t = useT();
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
  const reason = noActionsReason(service, t);
  const busy = state.phase === "previewing" || state.phase === "executing";

  return (
    <section
      className="border-b border-border px-ui-16 py-ui-12"
      aria-label={t("services.action.section")}
    >
      <h4 className="text-sm font-semibold">{t("services.action.section")}</h4>
      <p className="mt-ui-4 text-xs leading-relaxed text-muted-foreground">
        {t("services.action.intro")}
      </p>
      {reason ? (
        <p className="mt-ui-8 text-xs text-warning" role="status">
          {reason}
        </p>
      ) : (
        <ul className="mt-ui-8 grid gap-ui-8" aria-label={t("services.action.available")}>
          {actions.map((action) => (
            <li
              className="flex min-w-0 flex-wrap items-center gap-ui-8"
              key={action}
            >
              <Button
                size="sm"
                disabled={busy || state.phase === "previewed"}
                onClick={() => preview(action)}
              >
                {actionLabel(action, t)}
              </Button>
              <span className="text-xs text-muted-foreground">
                {actionHint(action, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-ui-8 grid min-w-0 gap-ui-8">
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
  const t = useT();
  switch (state.phase) {
    case "idle":
      return null;
    case "previewing":
      return (
        <p className="text-xs text-muted-foreground" role="status">
          {t("services.action.previewing", { action: actionLabel(state.action, t) })}
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
        <ActionError
          action={actionLabel(state.action, t)}
          during={state.during}
          message={localizedErrorMessage(state.error, t)}
          onClose={reset}
          onRefresh={onChanged}
        />
      );
  }
}

function ActionError({
  action,
  during,
  message,
  onClose,
  onRefresh,
}: {
  action: string;
  during: "preview" | "execute";
  message: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <div
      className="min-w-0 rounded-control border border-danger-border bg-danger-soft px-ui-12 py-ui-8 text-xs text-danger"
      role="alert"
    >
      <p className={`font-semibold ${WRAP}`}>
        {during === "preview"
          ? t("services.action.previewFailed", { action, message })
          : t("services.action.resultUnknown", { action, message })}
      </p>
      {during === "execute" ? (
        <p className="mt-ui-4">{t("services.action.unknownNote")}</p>
      ) : null}
      <div className="mt-ui-8 flex flex-wrap gap-ui-8">
        {during === "execute" ? (
          <Button size="sm" variant="primary" onClick={onRefresh}>
            {t("common.refresh")}
          </Button>
        ) : null}
        <Button size="sm" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
