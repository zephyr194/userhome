import { useState } from "react";
import {
  Button,
  CheckboxField,
  SecretReplacementField,
} from "../components/ui";

export function E2eFormProbe() {
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState("idle");

  if (dismissed) return null;

  return (
    <form
      className="fixed right-2 bottom-2 z-[100] grid w-64 gap-ui-8 rounded-panel bg-surface-raised p-ui-8 shadow-[var(--app-shadow-float)]"
      data-testid="e2e-form-probe"
      onReset={() => setResult("reset")}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setResult(
          JSON.stringify({
            enabled: data.get("enabled"),
            token: data.get("token"),
          }),
        );
      }}
    >
      <CheckboxField
        defaultChecked
        label="E2E enabled"
        name="enabled"
      />
      <SecretReplacementField label="E2E token" name="token" />
      <div className="flex gap-ui-8">
        <Button size="sm" type="submit" variant="primary">
          Probe submit
        </Button>
        <Button size="sm" type="reset" variant="secondary">
          Probe reset
        </Button>
        <Button size="sm" type="button" variant="secondary" onClick={() => setDismissed(true)}>
          Probe dismiss
        </Button>
      </div>
      <output data-testid="e2e-form-result">{result}</output>
    </form>
  );
}
