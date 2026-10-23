import type { MessageKey } from "../../i18n";
import { localizeError } from "../../i18n/errors";
import type { AppError } from "../../ipc/core";
import type {
  CaddyCheckStage,
  CaddyReferenceKind,
  CaddyValidationReport,
} from "../../ipc/caddy";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

export type ValidationState =
  | { status: "idle" }
  | {
      status: "running";
      runId: string;
      allowExternalReferences: boolean;
      checkedText: string;
    }
  | {
      status: "done";
      report: CaddyValidationReport;
      allowExternalReferences: boolean;
      checkedText: string;
    }
  | { status: "failed"; error: AppError; checkedText: string };

export type SummaryTone = "success" | "warning" | "danger" | "muted";

export interface ValidationSummary {
  tone: SummaryTone;
  title: string;
  details: string[];
  canAllowExternal: boolean;
}

const REFERENCE_LABEL_KEYS: Record<CaddyReferenceKind, MessageKey> = {
  IMPORT: "caddy.raw.reference.import",
  FILE_PLACEHOLDER: "caddy.raw.reference.file",
  ENV_PLACEHOLDER: "caddy.raw.reference.env",
  TLS_ARGUMENTS: "caddy.raw.reference.tls",
};

const STAGE_LABEL_KEYS: Record<CaddyCheckStage, MessageKey> = {
  ADAPT: "caddy.raw.stage.adapt",
  VALIDATE: "caddy.raw.stage.validate",
};

export const EXTERNAL_REFERENCE_NOTE = ZH_COPY.t("caddy.raw.externalNote");

export function referenceLabel(kind: CaddyReferenceKind, copy: CaddyCopy = ZH_COPY): string {
  return copy.t(REFERENCE_LABEL_KEYS[kind]);
}

export function stageLabel(stage: CaddyCheckStage, copy: CaddyCopy = ZH_COPY): string {
  return copy.t(STAGE_LABEL_KEYS[stage]);
}

export function summarizeReport(
  report: CaddyValidationReport,
  copy: CaddyCopy = ZH_COPY,
): ValidationSummary {
  const { t } = copy;
  const messages = report.diagnostics.map((item) =>
    item.line === undefined
      ? item.message
      : t("caddy.run.diagnosticLine", { line: item.line, message: item.message }),
  );
  switch (report.status) {
    case "VALID":
      return {
        tone: "success",
        title: t("caddy.raw.titleValid"),
        details: [t("caddy.raw.detailValid")],
        canAllowExternal: false,
      };
    case "INVALID":
      return {
        tone: "danger",
        title: report.stage
          ? t("caddy.raw.titleInvalidStage", { stage: stageLabel(report.stage, copy) })
          : t("caddy.raw.titleInvalid"),
        details: messages,
        canAllowExternal: false,
      };
    case "EXTERNAL_REFERENCES":
      return {
        tone: "warning",
        title: t("caddy.raw.titleExternal"),
        details: [
          ...report.externalReferences.map((reference) =>
            t("caddy.run.diagnosticLine", {
              line: reference.line,
              message: referenceLabel(reference.kind, copy),
            }),
          ),
          t("caddy.raw.externalNote"),
        ],
        canAllowExternal: true,
      };
    case "TIMEOUT":
      return {
        tone: "danger",
        title: t("caddy.raw.titleTimeout"),
        details: messages,
        canAllowExternal: false,
      };
    case "CANCELLED":
      return { tone: "muted", title: t("caddy.raw.titleCancelled"), details: [], canAllowExternal: false };
    case "OUTPUT_TOO_LARGE":
      return {
        tone: "danger",
        title: t("caddy.raw.titleOutputTooLarge"),
        details: messages,
        canAllowExternal: false,
      };
    case "UNAVAILABLE":
      return {
        tone: "danger",
        title: t("caddy.raw.titleUnavailable"),
        details: messages,
        canAllowExternal: false,
      };
  }
}

export function summarizeFailure(error: AppError, copy: CaddyCopy = ZH_COPY): ValidationSummary {
  return {
    tone: "danger",
    title: copy.t("caddy.raw.titleRequestFailed"),
    details: [localizeError(error, copy.locale)],
    canAllowExternal: false,
  };
}

/** A result only describes the text that was checked; any edit makes it stale. */
export function isResultStale(state: ValidationState, text: string): boolean {
  return (state.status === "done" || state.status === "failed") && state.checkedText !== text;
}

export function isRunning(state: ValidationState): boolean {
  return state.status === "running";
}
