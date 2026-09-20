import type { ComponentType } from "react";
import { Panel } from "../../../components/ui";
import type { ConfigDocument } from "../../../ipc/config";
import { CaddyEditor } from "./CaddyEditor";
import { CopilotEditor } from "./CopilotEditor";
import { GitEditor } from "./GitEditor";
import { NpmEditor } from "./NpmEditor";
import { SshEditor } from "./SshEditor";
import { ZshEditor } from "./ZshEditor";
import type { ConfigEditorProps } from "./types";

const EDITORS: Readonly<
  Record<string, ComponentType<ConfigEditorProps> | undefined>
> = {
  caddyfile: CaddyEditor,
  "copilot-json": CopilotEditor,
  "git-config": GitEditor,
  npmrc: NpmEditor,
  "ssh-config": SshEditor,
  "zsh-managed-block": ZshEditor,
};

export function ConfigAdapterEditor({
  document,
  editorKey,
  onPreview,
}: {
  document: ConfigDocument;
  editorKey?: string;
  onPreview: (fields: Record<string, unknown>) => void;
}) {
  const Editor = editorKey ? EDITORS[editorKey] : undefined;
  return Editor ? (
    <Panel
      className="min-w-0 p-4 [&_.config-editor]:min-h-0 [&_.config-editor]:p-0"
      aria-label="结构化配置编辑器"
    >
      <Editor document={document} onPreview={onPreview} />
    </Panel>
  ) : null;
}
