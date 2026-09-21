import { Button, Panel } from "../../../components/ui";

export function RawTextEditor({
  content,
  redacted,
  disabled = false,
  onChange,
  onPreview,
}: {
  content: string;
  redacted: boolean;
  disabled?: boolean;
  onChange: (content: string) => void;
  onPreview: () => void;
}) {
  return (
    <Panel className="min-w-0 p-4" aria-labelledby="raw-text-editor-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        原始编辑
      </p>
      <h3 className="mt-1 text-lg font-semibold" id="raw-text-editor-heading">
        原始配置
      </h3>
      {redacted && (
        <p
          className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
          id="raw-text-redaction-note"
        >
          敏感值以 [REDACTED] 占位；保存时保留原值，替换秘密请使用结构化编辑器。
        </p>
      )}
      <label
        className="mt-4 block text-xs font-medium text-muted-foreground"
        htmlFor="raw-config-content"
      >
        配置内容
      </label>
      <textarea
        aria-describedby={redacted ? "raw-text-redaction-note" : undefined}
        className="mt-1.5 block h-72 min-h-40 max-h-96 w-full resize-y rounded-md border border-border bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        disabled={disabled}
        id="raw-config-content"
        spellCheck={false}
        value={content}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="mt-3 flex justify-end">
        <Button
          disabled={disabled}
          variant="primary"
          onClick={onPreview}
        >
          校验并预览
        </Button>
      </div>
    </Panel>
  );
}
