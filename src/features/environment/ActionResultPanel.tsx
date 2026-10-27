import { ActionRow, Button } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { useT } from "../../i18n/useLocale";
import { canResumeEditing, saveResultText, type SaveResult } from "./dotenvEditorModel";

const WRAP = "break-words [overflow-wrap:anywhere]";

export function ActionResultPanel({
  scope,
  result,
  note,
  actions,
}: {
  scope: "zsh" | "dotenv";
  result: SaveResult;
  note?: string;
  actions: { close: () => void; resumeEditing: () => void };
}) {
  const t = useT();
  const text = saveResultText(result, t);
  const headingId = `${scope}-result-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={classNames(
        "grid gap-ui-8 rounded-control border px-ui-8 py-ui-8 text-sm",
        WRAP,
        text.tone === "success" && "border-transparent bg-success-soft text-success",
        text.tone === "danger" && "border-danger-border bg-danger-soft text-danger",
        text.tone === "warning" && "border-transparent bg-warning-soft text-warning",
      )}
      role={text.tone === "success" ? "status" : "alert"}
    >
      <h3 className="m-0 text-sm font-semibold" id={headingId}>
        {result.status === "SUCCEEDED"
          ? t(`env.editor.${scope}.result.heading`)
          : t(`env.editor.${scope}.result.unfinished`)}
      </h3>
      <p className="m-0">{text.headline}</p>
      {text.detail ? <p className="m-0 text-xs">{text.detail}</p> : null}
      {note ? <p className="m-0 text-xs">{note}</p> : null}
      {result.recoveryPoint === "BACKUP" && result.backupId ? (
        <p className="m-0 text-xs">
          {t(`env.editor.${scope}.result.backupId`, { id: result.backupId })}
        </p>
      ) : null}
      {result.errorMessage ? (
        <p className="m-0 text-xs">
          {t(`env.editor.${scope}.result.reason`, { message: result.errorMessage })}
        </p>
      ) : null}
      <ActionRow>
        <Button onClick={actions.close} variant={result.status === "SUCCEEDED" ? "primary" : "default"}>
          {t(`env.editor.${scope}.result.done`)}
        </Button>
        {result.status === "FAILED" && canResumeEditing(result) ? (
          <Button onClick={actions.resumeEditing} variant="primary">
            {t(`env.editor.${scope}.result.resume`)}
          </Button>
        ) : null}
      </ActionRow>
    </section>
  );
}
