import { useCallback, useEffect, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { Button, Modal } from "../../components/ui";
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
  return (
    <div className="grid gap-ui-16">
      <Section title="将接管的任务">
        <p className="text-sm">
          label：<Mono>{preview.label}</Mono>
        </p>
        <p className="text-xs text-muted-foreground">
          作用域：{domainLabel(preview.domain)}
        </p>
        <p className="text-xs text-muted-foreground">来源：{preview.source}</p>
        <p className="text-xs text-muted-foreground">
          plist：<Mono>{preview.filePath}</Mono>
        </p>
      </Section>

      <Section title="备份">
        <p className="text-sm text-muted-foreground">{preview.backup}</p>
      </Section>

      <Section title="接管的影响">
        <p className="text-sm font-medium">{preview.effectNote}</p>
        <p className="text-sm">拟变更字段：无。</p>
      </Section>

      <Section title="外部管理器">
        <p className="text-sm text-warning">{preview.externalManagerNote}</p>
      </Section>

      <p className="break-words text-xs text-muted-foreground">
        预览到期：
        <time dateTime={preview.expiresAt}>
          {new Date(preview.expiresAt).toLocaleString("zh-CN")}
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

function body(flow: AdoptFlowState): ReactNode {
  switch (flow.phase) {
    case "idle":
    case "previewing":
      return (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          正在生成接管预览…
        </p>
      );
    case "previewed":
      return <PreviewBody preview={flow.preview} />;
    case "executing":
      return (
        <>
          <PreviewBody preview={flow.preview} />
          <p className="text-sm text-warning" role="status" aria-live="polite">
            正在备份原始 plist 并写入接管记录，完成后显示结果。
          </p>
        </>
      );
    case "done": {
      const notice = describeAdoptSuccess(flow.execution);
      return <Notice tone="success" title={notice.title} detail={notice.detail} />;
    }
    case "failed": {
      const notice = describeAdoptFailure(flow.error);
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
  const busy = flow.phase === "previewing" || flow.phase === "executing";
  let footer: ReactNode;
  switch (flow.phase) {
    case "idle":
    case "previewing":
    case "executing":
      footer = (
        <Button data-modal-cancel disabled={busy} onClick={onClose}>
          取消
        </Button>
      );
      break;
    case "previewed":
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose}>
            取消
          </Button>
          <Button onClick={onConfirm} variant="primary">
            确认接管
          </Button>
        </>
      );
      break;
    case "done":
      footer = (
        <Button data-modal-cancel onClick={onClose} variant="primary">
          完成
        </Button>
      );
      break;
    case "failed":
      footer = (
        <>
          <Button data-modal-cancel onClick={onClose}>
            关闭
          </Button>
          <Button onClick={onRetry} variant="primary">
            重新预览
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
          接管现有任务
        </p>
        <h3 className="break-words [overflow-wrap:anywhere]" id={TITLE_ID}>
          接管当前用户的 launchd 任务
        </h3>
      </div>
      {body(flow)}
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
