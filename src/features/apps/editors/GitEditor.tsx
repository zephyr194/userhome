import type { ConfigEditorProps } from "./types";

export function GitEditor({ document, onPreview }: ConfigEditorProps) {
  if (!document.structured) return null;
  return (
    <form
      className="config-editor structured-editor"
      aria-label="Git 结构化配置"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onPreview({
          userName: String(form.get("userName") ?? "").trim(),
          userEmail: String(form.get("userEmail") ?? "").trim(),
          defaultBranch: String(form.get("defaultBranch") ?? "").trim(),
          aliasCheckout: String(form.get("aliasCheckout") ?? "").trim(),
          aliasBranch: String(form.get("aliasBranch") ?? "").trim(),
          pullRebase: form.get("pullRebase") === "on",
          fetchPrune: form.get("fetchPrune") === "on",
        });
      }}
    >
      <h3>Git 安全设置</h3>
      <label>用户名<input name="userName" defaultValue={String(document.structured.userName ?? "")} /></label>
      <label>邮箱<input name="userEmail" type="email" defaultValue={String(document.structured.userEmail ?? "")} /></label>
      <label>默认分支<input name="defaultBranch" defaultValue={String(document.structured.defaultBranch ?? "")} /></label>
      <label>checkout 别名<input name="aliasCheckout" defaultValue={String(document.structured.aliasCheckout ?? "")} /></label>
      <label>branch 别名<input name="aliasBranch" defaultValue={String(document.structured.aliasBranch ?? "")} /></label>
      <label className="checkbox-field"><input name="pullRebase" type="checkbox" defaultChecked={document.structured.pullRebase === true} />默认 rebase</label>
      <label className="checkbox-field"><input name="fetchPrune" type="checkbox" defaultChecked={document.structured.fetchPrune === true} />自动 prune</label>
      <p className="status-note">credential 与 include 设置不会被结构化编辑修改。</p>
      <button className="primary-button" type="submit">预览结构化修改</button>
    </form>
  );
}
