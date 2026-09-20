import type { ConfigEditorProps } from "./types";

export function CopilotEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form
      className="config-editor structured-editor"
      aria-label="Copilot 结构化配置"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onPreview({
          model: String(form.get("model") ?? "").trim(),
          theme: String(form.get("theme") ?? "").trim(),
          banner: form.get("banner") === "on",
          reasoningEffort: String(form.get("reasoningEffort") ?? "").trim(),
        });
      }}
    >
      <h3>Copilot 安全设置</h3>
      <label>
        模型
        <input name="model" defaultValue={String(document.structured.model ?? "")} />
      </label>
      <label>
        主题
        <input name="theme" defaultValue={String(document.structured.theme ?? "")} />
      </label>
      <label>
        推理强度
        <input
          name="reasoningEffort"
          defaultValue={String(document.structured.reasoningEffort ?? "")}
        />
      </label>
      <label className="checkbox-field">
        <input
          name="banner"
          type="checkbox"
          defaultChecked={document.structured.banner === true}
        />
        显示启动横幅
      </label>
      <button className="primary-button" type="submit">预览结构化修改</button>
    </form>
  );
}
