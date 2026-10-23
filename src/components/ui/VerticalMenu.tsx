import { Tab, TabGroup, TabList } from "@headlessui/react";
import { useSlideIndicator } from "./useSlideIndicator";

export interface VerticalMenuItem {
  id: string;
  label: string;
  description?: string;
}

export interface VerticalMenuProps {
  label: string;
  items: readonly VerticalMenuItem[];
  selected: string;
  onSelect: (id: string) => void;
}

/**
 * Second-level menu for a page that has several domains. One selection box
 * slides between the items; the label sits on the left, the description on the
 * right, and the description wraps under the label when the column is narrow.
 */
export function VerticalMenu({ label, items, selected, onSelect }: VerticalMenuProps) {
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selected));
  const listRef = useSlideIndicator(items[selectedIndex]?.id, "y");

  return (
    <TabGroup
      as="div"
      className="vertical-menu w-full min-w-[200px] max-w-[240px]"
      onChange={(index) => onSelect(items[index].id)}
      selectedIndex={selectedIndex}
      vertical
    >
      <TabList
        aria-label={label}
        className="slide-list flex min-w-0 flex-col gap-ui-2"
        ref={listRef}
      >
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Tab
              aria-current={isSelected ? "true" : undefined}
              className="slide-item vertical-menu__item flex min-w-0 flex-wrap items-baseline justify-between gap-x-ui-8 gap-y-ui-2 px-ui-12 py-ui-8 text-left text-foreground"
              data-section-id={item.id}
              key={item.id}
            >
              <span className="text-body font-semibold">{item.label}</span>
              {item.description ? (
                <span className="text-aux font-normal text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </Tab>
          );
        })}
      </TabList>
    </TabGroup>
  );
}
