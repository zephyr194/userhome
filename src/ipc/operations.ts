import {
  createInternalError,
  decodeAppError,
  invokeCommand,
  isRecord,
  type AppError,
} from "./core";

export type OperationStatus =
  | "PREVIEWED"
  | "RUNNING"
  | "CANCELLING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface OperationPreview {
  operationId: string;
  summary: string;
  effects: string[];
  requiresElevation: boolean;
  expiresAt: string;
}

export type OperationEvent =
  | {
      type: "progress";
      operationId: string;
      sequence: number;
      message: string;
    }
  | {
      type: "finished";
      operationId: string;
      sequence: number;
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      stdoutSummary?: string;
      stderrSummary?: string;
      error?: AppError;
    };

export interface OperationDetails extends OperationPreview {
  status: OperationStatus;
  events: OperationEvent[];
}

export interface OperationSummary {
  operationId: string;
  summary: string;
  status: OperationStatus;
}

const OPERATION_STATUSES: readonly string[] = [
  "PREVIEWED",
  "RUNNING",
  "CANCELLING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

function isOperationStatus(value: unknown): value is OperationStatus {
  return typeof value === "string" && OPERATION_STATUSES.includes(value);
}

function isTerminalStatus(
  value: unknown,
): value is "SUCCEEDED" | "FAILED" | "CANCELLED" {
  return value === "SUCCEEDED" || value === "FAILED" || value === "CANCELLED";
}

function isSequence(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function decodeStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw createInternalError();
  }
  return value;
}

function decodeOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw createInternalError();
  }
  return value;
}

export function decodeOperationPreview(value: unknown): OperationPreview {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.requiresElevation !== "boolean" ||
    typeof value.expiresAt !== "string"
  ) {
    throw createInternalError();
  }

  return {
    operationId: value.operationId,
    summary: value.summary,
    effects: decodeStringArray(value.effects),
    requiresElevation: value.requiresElevation,
    expiresAt: value.expiresAt,
  };
}

export function decodeOperationEvent(value: unknown): OperationEvent {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    !isSequence(value.sequence)
  ) {
    throw createInternalError();
  }

  if (value.type === "progress" && typeof value.message === "string") {
    return {
      type: "progress",
      operationId: value.operationId,
      sequence: value.sequence,
      message: value.message,
    };
  }

  if (value.type === "finished" && isTerminalStatus(value.status)) {
    const stdoutSummary = decodeOptionalString(value.stdoutSummary);
    const stderrSummary = decodeOptionalString(value.stderrSummary);
    const error =
      value.error === undefined ? undefined : decodeAppError(value.error);

    return {
      type: "finished",
      operationId: value.operationId,
      sequence: value.sequence,
      status: value.status,
      ...(stdoutSummary === undefined ? {} : { stdoutSummary }),
      ...(stderrSummary === undefined ? {} : { stderrSummary }),
      ...(error === undefined ? {} : { error }),
    };
  }

  throw createInternalError();
}

export function decodeOperationDetails(value: unknown): OperationDetails {
  const preview = decodeOperationPreview(value);
  if (
    !isRecord(value) ||
    !isOperationStatus(value.status) ||
    !Array.isArray(value.events)
  ) {
    throw createInternalError();
  }

  return {
    ...preview,
    status: value.status,
    events: value.events.map(decodeOperationEvent),
  };
}

function decodeOperationSummary(value: unknown): OperationSummary {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    typeof value.summary !== "string" ||
    !isOperationStatus(value.status)
  ) {
    throw createInternalError();
  }

  return {
    operationId: value.operationId,
    summary: value.summary,
    status: value.status,
  };
}

export function listOperations(): Promise<OperationSummary[]> {
  return invokeCommand("list_operations", (value) => {
    if (!Array.isArray(value)) {
      throw createInternalError();
    }
    return value.map(decodeOperationSummary);
  });
}

export function getOperation(operationId: string): Promise<OperationDetails> {
  return invokeCommand("get_operation", decodeOperationDetails, { operationId });
}

export function cancelOperation(operationId: string): Promise<OperationDetails> {
  return invokeCommand("cancel_operation", decodeOperationDetails, {
    operationId,
  });
}
