import { Tab, TabList } from "@headlessui/react";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";

export function SettingsSidebar({ selectedGroup }: { selectedGroup: SettingsGroupId }) {
  return (
    <TabList
      className="settings-pane__tabs m-0 grid min-h-0 min-w-0 flex-1 list-none content-start gap-ui-4 overflow-x-hidden overflow-y-auto p-ui-8 [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      aria-label="设置分组"
    >
      {SETTINGS_GROUPS.map((group, index) => (
        <Tab
          key={group.id}
          aria-current={group.id === selectedGroup ? "true" : undefined}
          className={({ selected }) =>
            selected
              ? "bracket flex w-full min-w-0 items-start gap-ui-8 rounded-control px-ui-8 py-ui-8 text-left text-selection-foreground"
              : "bracket flex w-full min-w-0 items-start gap-ui-8 rounded-control px-ui-8 py-ui-8 text-left text-foreground"
          }
          data-group-id={group.id}
          id={`settings-group-${group.id}`}
        >
          <span
            className="grid size-control-sm shrink-0 place-items-center rounded-control bg-surface text-xs font-bold text-muted-foreground"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="min-w-0">
            <strong className="block break-words text-sm font-semibold">
              {group.label}
            </strong>
            <span className="mt-ui-2 block break-words text-xs leading-relaxed text-muted-foreground">
              {group.summary}
            </span>
          </span>
        </Tab>
      ))}
    </TabList>
  );
}
