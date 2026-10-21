import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { AsyncState } from "../../components/AsyncState";
import {
  Button,
  Panel,
  SelectField,
  StatusBadge,
  TextField,
} from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
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
  correlationBrief,
  domainLabel,
  executionOf,
  exitText,
  filterServices,
  isFilterActive,
  moveIndex,
  ownershipLabel,
  primaryConfigFile,
  resolveSelection,
  scopeLabel,
  sourceLabel,
  sourceProblems,
  sourceStatusLabel,
  statusPresentation,
  type DiscoveryState,
  type EvidenceState,
  type ServiceFilter,
} from "./launchdModel";

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

  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden"
      aria-labelledby="services-heading"
    >
      <div className="grid min-h-0 overflow-hidden grid-rows-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:grid-cols-[360px_minmax(0,1fr)] sm:grid-rows-1">
        <section
          className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border-b border-border sm:border-r sm:border-b-0"
          aria-labelledby="services-heading"
        >
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-lg border-b border-border bg-surface-muted px-ui-xl py-ui-md">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold" id="services-heading">
                服务清单
              </h2>
              <p className="mt-ui-xs text-xs text-muted-foreground">
                launchd 常驻任务，只读查看
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-start gap-ui-md">
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
            total={services?.length}
          />

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <ListBody
              {...props}
              services={services}
              visible={visible}
            />
          </div>
        </section>

        <section
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-ui-xl overscroll-contain"
          aria-label="任务详情"
        >
          <DetailsPane {...props} visible={visible} />
        </section>
      </div>
    </section>
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
  return (
    <div className="grid min-w-0 gap-ui-md border-b border-border bg-surface-muted px-ui-xl py-ui-md">
      <TextField
        label="搜索任务"
        type="search"
        maxLength={128}
        placeholder="按 label、名称或路径搜索"
        value={filter.query}
        onValueChange={(query) => onFilterChange({ ...filter, query })}
      />
      <div className="flex min-w-0 flex-wrap gap-ui-md">
        <SelectField
          className="min-w-28 flex-1"
          label="来源"
          options={SCOPE_OPTIONS}
          value={filter.scope}
          onValueChange={(scope) => onFilterChange({ ...filter, scope })}
        />
        <SelectField
          className="min-w-28 flex-1"
          label="归属"
          options={OWNERSHIP_OPTIONS}
          value={filter.ownership}
          onValueChange={(ownership) =>
            onFilterChange({ ...filter, ownership })
          }
        />
        <SelectField
          className="min-w-28 flex-1"
          label="作用域"
          options={DOMAIN_OPTIONS}
          value={filter.domain}
          onValueChange={(domain) => onFilterChange({ ...filter, domain })}
        />
        <SelectField
          className="min-w-28 flex-1"
          label="状态"
          options={STATUS_OPTIONS}
          value={filter.status}
          onValueChange={(status) => onFilterChange({ ...filter, status })}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        来源按所在目录归类，只是位置信息；归属由后端按所有者、位置与文件类型判定，两者不同。
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-md">
        <span className="text-xs text-muted-foreground" role="status">
          {shown === undefined || total === undefined
            ? "正在读取本机状态"
            : `显示 ${shown} / ${total} 项`}
          {state.status === "ready" && state.refreshing ? " · 正在刷新…" : ""}
        </span>
        {isFilterActive(filter) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onFilterChange(EMPTY_FILTER)}
          >
            清除筛选
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ListBody({
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
    return (
      <div className="p-ui-xl">
        <AsyncState kind="loading">正在读取常驻任务…</AsyncState>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="p-ui-xl">
        <AsyncState kind="error">
          <span className={WRAP}>{state.error.message}</span>
        </AsyncState>
        <div className="mt-ui-lg">
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
        <div className="px-ui-xl">
          <AsyncState kind="error">
            <span className={WRAP}>
              刷新失败：{state.refreshError.message}以下为上次读取的结果。
            </span>
          </AsyncState>
        </div>
      ) : null}
      {!discovery.complete ? (
        <div className="px-ui-xl">
          <AsyncState kind="partial">
            {problems.length > 0 ? (
              <>
                <span className="block">
                  部分来源未能读取，结果可能不完整，下列来源的信息缺失：
                </span>
                <ul className="mt-ui-xs grid gap-ui-xs text-xs">
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
        <div className="px-ui-xl">
          <AsyncState kind="empty">
            {discovery.complete
              ? "没有发现常驻任务。"
              : "未读取到任何常驻任务，但部分来源未能读取，不能据此认为没有常驻任务。"}
          </AsyncState>
        </div>
      ) : visible.length === 0 ? (
        <div className="px-ui-xl">
          <AsyncState kind="empty">没有符合筛选条件的任务。</AsyncState>
        </div>
      ) : (
        <ServiceList
          onSelect={onSelect}
          selectedId={selectedId}
          visible={visible}
        />
      )}
    </>
  );
}

function ServiceList({
  onSelect,
  selectedId,
  visible,
}: {
  onSelect: (id: string) => void;
  selectedId: string | undefined;
  visible: readonly LaunchdService[];
}) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIsVisible = visible.some((service) => service.id === selectedId);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = moveIndex(event.key, index, visible.length);
    if (next === undefined) return;
    event.preventDefault();
    if (next === index) return;
    const id = visible[next].id;
    onSelect(id);
    rowRefs.current.get(id)?.focus();
  }

  return (
    <ul aria-label={`常驻任务清单，共 ${visible.length} 项`}>
      {visible.map((service, index) => {
        const isSelected = service.id === selectedId;
        const isTabStop = isSelected || (!selectedIsVisible && index === 0);
        const status = statusPresentation(service);
        const file = primaryConfigFile(service);
        const execution = executionOf(service);
        const brief = correlationBrief(service);
        return (
          <li key={service.id}>
            <Button
              variant="ghost"
              ref={(button) => {
                if (button) rowRefs.current.set(service.id, button);
                else rowRefs.current.delete(service.id);
              }}
              className={classNames(
                "services-inventory-row",
                isSelected && "services-inventory-row--selected",
              )}
              aria-label={`${service.label}，${scopeLabel(service.scope)}，${status.label}`}
              aria-current={isSelected ? "true" : undefined}
              tabIndex={isTabStop ? 0 : -1}
              onClick={() => onSelect(service.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className="grid min-w-0 gap-ui-xs">
                <strong className={`block text-sm font-semibold ${WRAP}`}>
                  {service.label}
                </strong>
                <span className={`block text-xs text-muted-foreground ${WRAP}`}>
                  {scopeLabel(service.scope)} · {domainLabel(service.domain)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {`归属：${ownershipLabel(service.ownership.kind)}`}
                </span>
                {file ? (
                  <span
                    className={`block font-mono text-meta text-muted-foreground ${WRAP}`}
                  >
                    {file.path}
                  </span>
                ) : null}
                {execution?.executable ? (
                  <span
                    className={`block font-mono text-meta text-muted-foreground ${WRAP}`}
                  >
                    {[execution.executable, ...execution.arguments].join(" ")}
                  </span>
                ) : null}
                {brief ? (
                  <span className="block text-xs text-warning">{brief}</span>
                ) : null}
                {service.pid !== undefined || service.lastExit ? (
                  <span className="block text-xs text-muted-foreground">
                    {service.pid !== undefined ? `PID ${service.pid}` : null}
                    {service.pid !== undefined && service.lastExit ? " · " : null}
                    {service.lastExit ? exitText(service.lastExit) : null}
                  </span>
                ) : null}
              </span>
              <StatusBadge
                className="min-h-5 shrink-0 self-start px-ui-sm py-0 text-meta"
                tone={status.tone}
              >
                {status.label}
              </StatusBadge>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function DetailsPane({
  evidence,
  filter,
  onActionSettled,
  renderLogs,
  selectedId,
  state,
  visible,
}: ServicesViewProps & { visible: readonly LaunchdService[] }) {
  if (selectedId === undefined) {
    return (
      <AsyncState kind="empty">
        从清单中选择一项任务，查看它的来源、配置文件与状态。
      </AsyncState>
    );
  }
  if (state.status === "loading") {
    return <AsyncState kind="loading">正在加载服务详情…</AsyncState>;
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
  const hidden =
    isFilterActive(filter) &&
    !visible.some((service) => service.id === resolved.service.id);
  return (
    <div className="grid min-w-0 gap-ui-xl">
      {hidden ? (
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
      {renderLogs ? (
        <Panel aria-labelledby="service-logs-heading" className="min-w-0">
          <header className="border-b border-border px-ui-3xl py-ui-xl">
            <h3 className="text-sm font-semibold" id="service-logs-heading">
              任务日志
            </h3>
          </header>
          <div className="px-ui-3xl py-ui-xl">
            {renderLogs(resolved.service)}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
