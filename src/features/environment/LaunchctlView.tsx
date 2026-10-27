import { useId, useState } from "react";
import { ActionRow, Button, InfoTip } from "../../components/ui";
import type { AppError } from "../../ipc/core";
import { localizeError } from "../../i18n/errors";
import { formatDateTime } from "../../i18n/format";
import { useLocale, useT } from "../../i18n/useLocale";
import type {
  LaunchctlChange,
  LaunchctlEntry,
  LaunchctlEnvironment,
  LaunchctlSetPreview,
} from "../../ipc/environment";
import {
  LaunchctlRemoveDialog,
  LaunchctlSetDialog,
  type LaunchctlSetInput,
} from "./LaunchctlDialogs";
import { VariableChainList } from "./VariableChainTable";
import { launchctlVariableRows } from "./variableChainModel";

export type LaunchctlState =
  | { status: "loading" }
  | { status: "ready"; environment: LaunchctlEnvironment }
  | { status: "failed"; error: AppError };

export interface LaunchctlViewProps {
  state: LaunchctlState;
  onReveal: (key: string) => Promise<string>;
  onRetry: () => void;
  onPreview: (key: string, value: string) => Promise<LaunchctlSetPreview>;
  onSet: (input: LaunchctlSetInput) => Promise<LaunchctlChange>;
  onUnset: (key: string, expectedCurrent: string | null) => Promise<LaunchctlChange>;
}

type LaunchctlDialog =
  | { kind: "set"; entry?: LaunchctlEntry }
  | { kind: "remove"; key: string };

/**
 * The login session variables. Names are visible and secret values stay masked
 * until asked for. Setting, modifying and removing go through a dialog; the
 * list is re-read from the change result, so the scroll position stays put.
 * The table comes first; status notes appear above it only when there is one.
 */
export function LaunchctlView({
  onPreview,
  onReveal,
  onRetry,
  onSet,
  onUnset,
  state,
}: LaunchctlViewProps) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const [dialog, setDialog] = useState<LaunchctlDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const loading = state.status === "loading";
  const environment = state.status === "ready" ? state.environment : undefined;

  function completeChange(change: LaunchctlChange, verb: string, key: string) {
    setDialog(null);
    setNotice(t("env.launchctl.changed", { verb, key, note: change.note }));
    setRevision((count) => count + 1);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="launchctl-view flex min-w-0 flex-col gap-ui-12"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-12 px-ui-12 pt-ui-12 pb-ui-4">
        <div className="flex min-w-0 flex-col gap-ui-4">
          <div className="flex min-w-0 items-center gap-ui-4">
            <h2 className="text-group font-semibold text-foreground" id={headingId}>
              {t("env.launchctl.heading")}
            </h2>
            <InfoTip
              description={t("env.launchctl.infoDescription")}
              title={t("env.launchctl.infoTitle")}
            />
          </div>
          {environment ? (
            <p className="text-aux text-muted-foreground">
              {t("env.launchctl.readAt", {
                time: formatReadAt(environment.readAt, locale),
              })}
            </p>
          ) : null}
        </div>
        <ActionRow>
          <Button disabled={loading} onClick={onRetry} variant="default">
            {t("env.launchctl.reload")}
          </Button>
          <Button
            disabled={loading}
            onClick={() => setDialog({ kind: "set" })}
            variant="primary"
          >
            {t("env.launchctl.setVariable")}
          </Button>
        </ActionRow>
      </header>

      {notice !== null ? (
        <p className="border border-line px-ui-12 py-ui-8 text-aux text-foreground" role="status">
          {notice}
        </p>
      ) : null}

      {state.status === "loading" ? (
        <div className="flex flex-col gap-ui-8 px-ui-12" role="status">
          <p className="text-aux text-muted-foreground">{t("env.launchctl.loading")}</p>
          {[0, 1, 2].map((row) => (
            <span
              aria-hidden="true"
              className="block h-control-md bg-surface-muted"
              key={row}
            />
          ))}
        </div>
      ) : null}

      {state.status === "failed" ? (
        <div className="flex flex-col items-start gap-ui-8 px-ui-12" role="alert">
          <p className="text-body text-foreground">{t("env.launchctl.failed")}</p>
          <p className="text-aux text-muted-foreground">
            {t("env.launchctl.reason", { message: localizeError(state.error, locale) })}
          </p>
          <Button onClick={onRetry} variant="danger">
            {t("env.launchctl.retry")}
          </Button>
        </div>
      ) : null}

      {environment?.partial ? (
        <p className="border border-line px-ui-12 py-ui-8 text-aux text-foreground" role="status">
          {t("env.launchctl.partial")}
        </p>
      ) : null}

      {environment && environment.entries.length === 0 ? (
        <div className="flex flex-col gap-ui-4 px-ui-12">
          <p className="text-body text-foreground">{t("env.launchctl.empty")}</p>
          <p className="text-aux text-muted-foreground">{t("env.launchctl.emptyNote")}</p>
        </div>
      ) : null}

      {environment && environment.entries.length > 0 ? (
        <div className="px-ui-12 pb-ui-12">
          <VariableChainList
            key={`${environment.readAt}:${revision}`}
            label={t("env.launchctl.table")}
            onEdit={(row) =>
              setDialog({
                kind: "set",
                entry: environment.entries.find((entry) => entry.key === row.name),
              })
            }
            onRemove={(row) => setDialog({ kind: "remove", key: row.name })}
            onRevealFinal={(row) => onReveal(row.name)}
            rows={launchctlVariableRows(environment.entries, t("env.launchctl.source"))}
            searchKey="launchctl"
          />
        </div>
      ) : null}

      {dialog?.kind === "set" ? (
        <LaunchctlSetDialog
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onDone={(change, key) =>
            completeChange(
              change,
              dialog.entry ? t("env.launchctl.verb.edited") : t("env.launchctl.verb.set"),
              key,
            )
          }
          onPreview={onPreview}
          onSet={onSet}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <LaunchctlRemoveDialog
          entryKey={dialog.key}
          onCancel={() => setDialog(null)}
          onDone={(change, key) => completeChange(change, t("env.launchctl.verb.removed"), key)}
          onPreview={(key) => onPreview(key, "")}
          onRemove={onUnset}
        />
      ) : null}
    </section>
  );
}

function formatReadAt(readAt: string, locale: "zh-CN" | "en"): string {
  const date = new Date(readAt);
  return Number.isNaN(date.getTime()) ? readAt : formatDateTime(date, locale);
}
