import { Tab, TabList } from "@headlessui/react";
import { SETTINGS_GROUPS } from "./settingsGroups";

export function SettingsSidebar() {
  return (
    <TabList
      className="settings-pane__tabs m-0 grid min-h-0 min-w-0 list-none content-start gap-ui-xs overflow-x-hidden overflow-y-auto p-ui-md [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      aria-label="设置分组"
    >
      {SETTINGS_GROUPS.map((group, index) => (
        <Tab
          key={group.id}
          className={({ selected }) =>
            selected
              ? "settings-pane__tab flex min-h-12 w-full min-w-0 items-start gap-ui-lg rounded-control bg-selection px-ui-lg py-ui-md text-left text-selection-foreground shadow-[inset_3px_0_0_var(--app-selection-border)]"
              : "settings-pane__tab flex min-h-12 w-full min-w-0 items-start gap-ui-lg rounded-control bg-transparent px-ui-lg py-ui-md text-left text-foreground hover:bg-surface"
          }
          data-group-id={group.id}
          id={`settings-group-${group.id}`}
        >
          <span
            className="settings-pane__tab-index grid size-6 shrink-0 place-items-center rounded-control bg-surface text-xs font-bold text-muted-foreground"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <span className="min-w-0">
            <strong className="block break-words text-sm font-semibold">
              {group.label}
            </strong>
            <span className="settings-pane__tab-description mt-ui-xxs block break-words text-xs leading-relaxed text-muted-foreground">
              {group.summary}
            </span>
          </span>
        </Tab>
      ))}
    </TabList>
  );
}
