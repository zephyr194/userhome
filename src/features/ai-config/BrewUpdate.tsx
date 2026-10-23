import { useId, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionRow, Button } from "../../components/ui";
import {
  aiConfigBrewUpgrade,
  type AiBrewUpgradeOutcome,
  type AiToolId,
} from "../../ipc/aiConfig";
import { dataHub } from "../../app/dataHub";
import { decodeAppError } from "../../ipc/core";
import { useT } from "../../i18n/useLocale";

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
  const t = useT();

  function run() {
    setState({ status: "running" });
    aiConfigBrewUpgrade(toolId).then(
      (outcome) => {
        setState({ status: "finished", outcome });
        if (outcome.status !== "FAILED") {
          dataHub.invalidate("aiTools");
          onRefreshed();
        }
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
        ? t("aiConfig.brew.updatedTo", {
            version: state.outcome.newVersion ?? t("aiConfig.brew.newVersion"),
          })
        : t("aiConfig.brew.upToDate")
      : null;

  return (
    <div className="grid min-w-0 justify-items-start gap-ui-4">
      {failure !== null ? (
        <>
          <p role="alert" className="m-0 whitespace-pre-line break-words text-aux text-danger">
            {failure}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setState({ status: "confirming" })}>
            {t("common.retry")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="primary"
          disabled={state.status === "running"}
          onClick={() => setState({ status: "confirming" })}
        >
          {state.status === "running" ? t("aiConfig.brew.updating") : t("aiConfig.brew.update")}
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
              {t("aiConfig.brew.confirmTitle", { name: displayName })}
            </h3>
            <p className="m-0 text-body">
              {t("aiConfig.brew.confirmBody", { package: packageName })}
            </p>
          </div>
          <ActionRow align="end">
            <Button variant="secondary" onClick={() => setState({ status: "idle" })}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={run}>
              {t("aiConfig.brew.startUpdate")}
            </Button>
          </ActionRow>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
