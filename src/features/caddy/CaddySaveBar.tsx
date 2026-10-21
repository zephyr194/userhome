import { Button, Panel } from "../../components/ui";
import type { AppError } from "../../ipc/core";
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
  const saving = saveState.status === "saving";
  return (
    <Panel aria-labelledby="caddy-save-heading" className="grid gap-ui-sm p-ui-lg">
      <h2 id="caddy-save-heading" className="text-sm font-semibold">
        保存
      </h2>
      <div className="flex flex-wrap items-center gap-ui-md">
        <Button
          variant="primary"
          disabled={!gate.enabled || saving}
          aria-describedby={gate.reason ? REASON_ID : undefined}
          onClick={onSave}
        >
          {saving ? "保存中……" : "保存规则"}
        </Button>
        {gate.reason ? (
          <p id={REASON_ID} className="m-0 text-aux text-muted-foreground">
            {gate.reason}
          </p>
        ) : null}
      </div>
      <p className="m-0 text-aux text-muted-foreground">
        保存不会启动或重载 Caddy。保存只写入 UserHome 的私有目录，不改动 Homebrew 的全局配置。
      </p>
      <SaveResult state={saveState} />
    </Panel>
  );
}

function SaveResult({ state }: { state: SaveState }) {
  if (state.status === "saved") {
    return (
      <p role="status" className="m-0 text-body text-success">
        已保存。
      </p>
    );
  }
  if (state.status !== "failed") return null;
  if (state.error.code === "PARTIAL_FAILURE") {
    return (
      <p role="alert" className="m-0 text-body text-danger">
        <strong>部分保存失败：</strong>
        {state.error.message}
      </p>
    );
  }
  return (
    <p role="alert" className="m-0 text-body text-danger">
      保存失败：{state.error.message}
    </p>
  );
}
