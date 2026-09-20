import type { ConfigDocument } from "../../../ipc/config";

export interface ConfigEditorProps {
  document: ConfigDocument;
  onPreview: (fields: Record<string, unknown>) => void;
}

export function optionalText(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}
