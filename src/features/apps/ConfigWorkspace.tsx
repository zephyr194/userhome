import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
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

function documentTargetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  documentCount: number,
): number | undefined {
  if (event.key === "ArrowDown") {
    return Math.min(currentIndex + 1, documentCount - 1);
  }
  if (event.key === "ArrowUp") {
    return Math.max(currentIndex - 1, 0);
  }
  if (event.key === "Home") {
    return 0;
  }
  if (event.key === "End") {
    return documentCount - 1;
  }
  return undefined;
}

export function ConfigWorkspace({
  application,
  onOperationChanged,
  onSelectedConfigChange,
  refreshId,
  selectedConfigId,
}: {
  application: ManagedAppSummary;
  onOperationChanged?: () => void;
  onSelectedConfigChange: (
    applicationId: string,
    configId?: string,
  ) => void;
  refreshId?: string;
  selectedConfigId?: string;
}) {
  const canRead = application.capabilities.includes("READ_CONFIG");
  const canWrite =
    application.coverageClass === "MANAGED_WRITABLE" &&
    application.capabilities.includes("WRITE_CONFIG");
  const coverage = COVERAGE_PRESENTATION[application.coverageClass];
  const [configs, setConfigs] = useState<ConfigListState>(() =>
    canRead ? { status: "loading" } : { status: "idle" },
  );
  const [document, setDocument] = useState<DocumentState>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [executing, setExecuting] = useState(false);
  const selectedConfigIdRef = useRef<string | undefined>(undefined);
  const loadedConfigIdRef = useRef<string | undefined>(undefined);
  const documentRequestRef = useRef(0);
  const configButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    selectedConfigIdRef.current = selectedConfigId;
  }, [selectedConfigId]);

  const loadDocument = useCallback(
    async (summary: ConfigSummary, resetPreview = true) => {
      const requestId = documentRequestRef.current + 1;
      documentRequestRef.current = requestId;
      selectedConfigIdRef.current = summary.configId;
      loadedConfigIdRef.current = summary.configId;
      onSelectedConfigChange(application.id, summary.configId);
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
        if (documentRequestRef.current !== requestId) return;
        setDocument({ status: "ready", document: value });
        setDraft(value.content ?? "");
        setBackups(backupValues);
        setOperations(
          operationValues.filter((item) =>
            item.summary.includes("configuration"),
          ),
        );
      } catch (error) {
        if (documentRequestRef.current !== requestId) return;
        setDocument({ status: "error", error: decodeAppError(error) });
      }
    },
    [application.id, canWrite, onSelectedConfigChange],
  );

  useEffect(() => {
    let active = true;

    if (!canRead) {
      return () => {
        active = false;
      };
    }

    void listConfigs(application.id)
      .then((values) => {
        if (!active) return;
        setConfigs({ status: "ready", configs: values });
        const selectedId = selectedConfigIdRef.current;
        const selectedConfig = values.find(
          (config) => config.configId === selectedId && config.exists,
        );
        if (selectedId && !selectedConfig) {
          documentRequestRef.current += 1;
          selectedConfigIdRef.current = undefined;
          loadedConfigIdRef.current = undefined;
          onSelectedConfigChange(application.id, undefined);
          setDocument({ status: "idle" });
          setPreview({ status: "idle" });
          setOperation(undefined);
          setActionError(undefined);
        } else if (
          selectedConfig &&
          loadedConfigIdRef.current !== selectedConfig.configId
        ) {
          void loadDocument(selectedConfig, false);
        }
      })
      .catch((error: AppError) => {
        if (active) setConfigs({ status: "error", error });
      });

    return () => {
      active = false;
    };
  }, [
    application.id,
    canRead,
    loadDocument,
    onSelectedConfigChange,
    refreshId,
  ]);

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
      if (
        document.status === "ready" &&
        selectedConfigIdRef.current === document.document.configId
      ) {
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

  function moveDocumentSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentConfigId: string,
    selectableConfigs: ConfigSummary[],
  ) {
    const currentIndex = selectableConfigs.findIndex(
      (config) => config.configId === currentConfigId,
    );
    const nextIndex = documentTargetIndex(
      event,
      currentIndex,
      selectableConfigs.length,
    );
    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    if (nextIndex === currentIndex) {
      return;
    }
    const nextConfig = selectableConfigs[nextIndex];
    configButtonRefs.current.get(nextConfig.configId)?.focus();
    void loadDocument(nextConfig);
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
  const selectableConfigs =
    configs.status === "ready"
      ? configs.configs.filter((config) => config.exists)
      : [];
  const firstSelectableId = selectableConfigs[0]?.configId;

  return (
    <article className="config-workspace">
      <header className="config-workspace__header">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted text-foreground">
            <ApplicationIcon className="size-7" iconKey={application.iconKey} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {application.displayName}
              </h3>
              <StatusBadge tone={coverage.tone}>{coverage.label}</StatusBadge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {application.description}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <strong className="font-semibold text-foreground">
                覆盖与授权：
              </strong>
              {coverage.description}
            </p>
          </div>
        </div>
        <div className="config-workspace__metadata">
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
        <ul
          className="config-workspace__capabilities"
          aria-label={`${application.displayName} 能力`}
        >
          {application.capabilities.map((capability) => (
            <li key={capability}>
              <StatusBadge>{CAPABILITY_LABELS[capability]}</StatusBadge>
            </li>
          ))}
        </ul>
      </header>

      <div
        className={classNames(
          "config-workspace__body",
          canRead && "config-workspace__body--with-inspector",
        )}
      >
        <section
          className="config-workspace__documents"
          aria-labelledby="config-documents-heading"
        >
          <div className="config-workspace__pane-heading">
            <h4 id="config-documents-heading">配置文档</h4>
            {configs.status === "ready" ? (
              <span>{configs.configs.length} 项</span>
            ) : null}
          </div>

          {!canRead ? (
            <div className="p-4">
              <AsyncState kind="empty">
                此定义仅用于分类和检测；catalog 未授权读取配置内容。
              </AsyncState>
            </div>
          ) : configs.status === "idle" || configs.status === "loading" ? (
            <div className="p-4">
              <AsyncState kind="loading">正在读取配置列表…</AsyncState>
            </div>
          ) : configs.status === "error" ? (
            <div className="p-4">
              <AsyncState kind="error">{configs.error.message}</AsyncState>
            </div>
          ) : configs.status === "ready" && configs.configs.length === 0 ? (
            <div className="p-4">
              <AsyncState kind="empty">
                此应用暂无可展示的配置文档。
              </AsyncState>
            </div>
          ) : configs.status === "ready" ? (
            <ul role="listbox" aria-label={`${application.displayName} 配置文档`}>
              {configs.configs.map((config) => {
                const editorKey = configEditorKey(application, config.configId);
                const isSelected = selectedConfigId === config.configId;
                const isTabStop =
                  config.exists &&
                  (isSelected ||
                    (!selectedConfigId &&
                      config.configId === firstSelectableId));
                return (
                  <li key={config.configId} role="presentation">
                    <button
                      ref={(button) => {
                        if (button) {
                          configButtonRefs.current.set(config.configId, button);
                        } else {
                          configButtonRefs.current.delete(config.configId);
                        }
                      }}
                      className={classNames(
                        "config-workspace__document",
                        isSelected && "config-workspace__document--selected",
                      )}
                      type="button"
                      role="option"
                      disabled={!config.exists}
                      aria-selected={isSelected}
                      tabIndex={isTabStop ? 0 : -1}
                      onClick={() => void loadDocument(config)}
                      onKeyDown={(event) =>
                        moveDocumentSelection(
                          event,
                          config.configId,
                          selectableConfigs,
                        )
                      }
                    >
                      <span className="min-w-0">
                        <strong>{config.configId}</strong>
                        <span>{config.displayPath}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span>{editorKey ?? "通用元数据视图"}</span>
                        <span>{config.exists ? "打开" : "不存在"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        {canRead ? (
          <aside
            className="config-workspace__inspector"
            aria-labelledby="config-inspector-heading"
          >
            <div className="config-workspace__pane-heading">
              <h4 id="config-inspector-heading">配置详情</h4>
              {selectedConfigId ? <span>{selectedConfigId}</span> : null}
            </div>
            <div className="config-workspace__inspector-content">
              {document.status === "idle" ? (
                <AsyncState kind="empty">
                  选择一个存在的配置文档以查看详情。
                </AsyncState>
              ) : document.status === "loading" ? (
                <AsyncState kind="loading">正在读取配置…</AsyncState>
              ) : document.status === "error" ? (
                <AsyncState kind="error">{document.error.message}</AsyncState>
              ) : (
                <div className="grid min-w-0 gap-3">
                  <ConfigDetails document={document.document} />
                  {canWriteDocument ? (
                    <>
                      <ConfigAdapterEditor
                        document={document.document}
                        editorKey={selectedEditorKey}
                        onPreview={(fields) =>
                          void createStructuredWritePreview(
                            document.document,
                            fields,
                          )
                        }
                      />
                      {document.document.content !== undefined ? (
                        <RawTextEditor
                          content={draft}
                          redacted={document.document.contentRedacted}
                          disabled={preview.status === "loading" || executing}
                          onChange={setDraft}
                          onPreview={() =>
                            void createWritePreview(document.document)
                          }
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
              )}

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
          </aside>
        ) : null}
      </div>
    </article>
  );
}
