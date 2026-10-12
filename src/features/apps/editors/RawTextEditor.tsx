import { Button, Panel, TextAreaField } from "../../../components/ui";

export function RawTextEditor({ content, redacted, disabled = false, onChange, onPreview }: { content: string; redacted: boolean; disabled?: boolean; onChange: (content: string) => void; onPreview: () => void; }) {
  return (
    <Panel className="min-w-0 p-4" aria-labelledby="raw-text-editor-heading">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">原始编辑</p>
      <h3 className="mt-1 text-lg font-semibold" id="raw-text-editor-heading">原始配置</h3>
      <TextAreaField label="配置内容" description={redacted ? "敏感值以 [REDACTED] 占位；保存时保留原值，替换秘密请使用结构化编辑器。" : undefined} disabled={disabled} inputClassName="h-72 min-h-40 max-h-96 font-mono" spellCheck={false} value={content} onValueChange={onChange} />
      <div className="mt-3 flex justify-end"><Button disabled={disabled} variant="primary" onClick={onPreview}>校验并预览</Button></div>
    </Panel>
  );
}
