import { createInternalError, invokeCommand, isRecord } from "./core";

export type HelperRegistrationState =
  | "ENABLED"
  | "REQUIRES_APPROVAL"
  | "NOT_REGISTERED"
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "UNSIGNED";

export interface HelperAvailability {
  supported: boolean;
  signed: boolean;
  state: HelperRegistrationState;
  available: boolean;
  reason: string;
}

function decodeHelperAvailability(value: unknown): HelperAvailability {
  if (
    !isRecord(value) ||
    typeof value.supported !== "boolean" ||
    typeof value.signed !== "boolean" ||
    typeof value.available !== "boolean" ||
    typeof value.reason !== "string" ||
    ![
      "ENABLED",
      "REQUIRES_APPROVAL",
      "NOT_REGISTERED",
      "NOT_FOUND",
      "UNSUPPORTED",
      "UNSIGNED",
    ].includes(String(value.state))
  ) {
    throw createInternalError();
  }
  return {
    supported: value.supported,
    signed: value.signed,
    state: value.state as HelperRegistrationState,
    available: value.available,
    reason: value.reason,
  };
}

export function getHelperStatus(): Promise<HelperAvailability> {
  return invokeCommand("get_helper_status", decodeHelperAvailability);
}

export function registerHelper(): Promise<HelperAvailability> {
  return invokeCommand("register_helper", decodeHelperAvailability, {
    input: { confirmed: true },
  });
}

export function unregisterHelper(): Promise<HelperAvailability> {
  return invokeCommand("unregister_helper", decodeHelperAvailability, {
    input: { confirmed: true },
  });
}
