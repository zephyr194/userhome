import { useEffect, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { decodeAppError } from "../../ipc/core";
import {
  listSupportedAppConfigEntries,
  type AppConfigListItem,
  type AppConfigSupportedEntry,
} from "../../ipc/appConfig";
import {
  describeToolDiscovery,
  toolDiscovery,
  toolsForSupported,
  type AppTool,
  type ToolDiscovery,
} from "./appConfigCatalog";
import { AppToolIcon } from "./AppToolIcon";
import type { ProbeTone } from "./appConfigModel";

const TITLE_ID = "app-config-supported-title";
const SCOPE = "这里列出 UserHome 支持查看的应用配置；本机没有的不会出现在左侧列表。";

const TONE_CLASS: Record<ProbeTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

type SupportedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: AppConfigSupportedEntry[] };

interface SupportedConfigsDialogProps {
  open: boolean;
  onClose: () => void;
  /** The local listing, when it is loaded. Without it, statuses read as unchecked. */
  items: readonly AppConfigListItem[] | undefined;
}

/** Read-only sheet of supported tools. It is not a picker: rows are plain list items. */
export function SupportedConfigsDialog({ open, onClose, items }: SupportedConfigsDialogProps) {
  return (
    <Modal
      bodyClassName="r8-appcfg-tools__body"
      className="r8-appcfg-tools"
      footer={
        <Button data-modal-cancel onClick={onClose} size="sm">
          关闭
        </Button>
      }
      onClose={onClose}
      open={open}
      title={<span id={TITLE_ID}>支持的配置</span>}
      titleId={TITLE_ID}
    >
      <div className="grid gap-ui-12">
        <p className="m-0 text-body">{SCOPE}</p>
        {open ? <SupportedToolsContent items={items} /> : null}
      </div>
    </Modal>
  );
}

// Mounted only while the sheet is open, so each open reads the supported list again.
function SupportedToolsContent({ items }: { items: readonly AppConfigListItem[] | undefined }) {
  const [state, setState] = useState<SupportedState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    listSupportedAppConfigEntries().then(
      (entries) => {
        if (current) setState({ status: "ready", entries });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", message: decodeAppError(error).message });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <p className="m-0 text-body text-muted-foreground" role="status">
        正在读取支持的配置……
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="grid gap-ui-8" role="alert">
        <p className="m-0 font-semibold text-danger">无法读取支持的配置列表</p>
        <p className="m-0">{state.message}</p>
        <div>
          <Button
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((count) => count + 1);
            }}
            size="sm"
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  const tools = toolsForSupported(state.entries);
  return (
    <ul className="m-0 grid list-none divide-y divide-line p-0">
      {tools.map((tool) => (
        <ToolRow key={tool.id} discovery={toolDiscovery(tool, items)} tool={tool} />
      ))}
    </ul>
  );
}

function ToolRow({ tool, discovery }: { tool: AppTool; discovery: ToolDiscovery }) {
  const badge = describeToolDiscovery(discovery);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-ui-12 py-ui-8">
      <span className="pt-ui-2 text-muted-foreground">
        <AppToolIcon icon={tool.icon} />
      </span>
      <span className="grid min-w-0 gap-ui-2">
        <span className="text-body font-semibold">{tool.name}</span>
        <span className="text-aux text-muted-foreground">{tool.summary}</span>
      </span>
      <span className={`pt-ui-2 text-aux ${TONE_CLASS[badge.tone]}`}>
        <span aria-hidden="true">{badge.symbol} </span>
        <span>{badge.label}</span>
      </span>
    </li>
  );
}
