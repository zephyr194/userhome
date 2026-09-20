import type { ConfigEditorProps } from "./types";

function rows(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === "object" && entry !== null && "name" in entry && "value" in entry
            ? `${String(entry.name)}=${String(entry.value)}`
            : "",
        )
        .filter(Boolean)
        .join("\n")
    : "";
}

function entries(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return {
        name: separator < 0 ? line : line.slice(0, separator).trim(),
        value: separator < 0 ? "" : line.slice(separator + 1),
      };
    });
}

export function ZshEditor({ document, onPreview }: ConfigEditorProps) {
  const fields = document.structured ?? {};
  return (
    <form
      className="config-editor structured-editor"
      aria-label="Zsh 结构化配置"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onPreview({
          aliases: entries(form.get("aliases")),
          environment: entries(form.get("environment")),
          sources: String(form.get("sources") ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
        });
      }}
    >
      <h3>Zsh UserHome 托管块</h3>
      <label>别名（每行 name=value）<textarea name="aliases" defaultValue={rows(fields.aliases)} /></label>
      <label>环境变量（每行 name=value）<textarea name="environment" defaultValue={rows(fields.environment)} /></label>
      <label>source 路径（每行一个）<textarea name="sources" defaultValue={Array.isArray(fields.sources) ? fields.sources.join("\n") : ""} /></label>
      <button className="primary-button" type="submit">预览结构化修改</button>
    </form>
  );
}
