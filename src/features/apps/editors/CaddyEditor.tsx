import { Button, TextField } from "../../../components/ui";
import type { ConfigEditorProps } from "./types";
import { optionalText } from "./types";

export function CaddyEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form className="config-editor structured-editor" aria-label="Caddy 结构化配置" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onPreview({ siteAddress: optionalText(form, "siteAddress"), reverseProxy: optionalText(form, "reverseProxy") });
    }}>
      <h3>Caddy 常用字段</h3>
      <TextField label="站点地址" name="siteAddress" defaultValue={String(document.structured.siteAddress ?? "")} />
      <TextField label="反向代理上游" name="reverseProxy" defaultValue={String(document.structured.reverseProxy ?? "")} />
      <Button variant="primary" type="submit">预览结构化修改</Button>
    </form>
  );
}
