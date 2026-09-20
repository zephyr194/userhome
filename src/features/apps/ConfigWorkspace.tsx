import { useState } from "react";
import type { AppError } from "../../ipc/core";
import {
  executeConfigWrite,
  executeRestoreBackup,
  listConfigBackups,
  listConfigs,
  previewConfigWrite,
  previewStructuredConfigWrite,
  previewRestoreBackup,
  readConfig,
  type BackupSummary,
  type ConfigDocument,
  type ConfigSummary,
  type ConfigWritePreview as ConfigWritePreviewValue,
} from "../../ipc/config";
import { listOperations, type OperationSummary } from "../../ipc/operations";
import type { ManagedAppSummary } from "../../ipc/catalog";
import { BackupHistory } from "./BackupHistory";
import { ConfigDetails } from "./ConfigDetails";
import { ConfigWritePreview } from "./ConfigWritePreview";
import { OperationHistory } from "../operations/OperationHistory";
import { ConfigAdapterEditor } from "./editors/ConfigAdapterEditor";
import { RawConfigEditor } from "./editors/RawConfigEditor";

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

export function ConfigWorkspace({
  applications,
  onOperationChanged,
}: {
  applications: readonly ManagedAppSummary[];
  onOperationChanged?: () => void;
}) {
  const [appId, setAppId] = useState<string>();
  const [configs, setConfigs] = useState<ConfigListState>({ status: "idle" });
  const [document, setDocument] = useState<DocumentState>({ status: "idle" });
  const [draft, setDraft] = useState("");
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [operations, setOperations] = useState<OperationSummary[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  async function loadApplication(selectedAppId: string) {
    setAppId(selectedAppId);
    setConfigs({ status: "loading" });
    setDocument({ status: "idle" });
    setBackups([]);
    setPreview({ status: "idle" });
    try {
      const values = await listConfigs(selectedAppId);
      setConfigs({ status: "ready", configs: values });
    } catch (error) {
      setConfigs({ status: "error", error: error as AppError });
    }
  }

  async function loadDocument(summary: ConfigSummary) {
    setDocument({ status: "loading" });
    setPreview({ status: "idle" });
    try {
      const [value, backupValues, operationValues] = await Promise.all([
        readConfig(summary.appId, summary.configId),
        listConfigBackups(summary.appId, summary.configId),
        listOperations(),
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
      setDocument({ status: "error", error: error as AppError });
    }
  }

  async function createWritePreview(value: ConfigDocument) {
    if (!value.contentHash) return;
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
      setPreview({ status: "error", error: error as AppError });
    }
  }

  async function createStructuredWritePreview(
    value: ConfigDocument,
    fields: Record<string, unknown>,
  ) {
    if (!value.contentHash) return;
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
      setPreview({ status: "error", error: error as AppError });
    }
  }

  async function createRestorePreview(backupId: string) {
    if (document.status !== "ready" || !document.document.contentHash) return;
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
      setPreview({ status: "error", error: error as AppError });
    }
  }

  async function confirmPreview() {
    if (preview.status !== "ready") return;
    const operationId = preview.preview.operationId;
    try {
      if (preview.kind === "write") {
        await executeConfigWrite(operationId);
      } else {
        await executeRestoreBackup(operationId);
      }
      if (document.status === "ready") {
        await loadDocument(document.document);
      }
    } catch (error) {
      setPreview({ status: "error", error: error as AppError });
    } finally {
      onOperationChanged?.();
    }
  }

  return (
    <section className="config-workspace" aria-labelledby="config-workspace-heading">
      <p className="section-kicker">安全配置</p>
      <h2 id="config-workspace-heading">配置文档</h2>
      <p>仅可通过内置 catalog 的应用和配置标识符访问文件。</p>
      <div className="config-app-actions" aria-label="选择受管应用">
        {applications
          .filter((application) =>
            application.capabilities.includes("READ_CONFIG"),
          )
          .map((application) => (
            <button
              className="secondary-button"
              type="button"
              key={application.id}
              aria-pressed={appId === application.id}
              onClick={() => void loadApplication(application.id)}
            >
              {application.displayName}
            </button>
          ))}
      </div>

      {configs.status === "loading" && <p role="status">正在读取配置列表…</p>}
      {configs.status === "error" && <p role="alert">{configs.error.message}</p>}
      {configs.status === "ready" && (
        <ul className="config-list">
          {configs.configs.map((config) => (
            <li key={config.configId}>
              <div>
                <strong>{config.configId}</strong>
                <span>{config.displayPath}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={!config.exists}
                onClick={() => void loadDocument(config)}
              >
                {config.exists ? "查看" : "不存在"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {document.status === "loading" && <p role="status">正在读取配置…</p>}
      {document.status === "error" && <p role="alert">{document.error.message}</p>}
      {document.status === "ready" && (
        <div className="config-editor-stack">
          <ConfigDetails document={document.document} />
          {document.document.contentHash && (
            <ConfigAdapterEditor
              document={document.document}
              onPreview={(fields) =>
                void createStructuredWritePreview(document.document, fields)
              }
            />
          )}
          {document.document.content !== undefined &&
            document.document.contentHash && (
              <RawConfigEditor
                content={draft}
                redacted={document.document.contentRedacted}
                onChange={setDraft}
                onPreview={() => void createWritePreview(document.document)}
              />
            )}
          <BackupHistory backups={backups} onPreviewRestore={createRestorePreview} />
          <OperationHistory operations={operations} />
        </div>
      )}

      {preview.status === "loading" && <p role="status">正在生成安全预览…</p>}
      {preview.status === "error" && <p role="alert">{preview.error.message}</p>}
      {preview.status === "ready" && (
        <ConfigWritePreview
          preview={preview.preview}
          onConfirm={() => void confirmPreview()}
          onCancel={() => setPreview({ status: "idle" })}
        />
      )}
    </section>
  );
}
