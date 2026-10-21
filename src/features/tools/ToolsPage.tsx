import { useState, type ComponentType } from "react";
import { Button } from "../../components/ui";
import { CodecTool } from "./CodecTool";
import { JsonTool } from "./JsonTool";
import { QrTool } from "./QrTool";
import { XmlTool } from "./XmlTool";

/**
 * Tool registry. Adding a tool means one panel file, one entry here, and one
 * `TOOL_PANELS` key; the `Record` makes a missing panel a type error.
 */
const TOOL_ENTRIES = [
  {
    id: "json",
    label: "JSON",
    summary: "严格校验与格式化，保留数字与重复键原文。",
  },
  {
    id: "xml",
    label: "XML",
    summary: "良构校验与缩进；不解析 DTD、外部实体与 XInclude。",
  },
  {
    id: "codec",
    label: "编解码",
    summary: "Base64、URL、HTML 实体、Unicode 转义与 UTF-8 Hex 的单次双向转换。",
  },
  {
    id: "qr",
    label: "二维码",
    summary: "生成黑白二维码并导出 PNG；文本不访问链接，输入不保存。",
  },
] as const;

type ToolId = (typeof TOOL_ENTRIES)[number]["id"];

const TOOL_PANELS: Record<ToolId, ComponentType> = {
  json: JsonTool,
  xml: XmlTool,
  codec: CodecTool,
  qr: QrTool,
};

export function ToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolId>("json");
  const active =
    TOOL_ENTRIES.find((tool) => tool.id === activeTool) ?? TOOL_ENTRIES[0];
  const ActivePanel = TOOL_PANELS[active.id];

  return (
    <div className="grid gap-ui-xl">
      <div role="tablist" aria-label="工具" className="flex flex-wrap gap-ui-sm">
        {TOOL_ENTRIES.map((tool) => {
          const selected = tool.id === active.id;
          return (
            <Button
              key={tool.id}
              role="tab"
              aria-selected={selected}
              size="sm"
              variant={selected ? "primary" : "secondary"}
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.label}
            </Button>
          );
        })}
      </div>
      <p className="m-0 text-xs text-muted-foreground">{active.summary}</p>
      <div role="tabpanel" key={active.id}>
        <ActivePanel />
      </div>
    </div>
  );
}
