import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type {
  ManagedAppCapability,
  ManagedAppCoverageClass,
  ManagedAppSummary,
} from "../../ipc/catalog";
import {
  executeConfigWrite,
  executeRestoreBackup,
  listConfigBackups,
  listConfigs,
  previewConfigWrite,
  previewRestoreBackup,
  previewStructuredConfigWrite,
  readConfig,
  type BackupSummary,
  type ConfigDocument,
  type ConfigSummary,
  type ConfigWritePreview as ConfigWritePreviewValue,
} from "../../ipc/config";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  getOperation,
  listOperations,
  type OperationDetails,
  type OperationSummary,
} from "../../ipc/operations";
import { OperationHistory } from "../operations/OperationHistory";
import { ApplicationIcon } from "./ApplicationIcon";
import { BackupHistory } from "./BackupHistory";
import { ConfigDetails } from "./ConfigDetails";
import { ConfigWritePreview } from "./ConfigWritePreview";
import { ConfigAdapterEditor } from "./editors/ConfigAdapterEditor";
import { RawTextEditor } from "./editors/RawTextEditor";

type ConfigListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; configs: ConfigSummary[] }
  | { status: "error"; error: AppError };

type DocumentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; document: ConfigDocument }
  | { status: "error"; error: AppError };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      kind: "write" | "restore";
      preview: ConfigWritePreviewValue;
    }
  | { status: "error"; error: AppError };

const CAPABILITY_LABELS: Record<ManagedAppCapability, string> = {
  DETECT: "检测",
  READ_CONFIG: "读取配置",
  WRITE_CONFIG: "修改配置",
  MANAGE_SERVICE: "管理服务",
};

const COVERAGE_PRESENTATION: Record<
  ManagedAppCoverageClass,
  { label: string; description: string; tone: "neutral" | "success" | "warning" }
> = {
  MANAGED_WRITABLE: {
    label: "受管可写",
    description: "可读取配置，并仅通过 catalog 授权的预览与确认流程修改。",
    tone: "success",
  },
  MANAGED_READ_ONLY: {
    label: "受管只读",
    description: "可读取经过边界限制和敏感信息屏蔽的配置，不提供写入操作。",
    tone: "neutral",
  },
  DETECTED_UNSUPPORTED: {
    label: "已发现，暂不支持",
    description: "仅显示检测元数据，不读取配置内容，也不提供管理操作。",
    tone: "warning",
  },
  EXCLUDED: {
    label: "已排除",
    description: "此类数据被明确排除，仅保留分类元数据。",
    tone: "warning",
  },
};

function configEditorKey(
  application: ManagedAppSummary,
  configId: string,
): string | undefined {
  return application.presentation.configDocuments.find(
    (document) => document.configId === configId,
  )?.editorKey;
}

export function ConfigWorkspace({
  application,
  onOperationChanged,
}: {
  application: ManagedAppSummary;
  onOperationChanged?: () => void;
}) {
  const [configs, setConfigs] = useState<ConfigListState>(() =>
    application.capabilities.includes("READ_CONFIG")
      ? { status: "loading" }
      : { status: "idle" },
  );
  const [document, setDocument] = useState<DocumentState>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [executing, setExecuting] = useState(false);

  const canRead = application.capabilities.includes("READ_CONFIG");
  const canWrite =
    application.coverageClass === "MANAGED_WRITABLE" &&
    application.capabilities.includes("WRITE_CONFIG");
  const coverage = COVERAGE_PRESENTATION[application.coverageClass];

  useEffect(() => {
    let active = true;

    if (!canRead) {
      return () => {
        active = false;
      };
    }

    void listConfigs(application.id)
      .then((values) => {
        if (active) setConfigs({ status: "ready", configs: values });
      })
      .catch((error: AppError) => {
        if (active) setConfigs({ status: "error", error });
      });

    return () => {
      active = false;
    };
  }, [application.id, canRead]);

  async function loadDocument(summary: ConfigSummary, resetPreview = true) {
    setDocument({ status: "loading" });
    if (resetPreview) {
      setPreview({ status: "idle" });
      setOperation(undefined);
      setActionError(undefined);
    }
    try {
      const [value, backupValues, operationValues] = await Promise.all([
        readConfig(summary.appId, summary.configId),
        canWrite
          ? listConfigBackups(summary.appId, summary.configId)
          : Promise.resolve([]),
        canWrite ? listOperations() : Promise.resolve([]),
      ]);
      setDocument({ status: "ready", document: value });
      setDraft(value.content ?? "");
      setBackups(backupValues);
      setOperations(
        operationValues.filter((operation) =>
          operation.summary.includes("configuration"),
        ),
      );
    } catch (error) {
      setDocument({ status: "error", error: decodeAppError(error) });
    }
  }

  async function createWritePreview(value: ConfigDocument) {
    if (!canWrite || !value.contentHash || value.writePolicy === "READ_ONLY") {
      return;
    }
    setOperation(undefined);
    setActionError(undefined);
    setPreview({ status: "loading" });
    try {
      const result = await previewConfigWrite({
        appId: value.appId,
        configId: value.configId,
        expectedHash: value.contentHash,
        content: draft,
      });
      setPreview({ status: "ready", kind: "write", preview: result });
    } catch (error) {
      setPreview({ status: "error", error: decodeAppError(error) });
    }
  }

  async function createStructuredWritePreview(
    value: ConfigDocument,
    fields: Record<string, unknown>,
  ) {
    if (!canWrite || !value.contentHash || value.writePolicy === "READ_ONLY") {
      return;
    }
    setOperation(undefined);
    setActionError(undefined);
    setPreview({ status: "loading" });
    try {
      const result = await previewStructuredConfigWrite({
        appId: value.appId,
        configId: value.configId,
        expectedHash: value.contentHash,
        fields,
      });
      setPreview({ status: "ready", kind: "write", preview: result });
    } catch (error) {
      setPreview({ status: "error", error: decodeAppError(error) });
    }
  }

  async function createRestorePreview(backupId: string) {
    if (
      !canWrite ||
      document.status !== "ready" ||
      !document.document.contentHash ||
      document.document.writePolicy === "READ_ONLY"
    ) {
      return;
    }
    setOperation(undefined);
    setActionError(undefined);
    setPreview({ status: "loading" });
    try {
      const result = await previewRestoreBackup({
        appId: document.document.appId,
        configId: document.document.configId,
        backupId,
        expectedHash: document.document.contentHash,
      });
      setPreview({ status: "ready", kind: "restore", preview: result });
    } catch (error) {
      setPreview({ status: "error", error: decodeAppError(error) });
    }
  }

  async function confirmPreview() {
    if (!canWrite || preview.status !== "ready" || executing) return;
    const operationId = preview.preview.operationId;
    setExecuting(true);
    setActionError(undefined);
    try {
      const result =
        preview.kind === "write"
          ? await executeConfigWrite(operationId)
          : await executeRestoreBackup(operationId);
      setOperation(result);
      if (document.status === "ready") {
        await loadDocument(document.document, false);
      }
    } catch (error) {
      setActionError(decodeAppError(error));
      try {
        setOperation(await getOperation(operationId));
      } catch {
        setOperation(undefined);
      }
    } finally {
      onOperationChanged?.();
      setExecuting(false);
    }
  }

  function closePreview() {
    setPreview({ status: "idle" });
    setOperation(undefined);
    setActionError(undefined);
  }

  const selectedDocument =
    document.status === "ready" ? document.document : undefined;
  const selectedEditorKey = selectedDocument
    ? configEditorKey(application, selectedDocument.configId)
    : undefined;
  const canWriteDocument =
    canWrite &&
    selectedDocument?.writePolicy !== "READ_ONLY" &&
    Boolean(selectedDocument?.contentHash);

  return (
    <article className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-surface">
      <header className="border-b border-border bg-surface px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted text-foreground">
            <ApplicationIcon className="size-7" iconKey={application.iconKey} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {application.displayName}
              </h2>
              <StatusBadge tone={coverage.tone}>{coverage.label}</StatusBadge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {application.description}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{application.presentation.category}</span>
          <span aria-hidden="true">·</span>
          <span>{application.managedDocumentCount} 个配置定义</span>
          {application.serviceCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{application.serviceCount} 个用户级服务</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-5 [scrollbar-gutter:stable]">
        <section
          className="rounded-md border border-border bg-surface-muted px-4 py-3"
          aria-labelledby="coverage-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="coverage-heading" className="text-sm font-semibold">
                覆盖与授权
              </h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {coverage.description}
              </p>
            </div>
            <ul
              className="flex flex-wrap gap-1.5"
              aria-label={`${application.displayName} 能力`}
            >
              {application.capabilities.map((capability) => (
                <li key={capability}>
                  <StatusBadge>{CAPABILITY_LABELS[capability]}</StatusBadge>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {!canRead ? (
          <AsyncState kind="empty">
            此定义仅用于分类和检测；catalog 未授权读取配置内容。
          </AsyncState>
        ) : configs.status === "loading" ? (
          <AsyncState kind="loading">正在读取配置列表…</AsyncState>
        ) : configs.status === "error" ? (
          <AsyncState kind="error">{configs.error.message}</AsyncState>
        ) : configs.status === "ready" && configs.configs.length === 0 ? (
          <AsyncState kind="empty">此应用暂无可展示的配置文档。</AsyncState>
        ) : configs.status === "ready" ? (
          <section aria-labelledby="config-documents-heading">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="config-documents-heading" className="text-sm font-semibold">
                配置文档
              </h3>
              <span className="text-xs text-muted-foreground">
                {configs.configs.length} 项
              </span>
            </div>
            <ul className="grid gap-2">
              {configs.configs.map((config) => {
                const editorKey = configEditorKey(application, config.configId);
                const isSelected =
                  selectedDocument?.configId === config.configId;
                return (
                  <li key={config.configId}>
                    <button
                      className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors enabled:hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                      type="button"
                      disabled={!config.exists}
                      aria-pressed={isSelected}
                      onClick={() => void loadDocument(config)}
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">
                          {config.configId}
                        </strong>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {config.displayPath}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        <span className="block">
                          {editorKey ?? "通用元数据视图"}
                        </span>
                        <span className="mt-0.5 block">
                          {config.exists ? "打开" : "不存在"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {document.status === "loading" ? (
          <AsyncState kind="loading">正在读取配置…</AsyncState>
        ) : document.status === "error" ? (
          <AsyncState kind="error">{document.error.message}</AsyncState>
        ) : document.status === "ready" ? (
          <div className="grid min-w-0 gap-3">
            <ConfigDetails document={document.document} />
            {canWriteDocument ? (
              <>
                <ConfigAdapterEditor
                  document={document.document}
                  editorKey={selectedEditorKey}
                  onPreview={(fields) =>
                    void createStructuredWritePreview(document.document, fields)
                  }
                />
                {document.document.content !== undefined ? (
                  <RawTextEditor
                    content={draft}
                    redacted={document.document.contentRedacted}
                    disabled={preview.status === "loading" || executing}
                    onChange={setDraft}
                    onPreview={() => void createWritePreview(document.document)}
                  />
                ) : null}
                <BackupHistory
                  backups={backups}
                  disabled={preview.status === "loading" || executing}
                  onPreviewRestore={createRestorePreview}
                />
                <OperationHistory operations={operations} />
              </>
            ) : (
              <AsyncState kind="empty">
                此文档为只读视图；catalog 与文档策略均未授权写入。
              </AsyncState>
            )}
          </div>
        ) : null}

        {preview.status === "loading" ? (
          <AsyncState kind="loading">正在生成安全预览…</AsyncState>
        ) : preview.status === "error" ? (
          <AsyncState kind="error">{preview.error.message}</AsyncState>
        ) : preview.status === "ready" && canWrite ? (
          <ConfigWritePreview
            busy={executing}
            error={actionError}
            kind={preview.kind}
            operation={operation}
            preview={preview.preview}
            onConfirm={() => void confirmPreview()}
            onCancel={closePreview}
          />
        ) : null}
      </div>
    </article>
  );
}
