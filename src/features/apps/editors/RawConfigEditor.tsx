export function RawConfigEditor({
  content,
  redacted,
  onChange,
  onPreview,
}: {
  content: string;
  redacted: boolean;
  onChange: (content: string) => void;
  onPreview: () => void;
}) {
  return (
    <section className="config-editor" aria-labelledby="raw-config-editor-heading">
      <h3 id="raw-config-editor-heading">原始配置</h3>
      {redacted && (
        <p className="status-note">
          敏感值以 [REDACTED] 占位；保存时保留原值，替换秘密请使用结构化编辑器。
        </p>
      )}
      <textarea
        aria-label="配置内容"
        value={content}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button className="primary-button" type="button" onClick={onPreview}>
        校验并预览
      </button>
    </section>
  );
}
