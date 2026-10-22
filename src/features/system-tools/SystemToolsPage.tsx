import { RouteIcon } from "../../components/RouteIcon";
import { Button } from "../../components/ui";
import { PageRegion, PageShell } from "../../components/ui/PageShell";
import { SYSTEM_TOOL_CARDS, type SystemToolRouteId } from "./toolCards";

interface SystemToolsPageProps {
  onOpen: (routeId: SystemToolRouteId) => void;
}

export function SystemToolsPage({ onOpen }: SystemToolsPageProps) {
  return (
    <PageShell layout="strip" scrollKey="system-tools">
      <PageRegion className="system-tools-grid">
        {SYSTEM_TOOL_CARDS.map((tool) => (
          <Button
            key={tool.routeId}
            className="system-tool-card"
            onClick={() => onOpen(tool.routeId)}
          >
            <span className="system-tool-card__icon">
              <RouteIcon icon={tool.icon} />
            </span>
            <span className="system-tool-card__name">{tool.name}</span>
            <span className="system-tool-card__desc">{tool.description}</span>
            <span className="system-tool-card__action">打开</span>
          </Button>
        ))}
      </PageRegion>
    </PageShell>
  );
}
