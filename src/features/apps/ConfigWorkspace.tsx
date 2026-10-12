import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type {
  ManagedAppCapability,
  ManagedAppCoverageClass,
  ManagedAppSummary,
} from "../../ipc/catalog";
import {
  executeConfigWrite,
  executeRestoreBackup,
  getConfigSchema,
  listConfigBackups,
  listConfigs,
  previewConfigWrite,
  previewRestoreBackup,
  previewSchemaConfigWrite,
  previewStructuredConfigWrite,
  readConfig,
  resolveConfigVariants,
  type BackupSummary,
  type ConfigDiagnostic,
  type ConfigDocument,
  type ConfigSchemaPresentation,
  type SchemaFieldPatch,
  type ConfigSummary,
  type ConfigVariantResolution,
  type ConfigWritePreview as ConfigWritePreviewValue,
} from "../../ipc/config";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  getOperation,
  listOperations,
  type OperationDetails,
  type OperationSummary,
} from "../../ipc/operations";
import type { PreferredEditorMode } from "../../ipc/settings";
import { OperationHistory } from "../operations/OperationHistory";
import { ApplicationIcon } from "./ApplicationIcon";
import { ApplicationSupportSummary } from "./ApplicationSupportSummary";
import { BackupHistory } from "./BackupHistory";
import { ConfigDiagnosticDetails } from "./ConfigDiagnosticDetails";
import { ConfigDetails } from "./ConfigDetails";
import { ConfigWritePreview } from "./ConfigWritePreview";
import { ConfigAdapterEditor } from "./editors/ConfigAdapterEditor";
import { getConfigEditorCapability } from "./editors/configEditorCapabilities";
import { RawTextEditor } from "./editors/RawTextEditor";
import { SchemaEditor } from "./editors/SchemaEditor";
import {
  CONFIG_DOCUMENT_ACTION_PRESENTATION,
  createPreviewRequestGate,
  getConfigPresentation,
  resolveConfigDocumentActionMode,
} from "./configPresentation";

type ConfigListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; configs: ConfigSummary[] }
  | { status: "error"; error: AppError };

type DocumentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; document: ConfigDocument }
  | { status: "metadata"; document: ConfigDocument }
  | { status: "diagnostic"; diagnostic: ConfigDiagnostic }
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

type VariantState =
  | { status: "idle" }
  | { status: "loading"; configId: string }
  | {
      status: "ready";
      configId: string;
      variants: readonly ConfigVariantResolution[];
    }
  | { status: "error"; configId: string; error: AppError };

type SchemaState =
  | { status: "idle" }
  | { status: "loading"; configId: string }
  | {
      status: "ready";
      configId: string;
      presentation: ConfigSchemaPresentation;
    }
  | { status: "error"; configId: string; error: AppError };

function metadataDocumentState(summary: ConfigSummary): DocumentState {
  return summary.state === "READY" || summary.state === "REDACTED"
    ? {
        status: "metadata",
        document: {
          ...summary,
          contentRedacted: summary.state === "REDACTED",
        },
      }
    : { status: "diagnostic", diagnostic: summary };
}

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
  preferredEditorMode,
  refreshId,
  selectedConfigId,
}: {
  application: ManagedAppSummary;
  onOperationChanged?: () => void;
  onSelectedConfigChange: (
    applicationId: string,
    configId?: string,
  ) => void;
  preferredEditorMode: PreferredEditorMode;
  refreshId?: string;
  selectedConfigId?: string;
}) {
  const canRead =
    (application.coverageClass === "MANAGED_WRITABLE" ||
      application.coverageClass === "MANAGED_READ_ONLY") &&
    application.capabilities.includes("READ_CONFIG");
  const canWrite =
    application.coverageClass === "MANAGED_WRITABLE" &&
    application.capabilities.includes("WRITE_CONFIG");
  const coverage = COVERAGE_PRESENTATION[application.coverageClass];
  const [configs, setConfigs] = useState<ConfigListState>(() =>
    canRead ? { status: "loading" } : { status: "idle" },
  );
  const [document, setDocument] = useState<DocumentState>({ status: "idle" });
  const [variants, setVariants] = useState<VariantState>({ status: "idle" });
  const [schema, setSchema] = useState<SchemaState>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [executing, setExecuting] = useState(false);
  const [schemaEditorResetId, setSchemaEditorResetId] = useState(0);
  const [previewRequests] = useState(createPreviewRequestGate);
  const selectedConfigIdRef = useRef(selectedConfigId);
  const loadRequestId = useRef(0);
  const configButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    selectedConfigIdRef.current = selectedConfigId;
  }, [selectedConfigId]);

  const loadDocument = useCallback(
    async (
      summary: ConfigSummary,
      options: { resetPreview?: boolean; variantId?: string } = {},
    ) => {
      const requestId = ++loadRequestId.current;
      previewRequests.invalidate();
      const presentation = getConfigPresentation(
        application,
        summary.configId,
      );
      const mayWrite =
        canWrite && presentation?.accessMode === "READ_WRITE";
      selectedConfigIdRef.current = summary.configId;
      onSelectedConfigChange(application.id, summary.configId);
      setDocument({ status: "loading" });
      setVariants({ status: "loading", configId: summary.configId });
      setSchema({ status: "loading", configId: summary.configId });
      if (options.resetPreview !== false) {
        setPreview({ status: "idle" });
        setOperation(undefined);
        setActionError(undefined);
      }
      void resolveConfigVariants(summary.appId, summary.configId)
        .then((values) => {
          if (loadRequestId.current !== requestId) return;
          setVariants({
            status: "ready",
            configId: summary.configId,
            variants: values,
          });
          if (
            presentation?.accessMode === "METADATA_ONLY" ||
            presentation?.accessMode === "EXCLUDED"
          ) {
            const resolved =
              values.find(
                (variant) => variant.variantId === options.variantId,
              ) ?? values.find((variant) => variant.selected);
            if (resolved) {
              setDocument(metadataDocumentState(resolved));
            }
          }
        })
        .catch((error) => {
          if (loadRequestId.current !== requestId) return;
          setVariants({
            status: "error",
            configId: summary.configId,
            error: decodeAppError(error),
          });
        });
      if (
        presentation?.accessMode === "METADATA_ONLY" ||
        presentation?.accessMode === "EXCLUDED"
      ) {
        setBackups([]);
        setOperations([]);
        setDraft("");
        setSchema({ status: "idle" });
        setDocument(metadataDocumentState(summary));
        return;
      }
      try {
        const [value, backupValues, operationValues] = await Promise.all([
          readConfig(summary.appId, summary.configId, options.variantId),
          mayWrite
            ? listConfigBackups(summary.appId, summary.configId)
            : Promise.resolve([]),
          mayWrite ? listOperations() : Promise.resolve([]),
        ]);
        if (loadRequestId.current !== requestId) return;
        if (mayWrite) {
          void getConfigSchema(
            summary.appId,
            summary.configId,
            value.variantId,
          )
            .then((schemaValue) => {
              if (loadRequestId.current !== requestId) return;
              setSchema({
                status: "ready",
                configId: summary.configId,
                presentation: schemaValue,
              });
            })
            .catch((error) => {
              if (loadRequestId.current !== requestId) return;
              setSchema({
                status: "error",
                configId: summary.configId,
                error: decodeAppError(error),
              });
            });
        } else {
          setSchema({ status: "idle" });
        }
        setBackups(backupValues);
        setOperations(
          operationValues.filter((operation) =>
            operation.summary.includes("configuration"),
          ),
        );
        if (value.state !== "READY" && value.state !== "REDACTED") {
          setDocument({ status: "diagnostic", diagnostic: value });
          setDraft("");
          return;
        }
        setDocument({ status: "ready", document: value });
        setDraft(value.content ?? "");
      } catch (error) {
        if (loadRequestId.current === requestId) {
          setDocument({ status: "error", error: decodeAppError(error) });
        }
      }
    },
    [application, canWrite, onSelectedConfigChange, previewRequests],
  );

  useEffect(() => {
    let active = true;

    if (!canRead) {
      return () => {
        active = false;
        loadRequestId.current += 1;
        previewRequests.invalidate();
      };
    }

    void listConfigs(application.id)
      .then((values) => {
        if (!active) return;
        setConfigs({ status: "ready", configs: values });
        const selectedId = selectedConfigIdRef.current;
        const selectedConfig = values.find(
          (config) => config.configId === selectedId,
        );
        if (selectedId && !selectedConfig) {
          loadRequestId.current += 1;
          previewRequests.invalidate();
          selectedConfigIdRef.current = undefined;
          onSelectedConfigChange(application.id, undefined);
          setDocument({ status: "idle" });
          setVariants({ status: "idle" });
          setSchema({ status: "idle" });
          setPreview({ status: "idle" });
          setOperation(undefined);
          setActionError(undefined);
        } else if (selectedConfig) {
          void loadDocument(selectedConfig, { resetPreview: false });
        }
      })
      .catch((error: AppError) => {
        if (active) setConfigs({ status: "error", error });
      });

    return () => {
      active = false;
      loadRequestId.current += 1;
      previewRequests.invalidate();
    };
  }, [
    application.id,
    canRead,
    loadDocument,
    onSelectedConfigChange,
    previewRequests,
    refreshId,
  ]);

  async function createWritePreview(value: ConfigDocument) {
    if (!canWrite || !value.contentHash || value.writePolicy === "READ_ONLY") {
      return;
    }
    setOperation(undefined);
    setActionError(undefined);
    setPreview({ status: "loading" });
    const requestId = previewRequests.start();
    try {
      const result = await previewConfigWrite({
        appId: value.appId,
        configId: value.configId,
        expectedHash: value.contentHash,
        content: draft,
      });
      if (!previewRequests.isCurrent(requestId)) return;
      setPreview({ status: "ready", kind: "write", preview: result });
    } catch (error) {
      if (!previewRequests.isCurrent(requestId)) return;
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
    const requestId = previewRequests.start();
    try {
      const result = await previewStructuredConfigWrite({
        appId: value.appId,
        configId: value.configId,
        expectedHash: value.contentHash,
        fields,
      });
      if (!previewRequests.isCurrent(requestId)) return;
      setPreview({ status: "ready", kind: "write", preview: result });
    } catch (error) {
      if (!previewRequests.isCurrent(requestId)) return;
      setPreview({ status: "error", error: decodeAppError(error) });
    }
  }

  async function createSchemaWritePreview(
    presentation: ConfigSchemaPresentation & {
      state: "READY";
      schema: NonNullable<ConfigSchemaPresentation["schema"]>;
      expectedHash: string;
      variantId: string;
    },
    fields: SchemaFieldPatch[],
    completeTemplate?: { presetId: string; presetVersion: number },
  ) {
    if (!canWrite || !presentation.writable) return;
    setOperation(undefined);
    setActionError(undefined);
    setPreview({ status: "loading" });
    const requestId = previewRequests.start();
    try {
      const result = await previewSchemaConfigWrite({
        appId: presentation.appId,
        configId: presentation.configId,
        variantId: presentation.variantId,
        schemaId: presentation.schema.schemaId,
        schemaVersion: presentation.schema.schemaVersion,
        expectedHash: presentation.expectedHash,
        fields,
        ...(completeTemplate ? { completeTemplate } : {}),
      });
      if (!previewRequests.isCurrent(requestId)) return;
      setPreview({ status: "ready", kind: "write", preview: result });
    } catch (error) {
      if (!previewRequests.isCurrent(requestId)) return;
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
    const requestId = previewRequests.start();
    try {
      const result = await previewRestoreBackup({
        appId: document.document.appId,
        configId: document.document.configId,
        backupId,
        expectedHash: document.document.contentHash,
      });
      if (!previewRequests.isCurrent(requestId)) return;
      setPreview({ status: "ready", kind: "restore", preview: result });
    } catch (error) {
      if (!previewRequests.isCurrent(requestId)) return;
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
      setSchemaEditorResetId((value) => value + 1);
      setOperation(result);
      const selectedConfig =
        configs.status === "ready"
          ? configs.configs.find(
              (config) => config.configId === selectedConfigIdRef.current,
            )
          : undefined;
      if (selectedConfig) {
        await loadDocument(selectedConfig, {
          resetPreview: false,
          variantId:
            document.status === "ready"
              ? document.document.variantId
              : document.status === "diagnostic"
                ? document.diagnostic.variantId
                : undefined,
        });
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
    previewRequests.invalidate();
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

  const selectableConfigs =
    configs.status === "ready" ? configs.configs : [];
  const firstSelectableId = selectableConfigs[0]?.configId;
  const displayedDocument =
    document.status === "ready" || document.status === "metadata"
      ? document.document
      : undefined;
  const selectedPresentation = selectedConfigId
    ? getConfigPresentation(application, selectedConfigId)
    : undefined;
  const selectedVariants =
    variants.status === "ready" && variants.configId === selectedConfigId
      ? variants.variants
      : [];
  const selectedVariantIsWritable =
    displayedDocument !== undefined &&
    variants.status === "ready" &&
    variants.configId === selectedConfigId
      ? selectedVariants.some(
          (variant) =>
            variant.variantId === displayedDocument.variantId &&
            variant.selected,
        )
      : undefined;
  const editorCapability = selectedPresentation
    ? getConfigEditorCapability(selectedPresentation.editorKey)
    : undefined;
  const selectedFormatMatches =
    displayedDocument?.format === selectedPresentation?.format;
  const selectedSchema =
    schema.status === "ready" && schema.configId === selectedConfigId
      ? schema.presentation
      : undefined;
  const readySchema =
    selectedSchema?.state === "READY" &&
    selectedSchema.schema &&
    selectedSchema.expectedHash &&
    selectedSchema.variantId &&
    selectedSchema.documentState
      ? {
          ...selectedSchema,
          state: "READY" as const,
          schema: selectedSchema.schema,
          expectedHash: selectedSchema.expectedHash,
          variantId: selectedSchema.variantId,
          documentState: selectedSchema.documentState,
        }
      : undefined;
  const allowAdapterFallback =
    selectedSchema?.state === "UNAVAILABLE" &&
    selectedSchema.disabledReason?.code === "NO_SCHEMA";
  const documentActionMode =
    displayedDocument && selectedPresentation
      ? resolveConfigDocumentActionMode({
          accessMode: selectedPresentation.accessMode,
          applicationCanWrite: canWrite,
          contentHash: displayedDocument.contentHash,
          editorAvailable: Boolean(
            readySchema ||
              (allowAdapterFallback && editorCapability?.StructuredEditor) ||
              editorCapability?.raw,
          ),
          formatMatches: selectedFormatMatches,
          selectedVariant: selectedVariantIsWritable,
          writePolicy: displayedDocument.writePolicy,
        })
      : undefined;
  const canWriteDocument = documentActionMode === "WRITE";
  const canShowDocumentContent =
    selectedFormatMatches &&
    (selectedPresentation?.accessMode === "READ_WRITE" ||
      selectedPresentation?.accessMode === "READ_ONLY");
  const hasStructuredEditor = Boolean(
    readySchema ||
      (allowAdapterFallback && editorCapability?.StructuredEditor),
  );
  const hasRawEditor =
    Boolean(editorCapability?.raw) &&
    displayedDocument?.content !== undefined;
  const showRawEditor =
    hasRawEditor &&
    (preferredEditorMode === "RAW" || !hasStructuredEditor);
  const showStructuredEditor = hasStructuredEditor && !showRawEditor;
  const showSchemaEditor = Boolean(readySchema && showStructuredEditor);
  const showAdapterEditor = Boolean(
    allowAdapterFallback && !readySchema && showStructuredEditor,
  );

  function selectVariant(variantId: string) {
    if (configs.status !== "ready" || !selectedConfigId) return;
    if (
      selectedPresentation?.accessMode === "METADATA_ONLY" ||
      selectedPresentation?.accessMode === "EXCLUDED"
    ) {
      const variant = selectedVariants.find(
        (candidate) => candidate.variantId === variantId,
      );
      if (variant) {
        setDocument(metadataDocumentState(variant));
      }
      return;
    }
    const summary = configs.configs.find(
      (config) => config.configId === selectedConfigId,
    );
    if (summary) {
      void loadDocument(summary, { variantId });
    }
  }

  function retryDocument() {
    if (configs.status !== "ready" || !selectedConfigId) return;
    const summary = configs.configs.find(
      (config) => config.configId === selectedConfigId,
    );
    if (summary) {
      const variantId =
        document.status === "diagnostic"
          ? document.diagnostic.variantId
          : undefined;
      void loadDocument(summary, { variantId });
    }
  }

  return (
    <article className="config-workspace min-h-0 min-w-0 overflow-hidden">
      <header className="config-workspace__header min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted text-foreground">
            <ApplicationIcon className="size-7" iconKey={application.iconKey} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          className="config-workspace__documents min-h-0 min-w-0"
          aria-labelledby="config-documents-heading"
        >
          <div className="config-workspace__pane-heading">
            <h4 id="config-documents-heading">配置文档</h4>
            {configs.status === "ready" ? (
              <span>{configs.configs.length} 项</span>
            ) : null}
          </div>

          <section
            className="config-workspace__support min-h-0 min-w-0"
            aria-labelledby="config-support-heading"
          >
            <div className="config-workspace__support-heading flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h4
                className="text-xs font-semibold text-foreground"
                id="config-support-heading"
              >
                来源与证据
              </h4>
              <span className="text-[11px] text-muted-foreground">
                只读展示 · 不授予任何操作权限
              </span>
            </div>
            <div className="p-3">
              <ApplicationSupportSummary application={application} />
            </div>
          </section>

          <div className="config-workspace__documents-body min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [overscroll-behavior:contain] [scrollbar-gutter:stable]">
          {!canRead ? (
            <div className="p-4">
              <AsyncState
                kind={
                  application.coverageClass === "EXCLUDED"
                    ? "partial"
                    : "empty"
                }
              >
                {application.coverageClass === "EXCLUDED"
                  ? "此应用已被安全策略明确排除；不读取内容，也不提供任何配置操作。"
                  : "此应用仅提供检测与分类元数据；增加经过审核的 catalog 能力前不可读取或编辑。"}
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
            <ul
              className="m-0 list-none p-0"
              aria-label={`${application.displayName} 配置文档`}
            >
              {configs.configs.map((config) => {
                const presentation = getConfigPresentation(
                  application,
                  config.configId,
                );
                const isSelected = selectedConfigId === config.configId;
                const accessLabel =
                  presentation?.accessMode === "READ_WRITE" && canWrite
                    ? "授权文档"
                    : "只读";
                const isTabStop =
                  isSelected ||
                  (!selectedConfigId && config.configId === firstSelectableId);
                return (
                  <li key={config.configId}>
                    <Button
                      ref={(button) => {
                        if (button) {
                          configButtonRefs.current.set(config.configId, button);
                        } else {
                          configButtonRefs.current.delete(config.configId);
                        }
                      }}
                      variant="ghost"
                      className={classNames(
                        "config-workspace__document",
                        isSelected && "config-workspace__document--selected",
                      )}
                      aria-label={`${config.configId}，${config.displayPath}，${accessLabel}，${config.exists ? "已找到" : "未找到"}`}
                      aria-current={isSelected ? "true" : undefined}
                      tabIndex={isTabStop ? 0 : -1}
                      title={`${config.configId} · ${config.displayPath}`}
                      onClick={() => void loadDocument(config)}
                      onKeyDown={(event) =>
                        moveDocumentSelection(
                          event,
                          config.configId,
                          selectableConfigs,
                        )
                      }
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="break-all">
                          {config.configId}
                        </strong>
                        <span className="break-all">
                          {config.displayPath}
                        </span>
                      </span>
                      <StatusBadge
                        className="shrink-0"
                        tone={accessLabel === "授权文档" ? "success" : "neutral"}
                      >
                        {accessLabel}
                      </StatusBadge>
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          </div>
        </section>

        {canRead ? (
          <aside
            className="config-workspace__inspector min-h-0 min-w-0"
            aria-labelledby="config-inspector-heading"
          >
            <div className="config-workspace__pane-heading">
              <h4 id="config-inspector-heading">配置详情</h4>
              {selectedConfigId ? (
                <span className="break-all">{selectedConfigId}</span>
              ) : null}
            </div>
            <div className="config-workspace__inspector-content min-h-0 min-w-0 overflow-y-auto">
              {document.status === "idle" ? (
                <AsyncState kind="empty">
                  选择一个存在的配置文档以查看详情。
                </AsyncState>
              ) : document.status === "loading" ? (
                <AsyncState kind="loading">正在读取配置…</AsyncState>
              ) : document.status === "error" ? (
                <AsyncState kind="error">{document.error.message}</AsyncState>
              ) : document.status === "diagnostic" ? (
                selectedPresentation ? (
                  <div className="grid min-w-0 gap-3">
                    <ConfigDiagnosticDetails
                      diagnostic={document.diagnostic}
                      disabled={variants.status === "loading"}
                      presentation={selectedPresentation}
                      variants={selectedVariants}
                      onRetry={retryDocument}
                      onVariantChange={selectVariant}
                    />
                    {variants.status === "error" ? (
                      <AsyncState kind="error">
                        无法解析路径变体；没有回退到不受控路径。
                      </AsyncState>
                    ) : null}
                    {document.diagnostic.state === "MISSING" &&
                    readySchema &&
                    canWrite &&
                    selectedPresentation.accessMode === "READ_WRITE" ? (
                      <SchemaEditor
                        key={`${readySchema.appId}:${readySchema.configId}:${readySchema.variantId}:${readySchema.schema.schemaVersion}:${readySchema.expectedHash}:${readySchema.documentState}:${schemaEditorResetId}`}
                        disabled={
                          preview.status === "loading" || executing
                        }
                        presentation={readySchema}
                        onPreview={(fields, completeTemplate) =>
                          void createSchemaWritePreview(
                            readySchema,
                            fields,
                            completeTemplate,
                          )
                        }
                      />
                    ) : null}
                    {document.diagnostic.state === "MISSING" &&
                    selectedSchema?.state === "DISABLED" ? (
                      <AsyncState kind="error">
                        {selectedSchema.disabledReason?.message ??
                          "Schema 不可用；已禁用结构化新建。"}
                      </AsyncState>
                    ) : null}
                  </div>
                ) : (
                  <AsyncState kind="error">
                    catalog 中缺少此文档的展示能力；已禁用所有操作。
                  </AsyncState>
                )
              ) : (document.status === "ready" ||
                  document.status === "metadata") &&
                selectedPresentation ? (
                <div className="grid min-w-0 gap-3">
                  <ConfigDetails
                    document={document.document}
                    disabled={variants.status === "loading"}
                    contentUnavailableMessage={
                      selectedFormatMatches
                        ? undefined
                        : CONFIG_DOCUMENT_ACTION_PRESENTATION.FORMAT_MISMATCH
                            .description
                    }
                    presentation={selectedPresentation}
                    showContent={
                      document.status === "ready" && canShowDocumentContent
                    }
                    variants={selectedVariants}
                    onVariantChange={selectVariant}
                  />
                  {variants.status === "error" ? (
                    <AsyncState kind="error">
                      无法解析路径变体；为避免写入错误位置，所有修改操作已禁用。
                    </AsyncState>
                  ) : null}
                  {canWriteDocument ? (
                    <>
                      {showSchemaEditor && readySchema ? (
                        <SchemaEditor
                          key={`${readySchema.appId}:${readySchema.configId}:${readySchema.variantId}:${readySchema.schema.schemaVersion}:${readySchema.expectedHash}:${readySchema.documentState}:${schemaEditorResetId}`}
                          disabled={
                            preview.status === "loading" || executing
                          }
                          presentation={readySchema}
                          onPreview={(fields, completeTemplate) =>
                            void createSchemaWritePreview(
                              readySchema,
                              fields,
                              completeTemplate,
                            )
                          }
                        />
                      ) : null}
                      {showAdapterEditor ? (
                        <ConfigAdapterEditor
                          document={document.document}
                          editorKey={selectedPresentation.editorKey}
                          onPreview={(fields) =>
                            void createStructuredWritePreview(
                              document.document,
                              fields,
                            )
                          }
                        />
                      ) : null}
                      {selectedSchema?.state === "DISABLED" ? (
                        <AsyncState kind="error">
                          {selectedSchema.disabledReason?.message ??
                            "Schema 不可用；结构化编辑已禁用。"}
                        </AsyncState>
                      ) : schema.status === "error" ? (
                        <AsyncState kind="error">
                          Schema IPC 校验失败；未回退到专用结构化编辑器。
                        </AsyncState>
                      ) : schema.status === "loading" ? (
                        <AsyncState kind="loading">
                          正在验证配置 Schema…
                        </AsyncState>
                      ) : null}
                      {showRawEditor ? (
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
                    <AsyncState
                      kind={
                        documentActionMode
                          ? CONFIG_DOCUMENT_ACTION_PRESENTATION[
                              documentActionMode
                            ].kind
                          : "empty"
                      }
                    >
                      {documentActionMode
                        ? CONFIG_DOCUMENT_ACTION_PRESENTATION[
                            documentActionMode
                          ].description
                        : "当前文档不提供修改操作。"}
                    </AsyncState>
                  )}
                </div>
              ) : document.status === "ready" ||
                document.status === "metadata" ? (
                <AsyncState kind="error">
                  catalog 中缺少此文档的展示能力；内容与操作均已隐藏。
                </AsyncState>
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
          </aside>
        ) : null}
      </div>
    </article>
  );
}
