import { Tab, TabList } from "@headlessui/react";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import { useT } from "../../i18n/useLocale";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";

export function SettingsSidebar({ selectedGroup }: { selectedGroup: SettingsGroupId }) {
  const t = useT();
  const listRef = useSlideIndicator(selectedGroup);
  return (
    <TabList
      ref={listRef}
      className="slide-list settings-pane__tabs m-0 grid min-h-0 min-w-0 flex-1 list-none content-start gap-0 overflow-x-hidden overflow-y-auto px-ui-8 [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      aria-label={t("settings.groupList.label")}
    >
      {SETTINGS_GROUPS.map((group) => (
        <Tab
          key={group.id}
          aria-current={group.id === selectedGroup ? "true" : undefined}
          className="settings-pane__tab slide-item flex w-full min-w-0 flex-wrap items-baseline justify-between gap-x-ui-8 gap-y-ui-2 px-ui-12 py-ui-8 text-left text-foreground"
          data-group-id={group.id}
          id={`settings-group-${group.id}`}
        >
          <span className="block min-w-0 break-words text-body font-semibold">
            {t(group.labelKey)}
          </span>
          <span className="block min-w-0 break-words text-aux font-normal text-muted-foreground settings-pane__tab-desc">
            {t(group.summaryKey)}
          </span>
        </Tab>
      ))}
    </TabList>
  );
}
