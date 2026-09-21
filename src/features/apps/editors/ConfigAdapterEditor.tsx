import { Panel } from "../../../components/ui";
import type { ConfigDocument } from "../../../ipc/config";
import { getConfigEditorCapability } from "./configEditorCapabilities";

export function ConfigAdapterEditor({
  document,
  editorKey,
  onPreview,
}: {
  document: ConfigDocument;
  editorKey?: string;
  onPreview: (fields: Record<string, unknown>) => void;
}) {
  const capability = editorKey
    ? getConfigEditorCapability(editorKey)
    : undefined;
  if (!capability) {
    return (
      <Panel
        className="min-w-0 border-warning/30 bg-warning/10 p-4"
        aria-label="编辑器能力不可用"
      >
        <p className="text-sm font-semibold text-warning">编辑器能力不可用</p>
        <p className="mt-1 text-xs leading-relaxed text-warning">
          catalog 中的 editorKey 没有对应的安全编辑器；此文档保持不可操作。
        </p>
      </Panel>
    );
  }

  const Editor = capability.StructuredEditor;
  return Editor ? (
    <Panel
      className="min-w-0 p-4 [&_.config-editor]:min-h-0 [&_.config-editor]:p-0"
      aria-label="结构化配置编辑器"
    >
      <Editor document={document} onPreview={onPreview} />
    </Panel>
  ) : null;
}
