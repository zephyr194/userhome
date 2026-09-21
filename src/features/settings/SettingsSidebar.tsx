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
  if (event.key === "ArrowUp") {
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
    <ul className="settings-sidebar" role="listbox" aria-label="设置分组">
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
                  ? "settings-group-row settings-group-row--selected"
                  : "settings-group-row"
              }
              type="button"
              id={`settings-group-${group.id}`}
              role="option"
              aria-controls={`settings-panel-${group.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(group.id)}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              <span className="settings-group-row__index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="min-w-0">
                <strong>{group.label}</strong>
                <span>{group.summary}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
