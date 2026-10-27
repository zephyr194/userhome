import type { ReactNode } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Skeleton } from "../../components/ui/Skeleton";
import {
  Button,
  PageShell,
  SelectField,
  TextField,
} from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import type { TranslateFunction } from "../../i18n";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  LAUNCHD_DOMAINS,
  LAUNCHD_OWNERSHIPS,
  LAUNCHD_SCOPES,
  type LaunchdService,
} from "../../ipc/services";
import { LaunchdServiceDetails } from "./LaunchdServiceDetails";
import { ServiceSummaryPanel } from "./ServiceSummaryPanel";
import {
  EMPTY_FILTER,
  STATUS_CATEGORIES,
  discoveryErrorText,
  domainLabel,
  filterServices,
  isFilterActive,
  isSystemService,
  ownershipLabel,
  resolveSelection,
  scopeLabel,
  sourceLabel,
  sourceProblems,
  sourceStatusLabel,
  statusCategoryLabel,
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

function scopeOptions(t: TranslateFunction) {
  return [
    { value: "ALL", label: t("services.filter.allScopes") },
    ...LAUNCHD_SCOPES.map((scope) => ({
      value: scope,
      label: scopeLabel(scope, t),
    })),
  ] as const;
}

function ownershipOptions(t: TranslateFunction) {
  return [
    { value: "ALL", label: t("services.filter.allOwnerships") },
    ...LAUNCHD_OWNERSHIPS.map((ownership) => ({
      value: ownership,
      label: ownershipLabel(ownership, t),
    })),
  ] as const;
}

function domainOptions(t: TranslateFunction) {
  return [
    { value: "ALL", label: t("services.filter.allDomains") },
    ...LAUNCHD_DOMAINS.map((domain) => ({
      value: domain,
      label: domainLabel(domain, t),
    })),
  ] as const;
}

function statusOptions(t: TranslateFunction) {
  return [
    { value: "ALL", label: t("services.filter.allStatuses") },
    ...STATUS_CATEGORIES.map((category) => ({
      value: category,
      label: statusCategoryLabel(category, t),
    })),
  ] as const;
}

export function ServicesView(props: ServicesViewProps) {
  const t = useT();
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
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8 border-b border-border px-ui-12 py-ui-8">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold" id="services-heading">
                {t("services.list.heading")}
              </h2>
              <p className="mt-ui-4 text-xs text-muted-foreground">
                {t("services.list.subtitle")}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-start gap-ui-8">
              {props.headerActions}
              <Button
                disabled={props.refreshDisabled}
                onClick={props.onRefresh}
                variant="default"
              >
                {t("services.list.refresh")}
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
          aria-label={t("services.detail.region")}
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
  const t = useT();
  const pickedCount = [filter.scope, filter.ownership, filter.domain, filter.status].filter(
    (value) => value !== "ALL",
  ).length;
  const refreshing = state.status === "ready" && state.refreshing;
  return (
    <div className="grid min-w-0 gap-ui-8 border-b border-border px-ui-12 py-ui-8">
      <TextField
        label={t("services.filter.search")}
        type="search"
        maxLength={128}
        placeholder={t("services.filter.searchPlaceholder")}
        value={filter.query}
        onValueChange={(query) => onFilterChange({ ...filter, query })}
      />
      <details className="services-disclosure">
        <summary>
          {pickedCount > 0
            ? t("services.filter.moreWithCount", { count: pickedCount })
            : t("services.filter.more")}
        </summary>
        <div className="grid min-w-0 grid-cols-2 gap-ui-8 pt-ui-8">
          <SelectField
            className="min-w-0"
            label={t("services.filter.source")}
            options={scopeOptions(t)}
            value={filter.scope}
            onValueChange={(scope) => onFilterChange({ ...filter, scope })}
          />
          <SelectField
            className="min-w-0"
            label={t("services.filter.ownership")}
            options={ownershipOptions(t)}
            value={filter.ownership}
            onValueChange={(ownership) =>
              onFilterChange({ ...filter, ownership })
            }
          />
          <SelectField
            className="min-w-0"
            label={t("services.filter.domain")}
            options={domainOptions(t)}
            value={filter.domain}
            onValueChange={(domain) => onFilterChange({ ...filter, domain })}
          />
          <SelectField
            className="min-w-0"
            label={t("services.filter.status")}
            options={statusOptions(t)}
            value={filter.status}
            onValueChange={(status) => onFilterChange({ ...filter, status })}
          />
        </div>
        <p className="text-aux leading-relaxed text-muted-foreground">
          {t("services.filter.sourceNote")}
        </p>
      </details>
      <div className="flex h-control-sm min-w-0 items-center justify-between gap-ui-8">
        <span className="min-w-0 text-aux text-muted-foreground" role="status">
          {shown === undefined || total === undefined
            ? t("services.list.reading")
            : t("services.list.shown", { shown, total })}
          {refreshing ? t("services.list.refreshingSuffix") : ""}
        </span>
        {isFilterActive(filter) ? (
          <Button
            variant="ghost"
            onClick={() =>
              onFilterChange({ ...EMPTY_FILTER, showSystem: filter.showSystem })
            }
          >
            {t("services.filter.clear")}
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
  const t = useT();
  const locale = useLocale();
  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <Skeleton bars={3} className="motion-skeleton--list" />
      </div>
    );

  }
  if (state.status === "error") {
    return (
      <div className="py-ui-12">
        <AsyncState
          flush
          kind="error"
          action={
            <Button disabled={refreshDisabled} onClick={onRefresh} variant="danger">
              {t("services.list.retry")}
            </Button>
          }
        >
          <span className={WRAP}>{discoveryErrorText(state.error, t, locale)}</span>
        </AsyncState>
      </div>
    );
  }

  const { discovery } = state;
  const problems = sourceProblems(discovery.sources, t);
  return (
    <>
      {state.refreshError ? (
        <div className="px-ui-12">
          <AsyncState kind="error">
            <span className={WRAP}>
              {t("services.list.refreshFailed", {
                error: discoveryErrorText(state.refreshError, t, locale),
              })}
            </span>
          </AsyncState>
        </div>
      ) : null}
      {!discovery.complete ? (
        <div className="px-ui-12">
          <AsyncState kind="partial">
            {problems.length > 0 ? (
              <>
                <span className="block">{t("services.list.partialSources")}</span>
                <ul className="mt-ui-4 grid gap-ui-4 text-xs">
                  {problems.map((problem) => (
                    <li className={WRAP} key={problem.source}>
                      <span className="font-mono">
                        {sourceLabel(problem.source, t)}
                      </span>
                      {t("services.list.problemStatus", {
                        status: sourceStatusLabel(problem.status, t),
                      })}
                      {problem.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {discovery.truncated ? (
              <span className="block">{t("services.list.truncated")}</span>
            ) : null}
          </AsyncState>
        </div>
      ) : null}
      {services && services.length === 0 ? (
        <div className="px-ui-12">
          <AsyncState kind="empty">
            {discovery.complete
              ? t("services.list.none")
              : t("services.list.noneIncomplete")}
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
      <AsyncState kind="empty">{t("services.detail.empty")}</AsyncState>
    );
  }
  if (state.status === "loading") {
    return null;
  }
  if (state.status === "error") {
    return (
      <AsyncState kind="empty">{t("services.detail.readFailed")}</AsyncState>
    );
  }
  const resolved = resolveSelection(state.discovery.services, selectedId);
  if (resolved.kind !== "found") {
    return (
      <AsyncState kind="partial">
        <span className={WRAP}>
          {t("services.detail.goneBefore")}
          <span className="font-mono">{selectedId}</span>
          {t("services.detail.goneAfter")}
        </span>
      </AsyncState>
    );
  }
  const notShown = !visible.some((service) => service.id === resolved.service.id);
  const systemHidden =
    notShown && !filter.showSystem && isSystemService(resolved.service);
  const hidden = notShown && isFilterActive(filter);
  return (
    <div className="grid min-w-0 gap-ui-16">
      {systemHidden ? (
        <AsyncState kind="partial">{t("services.selectedSystemHidden")}</AsyncState>
      ) : hidden ? (
        <AsyncState kind="partial">{t("services.selectedFilteredOut")}</AsyncState>
      ) : null}
      <ServiceSummaryPanel
        key={resolved.service.id}
        service={resolved.service}
        onChanged={onActionSettled}
        renderLogs={renderLogs}
        renderManagement={renderManagement}
      />
      <details className="services-disclosure services-details">
        <summary>{t("services.details.disclosure")}</summary>
        <div className="pt-ui-8">
          <LaunchdServiceDetails
            evidence={evidence}
            service={resolved.service}
            sources={state.discovery.sources}
          />
        </div>
      </details>
    </div>
  );
}
