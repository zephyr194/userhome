import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import {
  listBrewPackages,
  type BrewPackageKind,
  type BrewPackagePage,
  type BrewSearchResult,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import type {
  BrewInventorySummary,
  ModuleSnapshot,
} from "../../ipc/discovery";
import { BrewPackageInspector } from "./BrewPackageDetails";
import { BrewSearch } from "./BrewSearch";

type InventoryState =
  | { status: "loading"; requestKey: string }
  | { status: "ready"; requestKey: string; page: BrewPackagePage }
  | { status: "error"; requestKey: string; error: AppError };

type BrewView = "installed" | "search";

const FIELD_CLASSES =
  "min-h-8 min-w-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

function packageKey(selection: BrewSearchResult): string {
  return `${selection.kind}:${selection.identifier}`;
}

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

export function BrewInventoryPage({
  onOperationChanged,
  refreshId,
  summary,
}: {
  onOperationChanged?: () => void;
  refreshId?: string;
  summary: ModuleSnapshot<BrewInventorySummary>;
}) {
  const [view, setView] = useState<BrewView>("installed");
  const [kind, setKind] = useState<BrewPackageKind | "ALL">("ALL");
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [mutationRefresh, setMutationRefresh] = useState(0);
  const [selected, setSelected] = useState<BrewSearchResult>();
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const requestKey = `${refreshId ?? ""}:${mutationRefresh}:${kind}:${filter}:${pageNumber}`;
  const [state, setState] = useState<InventoryState>({
    status: "loading",
    requestKey,
  });
  const visibleState: InventoryState =
    state.requestKey === requestKey
      ? state
      : { status: "loading", requestKey };

  useEffect(() => {
    if (summary.status !== "READY" || !summary.data.available) {
      return;
    }
    let cancelled = false;
    void listBrewPackages({
      ...(kind === "ALL" ? {} : { kind }),
      ...(filter ? { filter } : {}),
      page: pageNumber,
      pageSize: 25,
    })
      .then((page) => {
        if (!cancelled) {
          setState({ status: "ready", requestKey, page });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            requestKey,
            error: decodeAppError(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filter, kind, pageNumber, refreshId, requestKey, summary]);

  function handleChanged() {
    setMutationRefresh((value) => value + 1);
    onOperationChanged?.();
  }

  function clearFilter() {
    setFilterInput("");
    setFilter("");
    setPageNumber(1);
  }

  const items = visibleState.status === "ready" ? visibleState.page.items : [];
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
    <section className="brew-workspace" aria-labelledby="brew-heading">
      <header className="brew-workspace__header">
        <div className="min-w-0">
          <p className="section-kicker">Homebrew 软件管理</p>
          <h2 id="brew-heading">Homebrew</h2>
          {summary.status === "READY" && summary.data.available ? (
            <p>
              {summary.data.version} · {summary.data.prefix}
            </p>
          ) : (
            <p>本机软件包、远程目录与受控操作</p>
          )}
        </div>
        {summary.status === "READY" && summary.data.available ? (
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="已安装软件数量"
          >
            <StatusBadge>Formula {summary.data.formulaCount}</StatusBadge>
            <StatusBadge>Cask {summary.data.caskCount}</StatusBadge>
          </div>
        ) : null}
      </header>

      {summary.status === "LOADING" ? (
        <div className="brew-workspace__provider-state">
          <AsyncState kind="loading">正在后台解析 Homebrew…</AsyncState>
        </div>
      ) : summary.status === "ERROR" ? (
        <div className="brew-workspace__provider-state">
          <AsyncState kind="error">{summary.error.message}</AsyncState>
        </div>
      ) : !summary.data.available ? (
        <div className="brew-workspace__provider-state">
          <AsyncState kind="empty">
            未检测到 `/opt/homebrew` 或 `/usr/local` 下的可信 Homebrew。
          </AsyncState>
        </div>
      ) : (
        <>
          <div
            className="brew-workspace__view"
            hidden={view !== "installed"}
          >
            <form
              className="brew-workspace__toolbar"
              onSubmit={(event) => {
                event.preventDefault();
                setPageNumber(1);
                setFilter(filterInput.trim());
              }}
            >
              <div
                className="brew-workspace__mode"
                role="group"
                aria-label="Homebrew 数据源"
              >
                <Button size="sm" variant="primary" aria-pressed="true">
                  已安装
                </Button>
                <Button
                  size="sm"
                  aria-pressed="false"
                  onClick={() => setView("search")}
                >
                  搜索目录
                </Button>
              </div>
              <label className="sr-only" htmlFor="brew-installed-kind">
                软件包类型
              </label>
              <select
                className={FIELD_CLASSES}
                id="brew-installed-kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.currentTarget.value as BrewPackageKind | "ALL");
                  setPageNumber(1);
                }}
              >
                <option value="ALL">全部类型</option>
                <option value="FORMULA">Formula</option>
                <option value="CASK">Cask</option>
              </select>
              <label className="sr-only" htmlFor="brew-installed-filter">
                筛选已安装软件
              </label>
              <input
                className={FIELD_CLASSES}
                id="brew-installed-filter"
                type="search"
                maxLength={128}
                placeholder="筛选已安装软件"
                value={filterInput}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setFilterInput(value);
                  if (value.length === 0) clearFilter();
                }}
              />
              <Button size="sm" type="submit">
                筛选
              </Button>
            </form>

            <div className="brew-workspace__body">
              <section
                className="brew-workspace__list"
                aria-labelledby="inventory-list-heading"
              >
                <header className="brew-workspace__pane-heading">
                  <h3 id="inventory-list-heading">已安装软件</h3>
                  <span>
                    {visibleState.status === "ready"
                      ? `${visibleState.page.totalItems} 项`
                      : "本机清单"}
                  </span>
                </header>

                {visibleState.status === "loading" ? (
                  <div className="p-3">
                    <AsyncState kind="loading">正在加载清单…</AsyncState>
                  </div>
                ) : visibleState.status === "error" ? (
                  <div className="p-3">
                    <AsyncState kind="error">
                      {visibleState.error.message}
                    </AsyncState>
                  </div>
                ) : visibleState.page.items.length === 0 ? (
                  <div className="p-3">
                    <AsyncState kind="empty">
                      没有符合条件的软件。
                    </AsyncState>
                  </div>
                ) : (
                  <>
                    <ul role="listbox" aria-label="已安装软件列表">
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
                              onKeyDown={(event) =>
                                moveSelection(event, index)
                              }
                            >
                              <span className="min-w-0">
                                <strong>{item.displayName}</strong>
                                <span>
                                  {item.description ?? item.identifier}
                                </span>
                              </span>
                              <span className="brew-package-row__status">
                                <span>
                                  {item.installedVersions.join(", ") ||
                                    "版本未知"}
                                </span>
                                <StatusBadge
                                  tone={item.outdated ? "warning" : "success"}
                                >
                                  {item.outdated ? "可更新" : "最新"}
                                </StatusBadge>
                              </span>
                            </button>
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
                        disabled={visibleState.page.page <= 1}
                        onClick={() =>
                          setPageNumber((value) => value - 1)
                        }
                      >
                        上一页
                      </Button>
                      <span>
                        {visibleState.page.page} /{" "}
                        {Math.max(visibleState.page.totalPages, 1)}
                      </span>
                      <Button
                        size="sm"
                        disabled={
                          visibleState.page.page >=
                          visibleState.page.totalPages
                        }
                        onClick={() =>
                          setPageNumber((value) => value + 1)
                        }
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
                    idPrefix="brew-installed-package"
                    key={packageKey(selected)}
                    onChanged={handleChanged}
                    onSelectionRemoved={(removed) => {
                      if (packageKey(removed) === selectedKey) {
                        setSelected(undefined);
                      }
                    }}
                    refreshId={refreshId}
                    selected={selected}
                  />
                ) : (
                  <AsyncState kind="empty">
                    选择一个已安装软件包以查看详情与可用操作。
                  </AsyncState>
                )}
              </section>
            </div>
          </div>

          <div className="brew-workspace__search-view" hidden={view !== "search"}>
            <BrewSearch
              onChanged={handleChanged}
              onShowInstalled={() => setView("installed")}
              refreshId={refreshId}
            />
          </div>
        </>
      )}
    </section>
  );
}
