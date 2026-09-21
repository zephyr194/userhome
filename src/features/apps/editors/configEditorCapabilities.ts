import type { ComponentType } from "react";
import { CaddyEditor } from "./CaddyEditor";
import { CopilotEditor } from "./CopilotEditor";
import { GitEditor } from "./GitEditor";
import { NpmEditor } from "./NpmEditor";
import { SshEditor } from "./SshEditor";
import { ZshEditor } from "./ZshEditor";
import type { ConfigEditorProps } from "./types";

export interface ConfigEditorCapability {
  StructuredEditor?: ComponentType<ConfigEditorProps>;
  raw: boolean;
}

const EDITORS: Readonly<Record<string, ConfigEditorCapability | undefined>> = {
  caddyfile: { StructuredEditor: CaddyEditor, raw: true },
  "copilot-instructions": { raw: true },
  "copilot-json": { StructuredEditor: CopilotEditor, raw: true },
  "git-config": { StructuredEditor: GitEditor, raw: true },
  npmrc: { StructuredEditor: NpmEditor, raw: true },
  "read-only-text": { raw: false },
  "ssh-config": { StructuredEditor: SshEditor, raw: true },
  "zsh-managed-block": { StructuredEditor: ZshEditor, raw: true },
};

export function getConfigEditorCapability(
  editorKey: string,
): ConfigEditorCapability | undefined {
  return EDITORS[editorKey];
}
