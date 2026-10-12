import { Button, CheckboxField, TextField } from "../../../components/ui";
import { SecretField } from "./SecretField";
import type { ConfigEditorProps } from "./types";
import { optionalText } from "./types";

export function NpmEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form className="config-editor structured-editor" aria-label="npm 结构化配置" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const authToken = optionalText(form, "authToken");
      onPreview({ registry: String(form.get("registry") ?? "").trim(), proxy: String(form.get("proxy") ?? "").trim(), httpsProxy: String(form.get("httpsProxy") ?? "").trim(), strictSsl: form.get("strictSsl") === "on", ...(authToken === null ? {} : { authToken }) });
      event.currentTarget.reset();
    }}>
      <h3>npm 安全设置</h3>
      <TextField label="Registry" name="registry" defaultValue={String(document.structured.registry ?? "")} />
      <TextField label="Proxy" name="proxy" defaultValue={String(document.structured.proxy ?? "")} />
      <TextField label="HTTPS Proxy" name="httpsProxy" defaultValue={String(document.structured.httpsProxy ?? "")} />
      <CheckboxField label="启用 strict-ssl" name="strictSsl" defaultChecked={document.structured.strictSsl !== false} />
      <SecretField name="authToken" label="替换认证 Token" />
      <p className="status-note">{document.structured.hasAuthToken === true ? "已配置认证信息；原值不可读取。" : "尚未检测到认证信息。"}</p>
      <Button variant="primary" type="submit">预览结构化修改</Button>
    </form>
  );
}
