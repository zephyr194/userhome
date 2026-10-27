import { RouteIcon } from "../../components/RouteIcon";
import { Button } from "../../components/ui";
import { PageRegion, PageShell } from "../../components/ui/PageShell";
import { useT } from "../../i18n/useLocale";
import { SYSTEM_TOOL_CARDS, type SystemToolRouteId } from "./toolCards";

interface SystemToolsPageProps {
  onOpen: (routeId: SystemToolRouteId) => void;
}

export function SystemToolsPage({ onOpen }: SystemToolsPageProps) {
  const t = useT();
  return (
    <PageShell layout="strip" scrollKey="system-tools">
      <PageRegion className="system-tools-grid">
        {SYSTEM_TOOL_CARDS.map((tool) => (
          <Button
            key={tool.routeId}
            className="system-tool-card"
            variant="default"
            onClick={() => onOpen(tool.routeId)}
          >
            <span className="system-tool-card__icon">
              <RouteIcon icon={tool.icon} />
            </span>
            <span className="system-tool-card__name">{tool.name}</span>
            <span className="system-tool-card__desc">{t(tool.descriptionKey)}</span>
            <span className="system-tool-card__action">{t("systemTools.open")}</span>
          </Button>
        ))}
      </PageRegion>
    </PageShell>
  );
}
