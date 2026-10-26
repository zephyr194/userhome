import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { useState, type ComponentType } from "react";
import { PageShell } from "../../components/ui";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import { useT } from "../../i18n/useLocale";
import { CodecTool } from "./CodecTool";
import { JsonTool } from "./JsonTool";
import { QrTool } from "./QrTool";
import { XmlTool } from "./XmlTool";

/**
 * Tool registry. Adding a tool means one panel file, one entry here, and one
 * `TOOL_PANELS` key; the `Record` makes a missing panel a type error.
 */
const TOOL_ENTRIES = [
  { id: "json" },
  { id: "xml" },
  { id: "codec" },
  { id: "qr" },
] as const;

type ToolId = (typeof TOOL_ENTRIES)[number]["id"];

const TOOL_PANELS: Record<ToolId, ComponentType> = {
  json: JsonTool,
  xml: XmlTool,
  codec: CodecTool,
  qr: QrTool,
};

export function ToolsPage() {
  const t = useT();
  const [activeTool, setActiveTool] = useState<ToolId>("json");
  const toolLabels: Record<ToolId, string> = {
    json: "JSON",
    xml: "XML",
    codec: t("tools.tabs.codec"),
    qr: t("tools.tabs.qr"),
  };
  const activeIndex = Math.max(
    0,
    TOOL_ENTRIES.findIndex((tool) => tool.id === activeTool),
  );
  const tabsRef = useSlideIndicator(activeIndex, "x");

  return (
    <TabGroup
      as="div"
      className="h-full min-h-0 min-w-0"
      selectedIndex={activeIndex}
      onChange={(index) => setActiveTool(TOOL_ENTRIES[index].id)}
    >
      <PageShell layout="strip">
        <TabList
          ref={tabsRef}
          aria-label={t("tools.tabs.label")}
          className="slide-list flex flex-wrap items-end gap-ui-8"
          data-slide-axis="x"
        >
          {TOOL_ENTRIES.map((tool) => (
            <Tab
              key={tool.id}
              aria-current={tool.id === activeTool ? "true" : undefined}
              className={({ selected }) =>
                selected
                  ? "slide-item inline-flex h-control-md items-center px-ui-12 text-aux font-medium text-foreground"
                  : "slide-item inline-flex h-control-md items-center px-ui-12 text-aux font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {toolLabels[tool.id]}
            </Tab>
          ))}
        </TabList>
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
