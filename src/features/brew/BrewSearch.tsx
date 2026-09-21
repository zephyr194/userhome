import {
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import {
  searchBrewPackages,
  type BrewSearchPage,
  type BrewSearchResult,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import { BrewPackageInspector } from "./BrewPackageDetails";

type SearchState =
  | { status: "idle" }
  | { status: "loading"; requestId: number }
  | { status: "ready"; requestId: number; page: BrewSearchPage }
  | { status: "error"; requestId: number; error: AppError };

const SEARCH_INPUT_CLASSES =
  "min-h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

function targetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  itemCount: number,
): number | undefined {
  if (event.key === "ArrowDown") return Math.min(currentIndex + 1, itemCount - 1);
  if (event.key === "ArrowUp") return Math.max(currentIndex - 1, 0);
  if (event.key === "Home") return 0;
  if (event.key === "End") return itemCount - 1;
  return undefined;
}

function packageKey(selection: BrewSearchResult): string {
  return `${selection.kind}:${selection.identifier}`;
}

export function BrewSearch({
  onChanged,
  onShowInstalled,
  refreshId,
}: {
  onChanged: () => void;
  onShowInstalled?: () => void;
  refreshId?: string;
}) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const [selected, setSelected] = useState<BrewSearchResult>();
  const requestRef = useRef(0);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  async function runSearch(searchQuery: string, page: number) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setSearchState({ status: "loading", requestId });
    try {
      const result = await searchBrewPackages({
        query: searchQuery,
        page,
        pageSize: 25,
      });
      if (requestRef.current === requestId) {
        setSearchState({ status: "ready", requestId, page: result });
      }
    } catch (error) {
      if (requestRef.current === requestId) {
        setSearchState({
          status: "error",
          requestId,
          error: decodeAppError(error),
        });
      }
    }
  }

  function clearSearch() {
    requestRef.current += 1;
    setQuery("");
    setActiveQuery("");
    setSearchState({ status: "idle" });
    setSelected(undefined);
  }

  const items = searchState.status === "ready" ? searchState.page.items : [];
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
    setSelected(nextSelection);
    buttonRefs.current.get(packageKey(nextSelection))?.focus();
  }

  return (
    <div className="brew-workspace__view">
      <form
        className="brew-workspace__toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          const searchQuery = query.trim();
          if (!searchQuery) {
            clearSearch();
            return;
          }
          if (searchQuery !== activeQuery) {
            setSelected(undefined);
          }
          setActiveQuery(searchQuery);
          void runSearch(searchQuery, 1);
        }}
      >
        <div
          className="brew-workspace__mode"
          role="group"
          aria-label="Homebrew 数据源"
        >
          <Button
            size="sm"
            aria-pressed="false"
            onClick={onShowInstalled}
          >
            已安装
          </Button>
          <Button size="sm" variant="primary" aria-pressed="true">
            搜索目录
          </Button>
        </div>
        <label className="sr-only" htmlFor="brew-package-search">
          Homebrew 搜索
        </label>
        <input
          className={SEARCH_INPUT_CLASSES}
          id="brew-package-search"
          type="search"
          maxLength={128}
          placeholder="输入 Formula 或 Cask 名称"
          value={query}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setQuery(value);
            if (value.length === 0) {
              clearSearch();
            }
          }}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={searchState.status === "loading"}
        >
          {searchState.status === "loading" ? "正在搜索…" : "搜索"}
        </Button>
      </form>

      <div className="brew-workspace__body">
        <section
          className="brew-workspace__list"
          aria-labelledby="brew-search-results-heading"
        >
          <header className="brew-workspace__pane-heading">
            <h3 id="brew-search-results-heading">Homebrew 搜索</h3>
            <span>
              {searchState.status === "ready"
                ? `${searchState.page.totalItems} 项`
                : "远程目录"}
            </span>
          </header>

          {searchState.status === "idle" ? (
            <div className="p-3">
              <AsyncState kind="empty">
                输入名称搜索 Homebrew Formula 与 Cask。
              </AsyncState>
            </div>
          ) : searchState.status === "loading" ? (
            <div className="p-3">
              <AsyncState kind="loading">
                正在搜索 Homebrew 目录…
              </AsyncState>
            </div>
          ) : searchState.status === "error" ? (
            <div className="p-3">
              <AsyncState kind="error">{searchState.error.message}</AsyncState>
            </div>
          ) : searchState.page.items.length === 0 ? (
            <div className="p-3">
              <AsyncState kind="empty">没有找到匹配的软件。</AsyncState>
            </div>
          ) : (
            <>
              <ul role="listbox" aria-label="Homebrew 搜索结果">
                {items.map((item, index) => {
                  const itemSelection = {
                    kind: item.kind,
                    identifier: item.identifier,
                  };
                  const key = packageKey(itemSelection);
                  const isSelected = selectedKey === key;
                  const isTabStop =
                    isSelected || (!selectedIsVisible && index === 0);
                  return (
                    <li key={key} role="presentation">
                      <button
                        ref={(button) => {
                          if (button) {
                            buttonRefs.current.set(key, button);
                          } else {
                            buttonRefs.current.delete(key);
                          }
                        }}
                        className={
                          isSelected
                            ? "brew-package-row brew-package-row--selected"
                            : "brew-package-row"
                        }
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={isTabStop ? 0 : -1}
                        onClick={() => setSelected(itemSelection)}
                        onKeyDown={(event) => moveSelection(event, index)}
                      >
                        <span className="min-w-0">
                          <strong>{item.identifier}</strong>
                          <span>Homebrew 远程目录</span>
                        </span>
                        <StatusBadge>
                          {item.kind === "FORMULA" ? "Formula" : "Cask"}
                        </StatusBadge>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <nav
                className="brew-workspace__pagination"
                aria-label="搜索结果分页"
              >
                <Button
                  size="sm"
                  disabled={searchState.page.page <= 1}
                  onClick={() => {
                    const page = searchState.page.page - 1;
                    void runSearch(activeQuery, page);
                  }}
                >
                  上一页
                </Button>
                <span>
                  {searchState.page.page} /{" "}
                  {Math.max(searchState.page.totalPages, 1)}
                </span>
                <Button
                  size="sm"
                  disabled={
                    searchState.page.page >= searchState.page.totalPages
                  }
                  onClick={() => {
                    const page = searchState.page.page + 1;
                    void runSearch(activeQuery, page);
                  }}
                >
                  下一页
                </Button>
              </nav>
            </>
          )}
        </section>

        <section
          className="brew-workspace__detail"
          aria-label="Homebrew 软件包详情"
        >
          {selected ? (
            <BrewPackageInspector
              idPrefix="brew-search-package"
              key={packageKey(selected)}
              onChanged={onChanged}
              refreshId={refreshId}
              selected={selected}
            />
          ) : (
            <AsyncState kind="empty">
              选择一个搜索结果以查看版本、安装状态和可用操作。
            </AsyncState>
          )}
        </section>
      </div>
    </div>
  );
}
