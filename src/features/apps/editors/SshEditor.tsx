import { Button, TextField } from "../../../components/ui";
import type { ConfigEditorProps } from "./types";
import { optionalText } from "./types";

export function SshEditor({ document, onPreview }: ConfigEditorProps) {
  const fields = document.structured ?? {};
  return (
    <form className="config-editor structured-editor" aria-label="SSH 结构化配置" onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const port = optionalText(form, "port");
      onPreview({ host: String(form.get("host") ?? "").trim(), hostName: String(form.get("hostName") ?? "").trim(), user: optionalText(form, "user"), port: port === null ? null : Number(port) });
    }}>
      <h3>SSH 托管 Host</h3>
      <TextField label="Host" name="host" required defaultValue={String(fields.host ?? "")} />
      <TextField label="HostName" name="hostName" required defaultValue={String(fields.hostName ?? "")} />
      <TextField label="User" name="user" defaultValue={String(fields.user ?? "")} />
      <TextField label="Port" name="port" type="number" min="1" max="65535" defaultValue={String(fields.port ?? "")} />
      <p className="status-note">仅写入带 UserHome 标记的 Host；不会读取私钥。</p>
      <Button variant="primary" type="submit">预览结构化修改</Button>
    </form>
  );
}
