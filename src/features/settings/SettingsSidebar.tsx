import { Tab, TabList } from "@headlessui/react";
import { useSlideIndicator } from "../../components/ui/useSlideIndicator";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";

export function SettingsSidebar({ selectedGroup }: { selectedGroup: SettingsGroupId }) {
  const listRef = useSlideIndicator(selectedGroup);
  return (
    <TabList
      ref={listRef}
      className="slide-list settings-pane__tabs m-0 grid min-h-0 min-w-0 flex-1 list-none content-start gap-0 overflow-x-hidden overflow-y-auto p-0 [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      aria-label="设置分组"
    >
      {SETTINGS_GROUPS.map((group) => (
        <Tab
          key={group.id}
          aria-current={group.id === selectedGroup ? "true" : undefined}
          className="settings-pane__tab slide-item flex w-full min-w-0 flex-wrap items-baseline gap-x-ui-4 gap-y-ui-2 px-ui-12 py-ui-8 text-left text-foreground"
          data-group-id={group.id}
          id={`settings-group-${group.id}`}
        >
          <span className="block min-w-0 break-words text-body font-semibold">
            {group.label}
          </span>
          <span className="block min-w-0 break-words text-aux font-normal text-muted-foreground settings-pane__tab-desc">
            {group.summary}
          </span>
        </Tab>
      ))}
    </TabList>
  );
}
