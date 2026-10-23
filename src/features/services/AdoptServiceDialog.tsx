import { useCallback, useEffect, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { Button, Modal } from "../../components/ui";
import type { TranslateFunction } from "../../i18n";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import { decodeAppError } from "../../ipc/core";
import {
  executeAdoptLaunchdService,
  previewAdoptLaunchdService,
  type AdoptExecution,
  type AdoptPreview,
} from "../../ipc/servicesAdopt";
import {
  INITIAL_ADOPT_FLOW,
  adoptFlowReducer,
  describeAdoptFailure,
  describeAdoptSuccess,
  type AdoptFlowState,
} from "./adoptServiceModel";
import { domainLabel } from "./launchdModel";
import { createSequenceGate } from "./sequenceGate";

const TITLE_ID = "adopt-service-heading";

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

function PreviewBody({ preview }: { preview: AdoptPreview }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="grid gap-ui-16">
      <Section title={t("services.dialog.adopt.previewSection")}>
        <p className="text-sm">
          {t("services.dialog.common.labelLine")}
          <Mono>{preview.label}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.adopt.scopeLine")}
          {domainLabel(preview.domain, t)}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.adopt.sourceLine")}
          {preview.source}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("services.dialog.adopt.plistLine")}
          <Mono>{preview.filePath}</Mono>
        </p>
      </Section>

      <Section title={t("services.dialog.common.backup")}>
        <p className="text-sm text-muted-foreground">{preview.backup}</p>
      </Section>

      <Section title={t("services.dialog.adopt.impactSection")}>
        <p className="text-sm font-medium">{preview.effectNote}</p>
        <p className="text-sm">{t("services.dialog.adopt.noFieldChanges")}</p>
      </Section>

      <Section title={t("services.dialog.adopt.externalManagerSection")}>
        <p className="text-sm text-warning">{preview.externalManagerNote}</p>
      </Section>

      <p className="break-words text-xs text-muted-foreground">
        {t("services.dialog.common.previewExpires")}
        <time dateTime={preview.expiresAt}>
          {formatDateTime(preview.expiresAt, locale)}
        </time>
      </p>
    </div>
  );
}

function Notice({
  tone,
  title,
  detail,
}: {
  tone: "success" | "danger";
  title: string;
  detail: string;
}) {
  return (
    <div className="grid gap-ui-8" role={tone === "danger" ? "alert" : "status"} aria-live="polite">
      <p className={`text-sm font-semibold ${tone === "success" ? "text-success" : "text-danger"}`}>
        {title}
      </p>
      <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {detail}
      </p>
    </div>
  );
}

function body(flow: AdoptFlowState, t: TranslateFunction): ReactNode {
  switch (flow.phase) {
    case "idle":
    case "previewing":
      return (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {t("services.dialog.adopt.previewing")}
        </p>
      );
    case "previewed":
      return <PreviewBody preview={flow.preview} />;
    case "executing":
      return (
        <>
          <PreviewBody preview={flow.preview} />
          <p className="text-sm text-warning" role="status" aria-live="polite">
            {t("services.dialog.adopt.executingNote")}
          </p>
        </>
      );
    case "done": {
      const notice = describeAdoptSuccess(flow.execution, t);
      return <Notice tone="success" title={notice.title} detail={notice.detail} />;
    }
    case "failed": {
      const notice = describeAdoptFailure(flow.error, t);
      return <Notice tone="danger" title={notice.title} detail={notice.detail} />;
    }
  }
}

/** The whole dialog as a controlled view: the flow decides what is shown. */
export function AdoptServiceDialogView({
  flow,
  onClose,
  onConfirm,
  onRetry,
}: {
  flow: AdoptFlowState;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const t = useT();
  const busy = flow.phase === "previewing" || flow.phase === "executing";
  let footer: ReactNode;
  switch (flow.phase) {
    case "idle":
    case "previewing":
    case "executing":
      footer = (
        <Button data-modal-cancel disabled={busy} onClick={onClose} variant="secondary">
          {t("services.dialog.common.cancel")}
        </Button>
      );
      break;
    case "previewed":
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose} variant="secondary">
            {t("services.dialog.common.cancel")}
          </Button>
          <Button onClick={onConfirm} variant="primary">
            {t("services.dialog.adopt.confirm")}
          </Button>
        </>
      );
      break;
    case "done":
      footer = (
        <Button data-modal-cancel onClick={onClose} variant="primary">
          {t("services.dialog.common.done")}
        </Button>
      );
      break;
    case "failed":
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose} variant="secondary">
            {t("services.dialog.common.close")}
          </Button>
          <Button onClick={onRetry} variant="primary">
            {t("services.dialog.adopt.repreview")}
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
          {t("services.dialog.adopt.eyebrow")}
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          {t("services.dialog.adopt.title")}
        </h3>
      </div>
      {body(flow, t)}
    </Modal>
  );
}

/**
 * Adopts one current-user job: the preview is requested at once, the user
 * confirms it, and the result is shown with the backup and the read-back. A
 * late answer from a closed dialog is dropped; an adoption it made still
 * refreshes the list.
 */
export function AdoptServiceDialog({
  label,
  onAdopted,
  onClose,
}: {
  label: string;
  onAdopted: (execution: AdoptExecution) => void;
  onClose: () => void;
}) {
  const [flow, dispatch] = useReducer(adoptFlowReducer, INITIAL_ADOPT_FLOW);
  const [gate] = useState(createSequenceGate);

  const startPreview = useCallback(() => {
    const sequence = gate.next();
    dispatch({ type: "previewRequested" });
    void previewAdoptLaunchdService({ domain: "GUI", label })
      .then((preview) => {
        if (gate.isCurrent(sequence)) dispatch({ type: "previewLoaded", preview });
      })
      .catch((error: unknown) => {
        if (gate.isCurrent(sequence)) {
          dispatch({ type: "previewFailed", error: decodeAppError(error) });
        }
      });
  }, [gate, label]);

  useEffect(() => {
    startPreview();
    return () => gate.cancel();
  }, [gate, startPreview]);

  const confirm = () => {
    if (flow.phase !== "previewed") return;
    const operationId = flow.preview.operationId;
    const sequence = gate.next();
    dispatch({ type: "confirmRequested" });
    void executeAdoptLaunchdService(operationId)
      .then((execution) => {
        onAdopted(execution);
        if (gate.isCurrent(sequence)) dispatch({ type: "executed", execution });
      })
      .catch((error: unknown) => {
        if (gate.isCurrent(sequence)) {
          dispatch({ type: "executeFailed", error: decodeAppError(error) });
        }
      });
  };

  return (
    <AdoptServiceDialogView
      flow={flow}
      onClose={onClose}
      onConfirm={confirm}
      onRetry={startPreview}
    />
  );
}
