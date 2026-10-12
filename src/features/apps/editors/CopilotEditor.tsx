import { Button, CheckboxField, TextField } from "../../../components/ui";
import type { ConfigEditorProps } from "./types";

export function CopilotEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form className="config-editor structured-editor" aria-label="Copilot 结构化配置" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onPreview({
        model: String(form.get("model") ?? "").trim(),
        theme: String(form.get("theme") ?? "").trim(),
        banner: form.get("banner") === "on",
        reasoningEffort: String(form.get("reasoningEffort") ?? "").trim(),
      });
    }}>
      <h3>Copilot 安全设置</h3>
      <TextField label="模型" name="model" defaultValue={String(document.structured.model ?? "")} />
      <TextField label="主题" name="theme" defaultValue={String(document.structured.theme ?? "")} />
      <TextField label="推理强度" name="reasoningEffort" defaultValue={String(document.structured.reasoningEffort ?? "")} />
      <CheckboxField label="显示启动横幅" name="banner" defaultChecked={document.structured.banner === true} />
      <Button variant="primary" type="submit">预览结构化修改</Button>
    </form>
  );
}
