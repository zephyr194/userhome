import { Tab, TabGroup, TabList } from "@headlessui/react";
import { classNames } from "./classNames";
import { useSlideIndicator } from "./useSlideIndicator";

export interface SectionTab {
  id: string;
  label: string;
}

export interface SectionTabsProps {
  label: string;
  sections: readonly SectionTab[];
  selected: string;
  onSelect: (section: string) => void;
}

/** In-page section tabs of a tool; the page below shows the content of the selected section. */
export function SectionTabs({ label, sections, selected, onSelect }: SectionTabsProps) {
  const selectedIndex = Math.max(0, sections.findIndex((section) => section.id === selected));
  const tabsRef = useSlideIndicator(sections[selectedIndex]?.id, "x");

  return (
    <TabGroup
      as="div"
      className="col-span-full min-w-0"
      selectedIndex={selectedIndex}
      onChange={(index) => onSelect(sections[index].id)}
    >
      <TabList
        ref={tabsRef}
        aria-label={label}
        className="slide-list flex min-w-0 items-end gap-ui-4 border-b border-line"
        data-slide-axis="x"
      >
        {sections.map((section, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Tab
              key={section.id}
              aria-current={isSelected ? "true" : undefined}
              data-section-id={section.id}
              className={classNames(
                "slide-item h-control-md px-ui-8 text-aux",
                isSelected
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.label}
            </Tab>
          );
        })}
      </TabList>
    </TabGroup>
  );
}
