import type { ManagedAppSummary } from "../../ipc/catalog";
import type { ConfigSummary } from "../../ipc/config";
import {
  ACCESS_MODE_PRESENTATION,
  CONFIG_STATE_PRESENTATION,
  getConfigPresentation,
} from "./configPresentation";

export function ConfigDocumentList({
  application,
  configs,
  selectedConfigId,
  onSelect,
}: {
  application: ManagedAppSummary;
  configs: readonly ConfigSummary[];
  selectedConfigId?: string;
  onSelect: (config: ConfigSummary) => void;
}) {
  return (
    <section aria-labelledby="config-documents-heading">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id="config-documents-heading" className="text-sm font-semibold">
          配置文档
        </h3>
        <span className="text-xs text-muted-foreground">
          {configs.length} 项
        </span>
      </div>
      <ul className="grid gap-2">
        {configs.map((config) => {
          const presentation = getConfigPresentation(
            application,
            config.configId,
          );
          const isSelected = selectedConfigId === config.configId;
          return (
            <li key={config.configId}>
              <button
                className="flex w-full items-center justify-between gap-4 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(config)}
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">
                    {presentation?.purpose ?? config.configId}
                  </strong>
                  <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                    {config.displayPath}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="block">
                    {presentation
                      ? `${presentation.formatFamily} · ${
                          ACCESS_MODE_PRESENTATION[presentation.accessMode]
                            .label
                        }`
                      : "能力不可用"}
                  </span>
                  <span className="mt-0.5 block">
                    {CONFIG_STATE_PRESENTATION[config.state].label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
