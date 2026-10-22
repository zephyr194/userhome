import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, LogViewer } from "../../components/ui";
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

const STREAM_LABELS: Record<LogStream, string> = {
  STDOUT: "标准输出",
  STDERR: "标准错误",
};

type Status = "idle" | "authorizing" | "tracking" | "paused";

type ExportState =
  | { stage: "closed" }
  | { stage: "confirm" }
  | { stage: "preview"; preview: LogExportPreview };

function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "操作失败，请稍后重试。";
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
      setMessage("撤销读取授权失败：请在授权列表中手动撤销。");
    });
  }, [setGrant, setMessage]);

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
    setMessage("已暂停：读取授权已撤销，不再读取磁盘。继续时需要重新选择该文件。");
  }, [releaseGrant, setExportState, setMessage, setStatus]);

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
        setMessage(errorMessage(error));
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
          resume ? "未选择文件，仍处于暂停状态。" : "已取消，未读取日志。",
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
          cursor ? advanceTail(tailRef.current, snapshot) : tailFromSnapshot(snapshot),
        );
        setStatus("tracking");
      } catch (error) {
        if (session !== sessionRef.current) return;
        releaseGrant();
        setStatus("idle");
        setMessage(errorMessage(error));
      }
    },
    [releaseGrant, setTail, target, setExportState, setMessage, setStatus],
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
            ? tailFromSnapshot(snapshot)
            : advanceTail(tailRef.current, snapshot),
        );
      } catch (error) {
        if (stopped || session !== sessionRef.current) return;
        if (!isBusy(error)) {
          stopTracking(errorMessage(error));
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
  }, [status, activeGrant, target, setTail, stopTracking]);

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
        setMessage("已取消导出，未写入任何文件。");
        return;
      }
      setExportState({ stage: "preview", preview });
    } catch (error) {
      if (session !== sessionRef.current) return;
      setExportState({ stage: "closed" });
      setMessage(errorMessage(error));
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
          ? `已导出到 ${preview.save.displayPath}。`
          : `导出未完成：${outcome.summary}`,
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const discardExport = async (preview: LogExportPreview) => {
    setExportState({ stage: "closed" });
    try {
      await discardLaunchdLogExport(preview.operationId, preview.save.grantId);
      setMessage("已放弃导出，未写入任何文件。");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  if (declared.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        无可用文件日志：该任务的 plist 没有声明 StandardOutPath 或
        StandardErrorPath。
      </p>
    );
  }

  const hasContent = lines.length > 0;

  return (
    <div className="grid min-w-0 gap-ui-8">
      <p className="text-xs leading-relaxed text-muted-foreground">
        日志路径来自该任务的 plist 声明。读取前需要你在原生选择器中选中该文件；
        暂停、停止、重新选择或离开页面都会撤销读取授权。
      </p>
      <div
        aria-label="输出流"
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
              variant={stream === option ? "primary" : "secondary"}
            >
              {STREAM_LABELS[option]}
              {available ? "" : "（未声明）"}
            </Button>
          );
        })}
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">
        输出路径：{declaredPath(service, stream)}
      </p>

      {status === "idle" ? (
        <div>
          <Button onClick={() => void begin(false)} variant="primary">
            授权读取日志…
          </Button>
        </div>
      ) : null}

      {status === "authorizing" ? (
        <p className="text-sm text-muted-foreground" role="status">
          正在等待选择文件…
        </p>
      ) : null}

      {status === "tracking" && grant !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
          <span className="break-all">已授权读取：{grant.displayPath}</span>
          <Button onClick={() => stopTracking(null)} size="sm" variant="ghost">
            停止追踪
          </Button>
          <Button onClick={() => void begin(false)} size="sm" variant="ghost">
            重新选择
          </Button>
          <Button
            disabled={!hasContent}
            onClick={() => setExportState({ stage: "confirm" })}
            size="sm"
            variant="ghost"
          >
            导出日志…
          </Button>
        </div>
      ) : null}

      {status === "paused" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-ui-8 text-xs text-muted-foreground">
          <Button onClick={() => stopTracking(null)} size="sm" variant="ghost">
            停止追踪
          </Button>
        </div>
      ) : null}

      {tail.missing ? (
        <p className="text-sm text-warning" role="status">
          日志文件不存在（可能已删除或尚未生成），仍会继续等待它出现。
        </p>
      ) : null}

      {tail.notices.length > 0 ? (
        <ul aria-label="读取提示" className="m-0 grid list-none gap-ui-4 p-0 text-xs text-warning">
          {tail.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}

      {exportState.stage === "confirm" ? (
        <section aria-label="导出日志" className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft px-ui-8 py-ui-8 text-xs text-warning">
          <p>
            导出会把当前读取的日志尾部写入你选择的文件。日志可能包含令牌、密码等敏感信息，请确认保存位置与用途。
          </p>
          <div className="flex flex-wrap gap-ui-8">
            <Button onClick={() => void chooseSaveLocation()} size="sm" variant="primary">
              选择保存位置…
            </Button>
            <Button
              onClick={() => setExportState({ stage: "closed" })}
              size="sm"
              variant="ghost"
            >
              取消
            </Button>
          </div>
        </section>
      ) : null}

      {exportState.stage === "preview" ? (
        <section aria-label="导出预览" className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft px-ui-8 py-ui-8 text-xs text-warning">
          <p>
            将写入 {exportState.preview.save.displayPath}
            {exportState.preview.replaces
              ? "（该文件已存在，将先备份再覆盖）"
              : "（新文件）"}
            。日志可能包含敏感信息。
          </p>
          <div className="flex flex-wrap gap-ui-8">
            <Button
              onClick={() => void confirmExport(exportState.preview)}
              size="sm"
              variant="danger"
            >
              确认写入
            </Button>
            <Button
              onClick={() => void discardExport(exportState.preview)}
              size="sm"
              variant="ghost"
            >
              放弃
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
          emptyText={tail.missing ? "日志文件不存在" : "暂无日志内容"}
          label={`${service.label} ${STREAM_LABELS[stream]}`}
          lines={lines}
          maxLines={LOG_MAX_LINES}
          onPauseChange={handlePauseChange}
          paused={status === "paused"}
        />
      ) : null}
    </div>
  );
}
