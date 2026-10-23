import { ActionRow, Button, Panel } from "../../components/ui";
import { localizeAppErrorMessage } from "../../i18n/errors";
import type { AppError } from "../../ipc/core";
import { useCaddyCopy } from "./caddyCopy";
import type { SaveGate } from "./caddyRulesModel";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "failed"; error: AppError };

interface CaddySaveBarProps {
  gate: SaveGate;
  saveState: SaveState;
  onSave: () => void;
}

const REASON_ID = "caddy-save-reason";

export function CaddySaveBar({ gate, saveState, onSave }: CaddySaveBarProps) {
  const { t } = useCaddyCopy();
  const saving = saveState.status === "saving";
  return (
    <Panel aria-labelledby="caddy-save-heading" className="grid gap-ui-8 p-ui-8">
      <h2 id="caddy-save-heading" className="text-sm font-semibold">
        {t("caddy.save.heading")}
      </h2>
      <ActionRow>
        <Button
          variant="primary"
          disabled={!gate.enabled || saving}
          aria-describedby={gate.reason ? REASON_ID : undefined}
          onClick={onSave}
        >
          {saving ? t("caddy.save.saving") : t("caddy.save.rules")}
        </Button>
        {gate.reason ? (
          <p id={REASON_ID} className="m-0 text-aux text-muted-foreground">
            {gate.reason}
          </p>
        ) : null}
      </ActionRow>
      <p className="m-0 text-aux text-muted-foreground">
        {t("caddy.save.note")}
      </p>
      <SaveResult state={saveState} />
    </Panel>
  );
}

function SaveResult({ state }: { state: SaveState }) {
  const { t, locale } = useCaddyCopy();
  if (state.status === "saved") {
    return (
      <p role="status" className="m-0 text-body text-success">
        {t("caddy.save.saved")}
      </p>
    );
  }
  if (state.status !== "failed") return null;
  const message = localizeAppErrorMessage(state.error, locale);
  if (state.error.code === "PARTIAL_FAILURE") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        <strong>{t("caddy.save.partialFailed")}</strong>
        {message}
      </p>
    );
  }
  return (
    <p role="alert" className="m-0 text-body text-danger">
      {t("caddy.save.failed", { message })}
    </p>
  );
}
