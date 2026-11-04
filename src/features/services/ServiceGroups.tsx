import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, CheckboxField } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import { useT } from "../../i18n/useLocale";
import type { LaunchdService } from "../../ipc/services";
import { moveIndex, scopeLabel, statusPresentation } from "./launchdModel";
import {
  INJECTOR_TITLE_KEYS,
  displayNameOf,
  groupServices,
  programFileName,
  purposeOf,
  systemServiceCount,
  triggerOf,
  type Injector,
} from "./serviceProfile";

export interface ServiceGroupsProps {
  /** Every discovered job; used for the hidden-system count. */
  services: readonly LaunchdService[];
  /** The jobs that pass the current filter and system visibility. */
  visible: readonly LaunchdService[];
  showSystem: boolean;
  onShowSystemChange: (showSystem: boolean) => void;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function ServiceGroups({
  services,
  visible,
  showSystem,
  onShowSystemChange,
  selectedId,
  onSelect,
}: ServiceGroupsProps) {
  const t = useT();
  const systemCount = useMemo(() => systemServiceCount(services), [services]);
  const groups = useMemo(() => groupServices(visible), [visible]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Injector>>(() => new Set<Injector>(["SYSTEM"]));
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  const listRef = useSlideIndicator(selectedId);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Selecting a job inside a collapsed group opens that group, so the selection stays in view.
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    const owner = groups.find((group) =>
      group.services.some((service) => service.id === selectedId),
    );
    if (owner && collapsed.has(owner.injector)) {
      const next = new Set(collapsed);
      next.delete(owner.injector);
      setCollapsed(next);
    }
  }

  const rendered = useMemo(
    () =>
      groups
        .filter((group) => !collapsed.has(group.injector))
        .flatMap((group) => group.services),
    [groups, collapsed],
  );
  const indexById = useMemo(
    () => new Map(rendered.map((service, index) => [service.id, index])),
    [rendered],
  );
  const selectedIsRendered = indexById.has(selectedId ?? "");

  function setGroupOpen(injector: Injector, open: boolean) {
    const next = new Set(collapsed);
    if (open) next.delete(injector);
    else next.add(injector);
    setCollapsed(next);
  }

  const registerRow = useCallback((id: string, button: HTMLButtonElement | null) => {
    if (button) rowRefs.current.set(id, button);
    else rowRefs.current.delete(id);
  }, []);

  const onRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const next = moveIndex(event.key, index, rendered.length);
      if (next === undefined) return;
      event.preventDefault();
      if (next === index) return;
      const id = rendered[next].id;
      onSelect(id);
      rowRefs.current.get(id)?.focus();
    },
    [rendered, onSelect],
  );

  return (
    <div className="services-groups motion-enter">
      {systemCount > 0 ? (
        <div className="services-groups__system">
          {showSystem ? null : (
            <span className="text-aux text-muted-foreground">
              {t("services.hiddenSystem", { count: systemCount })}
            </span>
          )}
          <CheckboxField
            label={t("services.showSystem")}
            checked={showSystem}
            onCheckedChange={onShowSystemChange}
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="px-ui-12">
          <AsyncState kind="empty">
            {t("services.list.emptyFiltered")}
            {systemCount > 0 && !showSystem ? (
              <span className="block">
                {t("services.emptyHiddenSystem")}
              </span>
            ) : null}
          </AsyncState>
        </div>
      ) : (
        <div ref={listRef} className="slide-list services-groups__body">
          {groups.map((group) => {
            const open = !collapsed.has(group.injector);
            const title = t(INJECTOR_TITLE_KEYS[group.injector]);
            return (
              <details
                className="services-group"
                key={group.injector}
                open={open}
                onToggle={(event) => setGroupOpen(group.injector, event.currentTarget.open)}
              >
                <summary className="services-group__summary">
                  <span className="services-group__title">{title}</span>
                  <span className="services-group__count">
                    {t("services.group.count", { count: group.services.length })}
                  </span>
                </summary>
                {open ? (
                  <ul
                    className="services-group__list"
                    aria-label={t("services.group.ariaLabel", {
                      title,
                      count: group.services.length,
                    })}
                  >
                    {group.services.map((service) => {
                      const index = indexById.get(service.id) ?? -1;
                      return (
                        <ServiceRow
                          key={service.id}
                          service={service}
                          index={index}
                          isSelected={service.id === selectedId}
                          isTabStop={
                            service.id === selectedId ||
                            (!selectedIsRendered && index === 0)
                          }
                          registerRow={registerRow}
                          onSelect={onSelect}
                          onKeyDown={onRowKeyDown}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ServiceRow = memo(function ServiceRow({
  service,
  index,
  isSelected,
  isTabStop,
  registerRow,
  onSelect,
  onKeyDown,
}: {
  service: LaunchdService;
  index: number;
  isSelected: boolean;
  isTabStop: boolean;
  registerRow: (id: string, button: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  const t = useT();
  const status = statusPresentation(service, t);
  const purpose = purposeOf(service, t);
  const program = programFileName(service);
  const name = displayNameOf(service);
  const trigger = triggerOf(service, t);
  return (
    <li className="border-b border-border">
      <Button
        variant="ghost"
        ref={(button) => registerRow(service.id, button)}
        className={classNames(
          "slide-item services-inventory-row",
          isSelected && "services-inventory-row--selected",
        )}
        aria-label={t("services.row.ariaLabel", {
          label: name,
          scope: scopeLabel(service.scope, t),
          status: status.label,
          trigger: trigger.badge,
        })}
        aria-current={isSelected ? "true" : undefined}
        tabIndex={isTabStop ? 0 : -1}
        onClick={() => onSelect(service.id)}
        onKeyDown={(event) => onKeyDown(event, index)}
      >
        <span className="services-inventory-row__head">
          <strong className="services-inventory-row__label" title={service.label}>
            {name}
          </strong>
          {purpose === null ? (
            <span className="services-inventory-row__unknown">
              {t("services.purposeUnknown")}
            </span>
          ) : null}
        </span>
        <span className="services-inventory-row__purpose">
          {purpose ?? program ?? t("services.noProgramPath")}
        </span>
        <span className="services-inventory-row__foot">
          <span className="services-inventory-row__trigger">{trigger.badge}</span>
          <span className="services-inventory-row__status">
            <span
              className={classNames(
                "services-inventory-row__dot",
                `services-inventory-row__dot--${status.tone}`,
              )}
              aria-hidden="true"
            />
            {status.label}
          </span>
        </span>
      </Button>
    </li>
  );
});
