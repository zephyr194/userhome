import { createInternalError, invokeCommand, isRecord } from "./core";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

export type ServiceScope = "USER" | "SYSTEM" | "UNKNOWN";
export type ServiceState = "STARTED" | "STOPPED" | "ERROR" | "UNKNOWN";
export type ConfigValidity = "VALID" | "INVALID" | "UNAVAILABLE";
export type ServiceAction = "START" | "STOP" | "RESTART";

export interface ServiceSummary {
  serviceId: string;
  displayName: string;
  state: ServiceState;
  status: string;
  scope: ServiceScope;
  user?: string;
  file?: string;
  pid?: number;
  exitCode?: number;
  manageable: boolean;
}

export interface ServiceDetails extends ServiceSummary {
  packageVersion?: string;
  configValidity: ConfigValidity;
  configIssue?: string;
}

export interface ServiceActionInput {
  action: ServiceAction;
  serviceId: string;
}

function decodeText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).length > 2 * 1024
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : decodeText(value);
}

function decodeOptionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw createInternalError();
  }
  return value;
}

export function decodeServiceSummary(value: unknown): ServiceSummary {
  if (
    !isRecord(value) ||
    !["STARTED", "STOPPED", "ERROR", "UNKNOWN"].includes(String(value.state)) ||
    !["USER", "SYSTEM", "UNKNOWN"].includes(String(value.scope)) ||
    typeof value.manageable !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    serviceId: decodeText(value.serviceId),
    displayName: decodeText(value.displayName),
    state: value.state as ServiceState,
    status: decodeText(value.status),
    scope: value.scope as ServiceScope,
    ...(decodeOptionalText(value.user) === undefined
      ? {}
      : { user: decodeOptionalText(value.user) }),
    ...(decodeOptionalText(value.file) === undefined
      ? {}
      : { file: decodeOptionalText(value.file) }),
    ...(decodeOptionalInteger(value.pid) === undefined
      ? {}
      : { pid: decodeOptionalInteger(value.pid) }),
    ...(decodeOptionalInteger(value.exitCode) === undefined
      ? {}
      : { exitCode: decodeOptionalInteger(value.exitCode) }),
    manageable: value.manageable,
  };
}

export function decodeServiceDetails(value: unknown): ServiceDetails {
  const summary = decodeServiceSummary(value);
  if (
    !isRecord(value) ||
    !["VALID", "INVALID", "UNAVAILABLE"].includes(
      String(value.configValidity),
    )
  ) {
    throw createInternalError();
  }
  return {
    ...summary,
    ...(decodeOptionalText(value.packageVersion) === undefined
      ? {}
      : { packageVersion: decodeOptionalText(value.packageVersion) }),
    configValidity: value.configValidity as ConfigValidity,
    ...(decodeOptionalText(value.configIssue) === undefined
      ? {}
      : { configIssue: decodeOptionalText(value.configIssue) }),
  };
}

export function listServices(): Promise<ServiceSummary[]> {
  return invokeCommand("list_services", (value) => {
    if (!Array.isArray(value) || value.length > 512) {
      throw createInternalError();
    }
    return value.map(decodeServiceSummary);
  });
}

export function getService(serviceId: string): Promise<ServiceDetails> {
  return invokeCommand("get_service", decodeServiceDetails, { serviceId });
}

export function previewServiceAction(
  input: ServiceActionInput,
): Promise<OperationPreview> {
  return invokeCommand("preview_service_action", decodeOperationPreview, {
    input,
  });
}

export function executeServiceAction(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_service_action", decodeOperationDetails, {
    operationId,
  });
}
