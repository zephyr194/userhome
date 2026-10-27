import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, LogViewer } from "../../components/ui";
import { localizeError } from "../../i18n/errors";
import type { Locale, MessageKey, TranslateFunction } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import { isRecord } from "../../ipc/core";
import {
  LOG_STREAMS,
  authorizeLaunchdLog,
  confirmLaunchdLogExport,
  discardLaunchdLogExport,
  prepareLaunchdLogExport,
  readLaunchdLogSince,
  readLaunchdLogTail,
  revokeLaunchdLog,
  type LaunchdService,
  type LogExportPreview,
  type LogGrantSummary,
  type LogStream,
  type LogTarget,
} from "../../ipc/services";
import type { WriteOutcome } from "../../ipc/resources";
import {
  EMPTY_LOG_TAIL,
  LOG_MAX_LINES,
  LOG_POLL_INTERVAL_MS,
  advanceTail,
  clampPollInterval,
  displayLines,
  tailFromSnapshot,
  type LogTail,
} from "./logTailModel";

const STREAM_LABEL_KEYS: Record<LogStream, MessageKey> = {
  STDOUT: "services.logs.stream.STDOUT",
  STDERR: "services.logs.stream.STDERR",
};

type Status = "idle" | "authorizing" | "tracking" | "paused";

type ExportState =
  | { stage: "closed" }
  | { stage: "confirm" }
  | { stage: "preview"; preview: LogExportPreview };

function errorMessage(error: unknown, t: TranslateFunction, locale: Locale): string {
  if (!isRecord(error) || typeof error.message !== "string") {
    return t("services.logs.genericError");
  }
  return localizeError(
    {
      code: typeof error.code === "string" ? error.code : "",
      message: error.message,
    },
    locale,
  );
}

function isBusy(error: unknown): boolean {
  return isRecord(error) && error.code === "CONFLICT";
}

/** Streams the plist declares, from the same discovery the detail page shows. */
function declaredStreams(service: LaunchdService): LogStream[] {
  const details = service.configFiles[0]?.details;
  const streams: LogStream[] = [];
  if (details?.standardOutPath) streams.push("STDOUT");
  if (details?.standardErrorPath) streams.push("STDERR");
  return streams;
}

function declaredPath(service: LaunchdService, stream: LogStream): string {
  const details = service.configFiles[0]?.details;
  return (
    (stream === "STDOUT"
      ? details?.standardOutPath
      : details?.standardErrorPath) ?? ""
  );
}

export function ServiceLogs({ service }: { service: LaunchdService }) {
  const t = useT();
  const locale = useLocale();
  const declared = declaredStreams(service);
  const [stream, setStream] = useState<LogStream>(declared[0] ?? "STDOUT");
  const target = useMemo<LogTarget>(
    () => ({ domain: service.domain, label: service.label, stream }),
    [service.domain, service.label, stream],
  );
  const [status, setStatus] = useState<Status>("idle");
  const [grant, setGrant] = useState<LogGrantSummary | null>(null);
  const [tail, setTailState] = useState<LogTail>(EMPTY_LOG_TAIL);
  const [message, setMessage] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({
    stage: "closed",
  });
  const grantRef = useRef<string | null>(null);
  const tailRef = useRef<LogTail>(EMPTY_LOG_TAIL);
  /** Bumped whenever tracking stops, so results of older requests are dropped. */
  const sessionRef = useRef(0);
  const lines = useMemo(() => displayLines(tail), [tail]);

  const setTail = useCallback((next: LogTail) => {
    tailRef.current = next;
    setTailState(next);
  }, []);

  const releaseGrant = useCallback(() => {
    const grantId = grantRef.current;
    grantRef.current = null;
    setGrant(null);
    if (grantId === null) return;
    revokeLaunchdLog(grantId).catch(() => {
      setMessage(t("services.logs.revokeFailed"));
    });
  }, [setGrant, setMessage, t]);

  const stopTracking = useCallback(
    (nextMessage: string | null) => {
      sessionRef.current += 1;
      releaseGrant();
      setTail(EMPTY_LOG_TAIL);
      setStatus("idle");
      setExportState({ stage: "closed" });
      setMessage(nextMessage);
    },
    [releaseGrant, setTail, setExportState, setMessage, setStatus],
  );

  const pause = useCallback(() => {
    sessionRef.current += 1;
    releaseGrant();
    setExportState({ stage: "closed" });
    setStatus("paused");
    setMessage(t("services.logs.paused"));
  }, [releaseGrant, setExportState, setMessage, setStatus, t]);

  const begin = useCallback(
    async (resume: boolean) => {
      sessionRef.current += 1;
      const session = sessionRef.current;
      releaseGrant();
      setStatus("authorizing");
      setMessage(null);
      setExportState({ stage: "closed" });
      let summary: LogGrantSummary | null;
      try {
        summary = await authorizeLaunchdLog(target);
      } catch (error) {
        if (session !== sessionRef.current) return;
        setStatus(resume ? "paused" : "idle");
        setMessage(errorMessage(error, t, locale));
        return;
      }
      if (session !== sessionRef.current) {
        if (summary !== null) {
          revokeLaunchdLog(summary.grantId).catch(() => undefined);
        }
        return;
      }
      if (summary === null) {
        setStatus(resume ? "paused" : "idle");
        setMessage(
          resume
            ? t("services.logs.resumeNoFile")
            : t("services.logs.cancelledNoRead"),
        );
        return;
      }
      grantRef.current = summary.grantId;
      setGrant(summary);
      try {
        const cursor = resume ? tailRef.current.cursor : null;
        const snapshot = cursor
          ? await readLaunchdLogSince(target, summary.grantId, cursor)
          : await readLaunchdLogTail(target, summary.grantId);
        if (session !== sessionRef.current) return;
        setTail(
          cursor
            ? advanceTail(tailRef.current, snapshot, t)
            : tailFromSnapshot(snapshot, t),
        );
        setStatus("tracking");
      } catch (error) {
        if (session !== sessionRef.current) return;
        releaseGrant();
        setStatus("idle");
        setMessage(errorMessage(error, t, locale));
      }
    },
    [releaseGrant, setTail, target, setExportState, setMessage, setStatus, t, locale],
  );

  const activeGrant = grant?.grantId ?? null;
  useEffect(() => {
    if (status !== "tracking" || activeGrant === null) return undefined;
    const session = sessionRef.current;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      const cursor = tailRef.current.cursor;
      try {
        const snapshot =
          cursor === null
            ? await readLaunchdLogTail(target, activeGrant)
            : await readLaunchdLogSince(target, activeGrant, cursor);
        if (stopped || session !== sessionRef.current) return;
        setTail(
          cursor === null
            ? tailFromSnapshot(snapshot, t)
            : advanceTail(tailRef.current, snapshot, t),
        );
      } catch (error) {
        if (stopped || session !== sessionRef.current) return;
        if (!isBusy(error)) {
          stopTracking(errorMessage(error, t, locale));
          return;
        }
      }
      if (!stopped) {
        timer = window.setTimeout(
          poll,
          clampPollInterval(LOG_POLL_INTERVAL_MS),
        );
      }
    };
    timer = window.setTimeout(poll, clampPollInterval(LOG_POLL_INTERVAL_MS));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [status, activeGrant, target, setTail, stopTracking, t, locale]);

  useEffect(
    () => () => {
      sessionRef.current += 1;
      const grantId = grantRef.current;
      grantRef.current = null;
      if (grantId !== null) {
        revokeLaunchdLog(grantId).catch(() => undefined);
      }
    },
    [],
  );

  const selectStream = (next: LogStream) => {
    if (next === stream) return;
    stopTracking(null);
    setStream(next);
  };

  const handlePauseChange = (paused: boolean) => {
    if (paused) {
      pause();
    } else {
      void begin(true);
    }
  };

  const chooseSaveLocation = async () => {
    const grantId = grantRef.current;
    if (grantId === null) return;
    const session = sessionRef.current;
    try {
      const preview = await prepareLaunchdLogExport(target, grantId);
      if (session !== sessionRef.current) {
        if (preview !== null) {
          discardLaunchdLogExport(
            preview.operationId,
            preview.save.grantId,
          ).catch(() => undefined);
        }
        return;
      }
      if (preview === null) {
        setExportState({ stage: "closed" });
        setMessage(t("services.logs.exportCancelled"));
        return;
      }
      setExportState({ stage: "preview", preview });
    } catch (error) {
      if (session !== sessionRef.current) return;
      setExportState({ stage: "closed" });
      setMessage(errorMessage(error, t, locale));
    }
  };

  const confirmExport = async (preview: LogExportPreview) => {
    setExportState({ stage: "closed" });
    try {
      const outcome: WriteOutcome = await confirmLaunchdLogExport(
        preview.operationId,
        preview.save.grantId,
      );
      setMessage(
        outcome.status === "SUCCEEDED"
          ? t("services.logs.exported", { path: preview.save.displayPath })
          : t("services.logs.exportIncomplete", { summary: outcome.summary }),
      );
    } catch (error) {
      setMessage(errorMessage(error, t, locale));
    }
  };

  const discardExport = async (preview: LogExportPreview) => {
    setExportState({ stage: "closed" });
    try {
      await discardLaunchdLogExport(preview.operationId, preview.save.grantId);
      setMessage(t("services.logs.exportDiscarded"));
    } catch (error) {
      setMessage(errorMessage(error, t, locale));
    }
  };

  if (declared.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("services.logs.noneDeclared")}
      </p>
    );
  }

  const hasContent = lines.length > 0;
  const streamLabel = (option: LogStream) => t(STREAM_LABEL_KEYS[option]);

  return (
    <div className="grid min-w-0 gap-ui-8">
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("services.logs.intro")}
      </p>
      <div
        aria-label={t("services.logs.streams")}
        className="flex min-w-0 flex-wrap gap-ui-8"
        role="group"
      >
        {LOG_STREAMS.map((option) => {
          const available = declared.includes(option);
          return (
            <Button
              aria-pressed={stream === option}
              disabled={!available}
              key={option}
              onClick={() => selectStream(option)}
              size="sm"
              variant={stream === option ? "primary" : "default"}
            >
              {streamLabel(option)}
              {available ? "" : t("services.logs.undeclared")}
            </Button>
          );
        })}
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">
        {t("services.logs.outputPath", { path: declaredPath(service, stream) })}
      </p>

      {status === "idle" ? (
        <div>
          <Button onClick={() => void begin(false)} variant="primary">
            {t("services.logs.authorize")}
          </Button>
        </div>
      ) : null}

      {status === "authorizing" ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("services.logs.awaitingFile")}
        </p>
      ) : null}

      {status === "tracking" && grant !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
          <span className="break-all">
            {t("services.logs.authorized", { path: grant.displayPath })}
          </span>
          <Button onClick={() => stopTracking(null)} size="sm" variant="ghost">
            {t("services.logs.stop")}
          </Button>
          <Button onClick={() => void begin(false)} size="sm" variant="ghost">
            {t("services.logs.reselect")}
          </Button>
          <Button
            disabled={!hasContent}
            onClick={() => setExportState({ stage: "confirm" })}
            size="sm"
            variant="default"
          >
            {t("services.logs.export")}
          </Button>
        </div>
      ) : null}

      {status === "paused" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
          <Button onClick={() => stopTracking(null)} size="sm" variant="ghost">
            {t("services.logs.stop")}
          </Button>
        </div>
      ) : null}

      {tail.missing ? (
        <p className="text-sm text-warning" role="status">
          {t("services.logs.missingFile")}
        </p>
      ) : null}

      {tail.notices.length > 0 ? (
        <ul aria-label={t("services.logs.notices")} className="m-0 grid list-none gap-ui-4 p-0 text-xs text-warning">
          {tail.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}

      {exportState.stage === "confirm" ? (
        <section aria-label={t("services.logs.exportSection")} className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft px-ui-8 py-ui-8 text-xs text-warning">
          <p>{t("services.logs.exportWarning")}</p>
          <div className="flex flex-wrap gap-ui-8">
            <Button onClick={() => void chooseSaveLocation()} size="sm" variant="primary">
              {t("services.logs.chooseSave")}
            </Button>
            <Button
              onClick={() => setExportState({ stage: "closed" })}
              size="sm"
              variant="default"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </section>
      ) : null}

      {exportState.stage === "preview" ? (
        <section aria-label={t("services.logs.exportPreview")} className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft px-ui-8 py-ui-8 text-xs text-warning">
          <p>
            {t("services.logs.exportWillWrite", {
              path: exportState.preview.save.displayPath,
              mode: exportState.preview.replaces
                ? t("services.logs.replacesFile")
                : t("services.logs.newFile"),
            })}
          </p>
          <div className="flex flex-wrap gap-ui-8">
            <Button
              onClick={() => void confirmExport(exportState.preview)}
              size="sm"
              variant="danger"
            >
              {t("services.logs.confirmWrite")}
            </Button>
            <Button
              onClick={() => void discardExport(exportState.preview)}
              size="sm"
              variant="default"
            >
              {t("services.logs.discard")}
            </Button>
          </div>
        </section>
      ) : null}

      {message !== null ? (
        <p className="break-words text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}

      {status === "tracking" || status === "paused" ? (
        <LogViewer
          droppedCount={tail.droppedCount}
          emptyText={
            tail.missing
              ? t("services.logs.viewerMissing")
              : t("services.logs.viewerEmpty")
          }
          label={t("services.logs.viewerLabel", {
            label: service.label,
            stream: streamLabel(stream),
          })}
          lines={lines}
          maxLines={LOG_MAX_LINES}
          onPauseChange={handlePauseChange}
          paused={status === "paused"}
        />
      ) : null}
    </div>
  );
}
