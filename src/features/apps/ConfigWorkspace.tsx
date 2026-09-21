import { useEffect, useRef, useState } from "react";
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
  resolveConfigVariants,
  type BackupSummary,
  type ConfigDiagnostic,
  type ConfigDocument,
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
import { OperationHistory } from "../operations/OperationHistory";
import { ApplicationIcon } from "./ApplicationIcon";
import { ApplicationSupportSummary } from "./ApplicationSupportSummary";
import { BackupHistory } from "./BackupHistory";
import { ConfigDiagnosticDetails } from "./ConfigDiagnosticDetails";
import { ConfigDetails } from "./ConfigDetails";
import { ConfigDocumentList } from "./ConfigDocumentList";
import { ConfigWritePreview } from "./ConfigWritePreview";
import { ConfigAdapterEditor } from "./editors/ConfigAdapterEditor";
import { getConfigEditorCapability } from "./editors/configEditorCapabilities";
import { RawTextEditor } from "./editors/RawTextEditor";
import {
  CONFIG_DOCUMENT_ACTION_PRESENTATION,
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
  const [selectedConfigId, setSelectedConfigId] = useState<string>();
  const [variants, setVariants] = useState<VariantState>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [executing, setExecuting] = useState(false);
  const loadRequestId = useRef(0);

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
        loadRequestId.current += 1;
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
      loadRequestId.current += 1;
    };
  }, [application.id, canRead]);

  async function loadDocument(
    summary: ConfigSummary,
    options: { resetPreview?: boolean; variantId?: string } = {},
  ) {
    const requestId = ++loadRequestId.current;
    const presentation = getConfigPresentation(application, summary.configId);
    const mayWrite =
      canWrite && presentation?.accessMode === "READ_WRITE";
    setSelectedConfigId(summary.configId);
    setDocument({ status: "loading" });
    setVariants({ status: "loading", configId: summary.configId });
    if (options.resetPreview !== false) {
      setPreview({ status: "idle" });
      setOperation(undefined);
      setActionError(undefined);
    }
    void resolveConfigVariants(summary.appId, summary.configId)
      .then((values) => {
        if (loadRequestId.current === requestId) {
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
        }
      })
      .catch((error) => {
        if (loadRequestId.current === requestId) {
          setVariants({
            status: "error",
            configId: summary.configId,
            error: decodeAppError(error),
          });
        }
      });
    if (
      presentation?.accessMode === "METADATA_ONLY" ||
      presentation?.accessMode === "EXCLUDED"
    ) {
      setBackups([]);
      setOperations([]);
      setDraft("");
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
        await loadDocument(document.document, {
          resetPreview: false,
          variantId: document.document.variantId,
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
    setPreview({ status: "idle" });
    setOperation(undefined);
    setActionError(undefined);
  }

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
  const documentActionMode =
    displayedDocument && selectedPresentation
      ? resolveConfigDocumentActionMode({
          accessMode: selectedPresentation.accessMode,
          applicationCanWrite: canWrite,
          contentHash: displayedDocument.contentHash,
          editorAvailable: Boolean(
            editorCapability?.StructuredEditor || editorCapability?.raw,
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

        <ApplicationSupportSummary application={application} />

        {!canRead ? (
          <AsyncState
            kind={
              application.coverageClass === "EXCLUDED" ? "partial" : "empty"
            }
          >
            {application.coverageClass === "EXCLUDED"
              ? "此应用已被安全策略明确排除；不读取内容，也不提供任何配置操作。"
              : "此应用仅提供检测与分类元数据；增加经过审核的 catalog 能力前不可读取或编辑。"}
          </AsyncState>
        ) : configs.status === "loading" ? (
          <AsyncState kind="loading">正在读取配置列表…</AsyncState>
        ) : configs.status === "error" ? (
          <AsyncState kind="error">{configs.error.message}</AsyncState>
        ) : configs.status === "ready" && configs.configs.length === 0 ? (
          <AsyncState kind="empty">此应用暂无可展示的配置文档。</AsyncState>
        ) : configs.status === "ready" ? (
          <ConfigDocumentList
            application={application}
            configs={configs.configs}
            selectedConfigId={selectedConfigId}
            onSelect={(config) => void loadDocument(config)}
          />
        ) : null}

        {document.status === "loading" ? (
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
                <ConfigAdapterEditor
                  document={document.document}
                  editorKey={selectedPresentation.editorKey}
                  onPreview={(fields) =>
                    void createStructuredWritePreview(document.document, fields)
                  }
                />
                {editorCapability?.raw &&
                document.document.content !== undefined ? (
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
              <AsyncState
                kind={
                  documentActionMode
                    ? CONFIG_DOCUMENT_ACTION_PRESENTATION[documentActionMode]
                        .kind
                    : "empty"
                }
              >
                {documentActionMode
                  ? CONFIG_DOCUMENT_ACTION_PRESENTATION[documentActionMode]
                      .description
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
    </article>
  );
}
