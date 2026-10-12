import { useRef, type KeyboardEvent } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type {
  BrewPackagePage,
  BrewSearchResult,
} from "../../ipc/brew";
import type { AppError } from "../../ipc/core";
import { packageKey, targetIndex } from "./packageKey";

export type BrewInventoryListState =
  | { status: "loading" }
  | { status: "ready"; page: BrewPackagePage }
  | { status: "error"; error: AppError };

/**
 * Owns the installed-package list pane: pane heading, the scrollable listbox
 * and the pagination footer. The footer is the list grid's own last row, so it
 * stays pinned while a long list scrolls inside `ul` on its own.
 */
export function BrewInventoryList({
  onPageChange,
  onSelect,
  selected,
  state,
}: {
  onPageChange: (page: number) => void;
  onSelect: (selection: BrewSearchResult) => void;
  selected?: BrewSearchResult;
  state: BrewInventoryListState;
}) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const items = state.status === "ready" ? state.page.items : [];
  const selectedKey = selected ? packageKey(selected) : undefined;
  const selectedIsVisible = items.some(
    (item) => packageKey(item) === selectedKey,
  );

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const nextIndex = targetIndex(event, currentIndex, items.length);
    if (nextIndex === undefined) return;
    event.preventDefault();
    if (nextIndex === currentIndex) return;
    const next = items[nextIndex];
    const nextSelection = {
      kind: next.kind,
      identifier: next.identifier,
    };
    onSelect(nextSelection);
    buttonRefs.current.get(packageKey(nextSelection))?.focus();
  }

  return (
    <section
      className="brew-workspace__list"
      aria-labelledby="brew-inventory-list-heading"
    >
      <header className="brew-workspace__pane-heading">
        <h3 id="brew-inventory-list-heading">已安装软件</h3>
        <span>
          {state.status === "ready" ? `${state.page.totalItems} 项` : "本机清单"}
        </span>
      </header>

      {state.status === "loading" ? (
        <div className="p-3">
          <AsyncState kind="loading">正在加载清单…</AsyncState>
        </div>
      ) : state.status === "error" ? (
        <div className="p-3">
          <AsyncState kind="error">
            <span className="break-words [overflow-wrap:anywhere]">
              {state.error.message}
            </span>
          </AsyncState>
        </div>
      ) : items.length === 0 ? (
        <div className="p-3">
          <AsyncState kind="empty">没有符合条件的软件。</AsyncState>
        </div>
      ) : (
        <>
          <ul aria-label={`已安装软件列表，共 ${state.page.totalItems} 项，第 ${state.page.page} / ${Math.max(state.page.totalPages, 1)} 页`}>
            {items.map((item, index) => {
              const itemSelection = {
                kind: item.kind,
                identifier: item.identifier,
              };
              const key = packageKey(itemSelection);
              const isSelected = selectedKey === key;
              const isTabStop =
                isSelected || (!selectedIsVisible && index === 0);
              const versions =
                item.installedVersions.join(", ") || "版本未知";
              return (
                <li key={key}>
                  <Button
                    variant="ghost"
                    ref={(button) => {
                      if (button) {
                        buttonRefs.current.set(key, button);
                      } else {
                        buttonRefs.current.delete(key);
                      }
                    }}
                    className={classNames(
                      "brew-inventory-row",
                      isSelected && "brew-inventory-row--selected",
                    )}
                    aria-label={`${item.displayName}，${item.kind === "FORMULA" ? "Formula" : "Cask"} ${item.identifier}，${versions}，${item.outdated ? "可更新" : "最新"}`}
                    aria-current={isSelected ? "true" : undefined}
                    tabIndex={isTabStop ? 0 : -1}
                    onClick={() => onSelect(itemSelection)}
                    onKeyDown={(event) => moveSelection(event, index)}
                  >
                    <span className="min-w-0">
                      <strong className="block break-words text-sm font-semibold [overflow-wrap:anywhere]">
                        {item.displayName}
                      </strong>
                      <span className="mt-ui-xs block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {item.description ?? item.identifier}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-col items-end gap-ui-xs">
                      <span className="block max-w-full break-all text-xs text-muted-foreground">
                        {versions}
                      </span>
                      <StatusBadge
                        className="min-h-5 shrink-0 px-ui-sm py-0 text-meta"
                        tone={item.outdated ? "warning" : "success"}
                      >
                        {item.outdated ? "可更新" : "最新"}
                      </StatusBadge>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
          <nav
            className="brew-workspace__pagination"
            aria-label="已安装软件分页"
          >
            <Button
              size="sm"
              disabled={state.page.page <= 1}
              onClick={() => onPageChange(state.page.page - 1)}
            >
              上一页
            </Button>
            <span role="status" aria-live="polite" aria-atomic="true">
              {state.page.page} / {Math.max(state.page.totalPages, 1)}
            </span>
            <Button
              size="sm"
              disabled={state.page.page >= state.page.totalPages}
              onClick={() => onPageChange(state.page.page + 1)}
            >
              下一页
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
