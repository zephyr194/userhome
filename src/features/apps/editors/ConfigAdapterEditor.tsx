import type { ConfigDocument } from "../../../ipc/config";
import { CaddyEditor } from "./CaddyEditor";
import { CopilotEditor } from "./CopilotEditor";
import { GitEditor } from "./GitEditor";
import { NpmEditor } from "./NpmEditor";
import { SshEditor } from "./SshEditor";
import { ZshEditor } from "./ZshEditor";

export function ConfigAdapterEditor({
  document,
  onPreview,
}: {
  document: ConfigDocument;
  onPreview: (fields: Record<string, unknown>) => void;
}) {
  const props = { document, onPreview };
  switch (document.appId) {
    case "github-copilot":
      return <CopilotEditor {...props} />;
    case "caddy":
      return <CaddyEditor {...props} />;
    case "git":
      return <GitEditor {...props} />;
    case "openssh":
      return <SshEditor {...props} />;
    case "zsh":
      return <ZshEditor {...props} />;
    case "npm":
      return <NpmEditor {...props} />;
    default:
      return null;
  }
}
