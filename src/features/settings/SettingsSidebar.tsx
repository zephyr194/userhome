import { useRef, type KeyboardEvent } from "react";
import {
  SETTINGS_GROUPS,
  type SettingsGroupId,
} from "./settingsGroups";

function targetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
): number | undefined {
  if (event.key === "ArrowDown") {
    return Math.min(currentIndex + 1, SETTINGS_GROUPS.length - 1);
  }
  if (event.key === "ArrowRight") {
    return Math.min(currentIndex + 1, SETTINGS_GROUPS.length - 1);
  }
  if (event.key === "ArrowUp") {
    return Math.max(currentIndex - 1, 0);
  }
  if (event.key === "ArrowLeft") {
    return Math.max(currentIndex - 1, 0);
  }
  if (event.key === "Home") return 0;
  if (event.key === "End") return SETTINGS_GROUPS.length - 1;
  return undefined;
}

export function SettingsSidebar({
  onSelect,
  selectedGroup,
}: {
  onSelect: (group: SettingsGroupId) => void;
  selectedGroup: SettingsGroupId;
}) {
  const buttonRefs = useRef(
    new Map<SettingsGroupId, HTMLButtonElement>(),
  );

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const nextIndex = targetIndex(event, currentIndex);
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextGroup = SETTINGS_GROUPS[nextIndex];
    onSelect(nextGroup.id);
    buttonRefs.current.get(nextGroup.id)?.focus();
  }

  return (
    <ul
      className="settings-pane__tabs m-0 grid min-h-0 min-w-0 list-none content-start gap-ui-xs overflow-x-hidden overflow-y-auto p-ui-md [overscroll-behavior:contain] [scrollbar-gutter:stable]"
      role="listbox"
      aria-label="设置分组"
    >
      {SETTINGS_GROUPS.map((group, index) => {
        const isSelected = group.id === selectedGroup;
        return (
          <li key={group.id} role="presentation">
            <button
              ref={(button) => {
                if (button) {
                  buttonRefs.current.set(group.id, button);
                } else {
                  buttonRefs.current.delete(group.id);
                }
              }}
              className={
                isSelected
                  ? "settings-pane__tab flex min-h-12 w-full min-w-0 items-start gap-ui-lg rounded-control border border-selection-border bg-selection px-ui-lg py-ui-md text-left text-selection-foreground"
                  : "settings-pane__tab flex min-h-12 w-full min-w-0 items-start gap-ui-lg rounded-control border border-transparent bg-transparent px-ui-lg py-ui-md text-left text-foreground hover:bg-surface"
              }
              type="button"
              id={`settings-group-${group.id}`}
              role="option"
              aria-controls={
                isSelected ? `settings-panel-${group.id}` : undefined
              }
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(group.id)}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              <span
                className="settings-pane__tab-index grid size-6 shrink-0 place-items-center rounded-control border border-border bg-surface text-xs font-bold text-muted-foreground"
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}
