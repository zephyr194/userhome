import { Button, CheckboxField, TextField } from "../../../components/ui";
import type { ConfigEditorProps } from "./types";

export function GitEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form className="config-editor structured-editor" aria-label="Git 结构化配置" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onPreview({
        userName: String(form.get("userName") ?? "").trim(), userEmail: String(form.get("userEmail") ?? "").trim(),
        defaultBranch: String(form.get("defaultBranch") ?? "").trim(), aliasCheckout: String(form.get("aliasCheckout") ?? "").trim(),
        aliasBranch: String(form.get("aliasBranch") ?? "").trim(), pullRebase: form.get("pullRebase") === "on", fetchPrune: form.get("fetchPrune") === "on",
      });
    }}>
      <h3>Git 安全设置</h3>
      <TextField label="用户名" name="userName" defaultValue={String(document.structured.userName ?? "")} />
      <TextField label="邮箱" name="userEmail" type="email" defaultValue={String(document.structured.userEmail ?? "")} />
      <TextField label="默认分支" name="defaultBranch" defaultValue={String(document.structured.defaultBranch ?? "")} />
      <TextField label="checkout 别名" name="aliasCheckout" defaultValue={String(document.structured.aliasCheckout ?? "")} />
      <TextField label="branch 别名" name="aliasBranch" defaultValue={String(document.structured.aliasBranch ?? "")} />
      <CheckboxField label="默认 rebase" name="pullRebase" defaultChecked={document.structured.pullRebase === true} />
      <CheckboxField label="自动 prune" name="fetchPrune" defaultChecked={document.structured.fetchPrune === true} />
      <p className="status-note">credential 与 include 设置不会被结构化编辑修改。</p>
      <Button variant="primary" type="submit">预览结构化修改</Button>
    </form>
  );
}
