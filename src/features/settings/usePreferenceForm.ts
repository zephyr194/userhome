import { useRef, useState } from "react";
import { decodeAppError } from "../../ipc/core";
import type {
  UpdatePreferencesRequest,
  UserPreferences,
} from "../../ipc/settings";

export function usePreferenceForm(
  preferences: UserPreferences,
  onChange: (patch: UpdatePreferencesRequest) => Promise<void>,
) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<UpdatePreferencesRequest>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const values: UserPreferences = { ...preferences, ...pending };

  async function update(
    label: string,
    patch: UpdatePreferencesRequest,
  ): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(patch);
    setStatus(undefined);
    setError(undefined);
    try {
      await onChange(patch);
      setStatus(`${label}已保存。`);
      return true;
    } catch (caught) {
      setError(decodeAppError(caught).message);
      return false;
    } finally {
      inFlight.current = false;
      setPending(undefined);
    }
  }

  return {
    error,
    saving: pending !== undefined,
    status,
    update,
    values,
  };
}
