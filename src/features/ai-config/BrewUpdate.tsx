import { useId, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionRow, Button } from "../../components/ui";
import {
  aiConfigBrewUpgrade,
  type AiBrewUpgradeOutcome,
  type AiToolId,
} from "../../ipc/aiConfig";
import { decodeAppError } from "../../ipc/core";

type UpdateState =
  | { readonly status: "idle" }
  | { readonly status: "confirming" }
  | { readonly status: "running" }
  | { readonly status: "finished"; readonly outcome: AiBrewUpgradeOutcome }
  | { readonly status: "errored"; readonly message: string };

export interface BrewUpdateProps {
  readonly toolId: AiToolId;
  readonly displayName: string;
  readonly packageName: string;
  /** Re-detects the tools after an update that ran to completion. */
  readonly onRefreshed: () => void;
}

export function BrewUpdate({ toolId, displayName, packageName, onRefreshed }: BrewUpdateProps) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const titleId = useId();

  function run() {
    setState({ status: "running" });
    aiConfigBrewUpgrade(toolId).then(
      (outcome) => {
        setState({ status: "finished", outcome });
        if (outcome.status !== "FAILED") onRefreshed();
      },
      (error: unknown) => setState({ status: "errored", message: decodeAppError(error).message }),
    );
  }

  const failure =
    state.status === "errored"
      ? state.message
      : state.status === "finished" && state.outcome.status === "FAILED"
        ? state.outcome.message
        : null;
  const result =
    state.status === "finished" && failure === null
      ? state.outcome.status === "UPGRADED"
        ? `已更新到 ${state.outcome.newVersion ?? "新版本"}`
        : "已是最新版本"
      : null;

  return (
    <div className="grid min-w-0 justify-items-start gap-ui-4">
      {failure !== null ? (
        <>
          <p role="alert" className="m-0 whitespace-pre-line break-words text-aux text-danger">
            {failure}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setState({ status: "confirming" })}>
            重试
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={state.status === "running"}
          onClick={() => setState({ status: "confirming" })}
        >
          {state.status === "running" ? "正在更新…" : "更新"}
        </Button>
      )}
      {result !== null ? (
        <p role="status" className="m-0 text-aux">
          {result}
        </p>
      ) : null}
      {state.status === "confirming" ? (
        <ConfirmDialog
          className="grid gap-ui-16"
          onCancel={() => setState({ status: "idle" })}
          titleId={titleId}
        >
          <div className="grid gap-ui-8">
            <h3 id={titleId} className="m-0 text-group font-semibold">
              更新 {displayName}？
            </h3>
            <p className="m-0 text-body">
              将运行 brew upgrade {packageName}，可能需要几分钟，期间请不要关闭应用。
            </p>
          </div>
          <ActionRow align="end">
            <Button variant="secondary" onClick={() => setState({ status: "idle" })}>
              取消
            </Button>
            <Button variant="primary" onClick={run}>
              开始更新
            </Button>
          </ActionRow>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
