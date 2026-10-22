import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { useState, type ComponentType } from "react";
import { PageShell } from "../../components/ui";
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
  const activeIndex = Math.max(
    0,
    TOOL_ENTRIES.findIndex((tool) => tool.id === activeTool),
  );
  const active = TOOL_ENTRIES[activeIndex];

  return (
    <TabGroup
      as="div"
      className="h-full min-h-0 min-w-0"
      selectedIndex={activeIndex}
      onChange={(index) => setActiveTool(TOOL_ENTRIES[index].id)}
    >
      <PageShell layout="strip">
        <TabList aria-label="工具" className="flex flex-wrap items-end gap-ui-8">
          {TOOL_ENTRIES.map((tool) => (
            <Tab
              key={tool.id}
              className={({ selected }) =>
                selected
                  ? "bracket inline-flex h-control-md items-center px-ui-12 text-aux font-medium text-foreground"
                  : "bracket inline-flex h-control-md items-center px-ui-12 text-aux font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {tool.label}
            </Tab>
          ))}
        </TabList>
        <p className="m-0 text-xs text-muted-foreground">{active.summary}</p>
        <TabPanels as="div">
          {TOOL_ENTRIES.map((tool) => {
            const ToolPanel = TOOL_PANELS[tool.id];
            return (
              <TabPanel key={tool.id}>
                <ToolPanel />
              </TabPanel>
            );
          })}
        </TabPanels>
      </PageShell>
    </TabGroup>
  );
}
