import type { ReactNode } from "react";
import { AsyncState } from "../../components/AsyncState";
import {
  Button,
  Panel,
  PageShell,
  SelectField,
  TextField,
} from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { useT } from "../../i18n/useLocale";
import {
  LAUNCHD_DOMAINS,
  LAUNCHD_OWNERSHIPS,
  LAUNCHD_SCOPES,
  type LaunchdService,
} from "../../ipc/services";
import { LaunchdServiceDetails } from "./LaunchdServiceDetails";
import {
  EMPTY_FILTER,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  discoveryErrorText,
  filterServices,
  isFilterActive,
  isSystemService,
  ownershipLabel,
  resolveSelection,
  domainLabel,
  scopeLabel,
  sourceLabel,
  sourceProblems,
  sourceStatusLabel,
  type DiscoveryState,
  type EvidenceState,
  type ServiceFilter,
} from "./launchdModel";
import { ServiceGroups } from "./ServiceGroups";

export interface ServicesViewProps {
  state: DiscoveryState;
  evidence: EvidenceState;
  filter: ServiceFilter;
  selectedId: string | undefined;
  refreshDisabled: boolean;
  onFilterChange: (filter: ServiceFilter) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  /** Extra controls next to the refresh button; the page decides what they are. */
  headerActions?: ReactNode;
  /** Called after an action on a modifiable job, so the list is read again. */
  onActionSettled?: () => void;
  /** Read-only block for the selected job, supplied by the page; absent here means none is shown. */
  renderLogs?: (service: LaunchdService) => ReactNode;
  /** Adoption and edit entries for the selected job, supplied by the page. */
  renderManagement?: (service: LaunchdService) => ReactNode;
}

const WRAP = "break-words [overflow-wrap:anywhere]";

const SCOPE_OPTIONS = [
  { value: "ALL", label: "全部来源" },
  ...LAUNCHD_SCOPES.map((scope) => ({
    value: scope,
    label: scopeLabel(scope),
  })),
] as const;

const OWNERSHIP_OPTIONS = [
  { value: "ALL", label: "全部归属" },
  ...LAUNCHD_OWNERSHIPS.map((ownership) => ({
    value: ownership,
    label: ownershipLabel(ownership),
  })),
] as const;

const DOMAIN_OPTIONS = [
  { value: "ALL", label: "全部作用域" },
  ...LAUNCHD_DOMAINS.map((domain) => ({
    value: domain,
    label: domainLabel(domain),
  })),
] as const;

const STATUS_OPTIONS = [
  { value: "ALL", label: "全部状态" },
  ...STATUS_CATEGORIES.map((category) => ({
    value: category,
    label: STATUS_CATEGORY_LABELS[category],
  })),
] as const;

export function ServicesView(props: ServicesViewProps) {
  const { state } = props;
  const services =
    state.status === "ready" ? state.discovery.services : undefined;
  const visible = services ? filterServices(services, props.filter) : [];
  const candidateCount = services?.filter(
    (service) => props.filter.showSystem || !isSystemService(service),
  ).length;

  return (
    <PageShell layout="master-detail" scrollKey="compact">
      <PageRegion>
        <section
          className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b border-border sm:border-r sm:border-b-0"
          aria-labelledby="services-heading"
        >
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8 border-b border-border bg-surface-muted px-ui-12 py-ui-8">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold" id="services-heading">
                服务清单
              </h2>
              <p className="mt-ui-4 text-xs text-muted-foreground">
                launchd 常驻任务，只读查看
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-start gap-ui-8">
              {props.headerActions}
              <Button
                size="sm"
                disabled={props.refreshDisabled}
                onClick={props.onRefresh}
              >
                刷新
              </Button>
            </div>
          </header>

          <FilterBar
            filter={props.filter}
            onFilterChange={props.onFilterChange}
            shown={services ? visible.length : undefined}
            state={state}
            total={candidateCount}
          />

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <ListBody
              {...props}
              services={services}
              visible={visible}
            />
          </div>
        </section>
      </PageRegion>

      <PageRegion>
        <section
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-ui-12 overscroll-contain"
          aria-label="任务详情"
        >
          <DetailsPane {...props} visible={visible} />
        </section>
      </PageRegion>
    </PageShell>
  );
}

function FilterBar({
  filter,
  onFilterChange,
  shown,
  state,
  total,
}: {
  filter: ServiceFilter;
  onFilterChange: (filter: ServiceFilter) => void;
  shown: number | undefined;
  state: DiscoveryState;
  total: number | undefined;
}) {
  const pickedCount = [filter.scope, filter.ownership, filter.domain, filter.status].filter(
    (value) => value !== "ALL",
  ).length;
  const refreshing = state.status === "ready" && state.refreshing;
  return (
    <div className="grid min-w-0 gap-ui-8 border-b border-border bg-surface-muted px-ui-12 py-ui-8">
      <TextField
        label="搜索任务"
        type="search"
        maxLength={128}
        placeholder="按 label、名称或路径搜索"
        value={filter.query}
        onValueChange={(query) => onFilterChange({ ...filter, query })}
      />
      <details className="services-disclosure">
        <summary>
          {pickedCount > 0 ? `更多筛选（已选 ${pickedCount} 项）` : "更多筛选"}
        </summary>
        <div className="grid min-w-0 grid-cols-2 gap-ui-8 pt-ui-8">
          <SelectField
            className="min-w-0"
            label="来源"
            options={SCOPE_OPTIONS}
            value={filter.scope}
            onValueChange={(scope) => onFilterChange({ ...filter, scope })}
          />
          <SelectField
            className="min-w-0"
            label="归属"
            options={OWNERSHIP_OPTIONS}
            value={filter.ownership}
            onValueChange={(ownership) =>
              onFilterChange({ ...filter, ownership })
            }
          />
          <SelectField
            className="min-w-0"
            label="作用域"
            options={DOMAIN_OPTIONS}
            value={filter.domain}
            onValueChange={(domain) => onFilterChange({ ...filter, domain })}
          />
          <SelectField
            className="min-w-0"
            label="状态"
            options={STATUS_OPTIONS}
            value={filter.status}
            onValueChange={(status) => onFilterChange({ ...filter, status })}
          />
        </div>
        <p className="text-aux leading-relaxed text-muted-foreground">
          来源按所在目录归类，只是位置信息；归属由后端按所有者、位置与文件类型判定，两者不同。
        </p>
      </details>
      <div className="flex h-control-sm min-w-0 items-center justify-between gap-ui-8">
        <span className="min-w-0 text-aux text-muted-foreground" role="status">
          {shown === undefined || total === undefined
            ? "正在读取本机状态…"
            : `显示 ${shown} / ${total} 项`}
          {refreshing ? " · 正在刷新…" : ""}
        </span>
        {isFilterActive(filter) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onFilterChange({ ...EMPTY_FILTER, showSystem: filter.showSystem })
            }
          >
            清除筛选
          </Button>
        ) : null}
      </div>
    </div>
  );
}


function ListBody({
  filter,
  onFilterChange,
  onRefresh,
  onSelect,
  refreshDisabled,
  selectedId,
  services,
  state,
  visible,
}: ServicesViewProps & {
  services: readonly LaunchdService[] | undefined;
  visible: readonly LaunchdService[];
}) {
  if (state.status === "loading") {
    return <div aria-busy="true" />;
  }
  if (state.status === "error") {
    return (
      <div className="p-ui-12">
        <AsyncState kind="error">
          <span className={WRAP}>{discoveryErrorText(state.error)}</span>
        </AsyncState>
        <div className="mt-ui-8">
          <Button size="sm" disabled={refreshDisabled} onClick={onRefresh}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  const { discovery } = state;
  const problems = sourceProblems(discovery.sources);
  return (
    <>
      {state.refreshError ? (
        <div className="px-ui-12">
          <AsyncState kind="error">
            <span className={WRAP}>
              刷新失败：{discoveryErrorText(state.refreshError)}以下为上次读取的结果。
            </span>
          </AsyncState>
        </div>
      ) : null}
      {!discovery.complete ? (
        <div className="px-ui-12">
          <AsyncState kind="partial">
            {problems.length > 0 ? (
              <>
                <span className="block">
                  部分来源未能读取，结果可能不完整，下列来源的信息缺失：
                </span>
                <ul className="mt-ui-4 grid gap-ui-4 text-xs">
                  {problems.map((problem) => (
                    <li className={WRAP} key={problem.source}>
                      <span className="font-mono">
                        {sourceLabel(problem.source)}
                      </span>
                      （{sourceStatusLabel(problem.status)}）{problem.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {discovery.truncated ? (
              <span className="block">
                任务数量超过上限，结果已截断，结果可能不完整。
              </span>
            ) : null}
          </AsyncState>
        </div>
      ) : null}
      {services && services.length === 0 ? (
        <div className="px-ui-12">
          <AsyncState kind="empty">
            {discovery.complete
              ? "没有发现常驻任务。"
              : "未读取到任何常驻任务，但部分来源未能读取，不能据此认为没有常驻任务。"}
          </AsyncState>
        </div>
      ) : (
        <ServiceGroups
          services={services ?? []}
          visible={visible}
          showSystem={filter.showSystem}
          onShowSystemChange={(showSystem) =>
            onFilterChange({ ...filter, showSystem })
          }
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

function DetailsPane({
  evidence,
  filter,
  onActionSettled,
  renderLogs,
  renderManagement,
  selectedId,
  state,
  visible,
}: ServicesViewProps & { visible: readonly LaunchdService[] }) {
  const t = useT();
  if (selectedId === undefined) {
    return (
      <AsyncState kind="empty">
        从清单中选择一项任务，查看它的来源、配置文件与状态。
      </AsyncState>
    );
  }
  if (state.status === "loading") {
    return null;
  }
  if (state.status === "error") {
    return (
      <AsyncState kind="empty">读取失败，暂时无法显示所选任务的详情。</AsyncState>
    );
  }
  const resolved = resolveSelection(state.discovery.services, selectedId);
  if (resolved.kind !== "found") {
    return (
      <AsyncState kind="partial">
        <span className={WRAP}>
          所选任务（<span className="font-mono">{selectedId}</span>
          ）已不存在，可能已卸载或配置已被移除。请从清单中重新选择。
        </span>
      </AsyncState>
    );
  }
  const notShown = !visible.some((service) => service.id === resolved.service.id);
  const systemHidden =
    notShown && !filter.showSystem && isSystemService(resolved.service);
  const hidden = notShown && isFilterActive(filter);
  return (
    <div className="grid min-w-0 gap-ui-12">
      {systemHidden ? (
        <AsyncState kind="partial">{t("services.selectedSystemHidden")}</AsyncState>
      ) : hidden ? (
        <AsyncState kind="partial">
          所选任务被当前筛选条件隐藏，清单中不显示它；清除筛选后可在清单中看到。
        </AsyncState>
      ) : null}
      <LaunchdServiceDetails
        evidence={evidence}
        onChanged={onActionSettled}
        service={resolved.service}
        sources={state.discovery.sources}
      />
      {renderManagement ? renderManagement(resolved.service) : null}
      {renderLogs ? (
        <Panel aria-labelledby="service-logs-heading" className="min-w-0">
          <header className="border-b border-border px-ui-16 py-ui-12">
            <h3 className="text-sm font-semibold" id="service-logs-heading">
              任务日志
            </h3>
          </header>
          <div className="px-ui-16 py-ui-12">
            {renderLogs(resolved.service)}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
