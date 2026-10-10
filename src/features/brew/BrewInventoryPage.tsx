import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
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
  "min-h-control-sm min-w-0 rounded-control border border-border bg-surface px-ui-lg py-ui-sm text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-focus/20";

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
  initialSelection,
  onSelectionChange,
  onOperationChanged,
  refreshId,
  summary,
}: {
  initialSelection?: BrewSearchResult;
  onSelectionChange?: (selection?: BrewSearchResult) => void;
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
  const [selected, setSelected] = useState<BrewSearchResult | undefined>(
    initialSelection,
  );
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

  function selectPackage(selection?: BrewSearchResult) {
    setSelected(selection);
    onSelectionChange?.(selection);
  }

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
    selectPackage(nextSelection);
    buttonRefs.current.get(packageKey(nextSelection))?.focus();
  }

  return (
    <section
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel border border-border bg-surface"
      aria-labelledby="brew-heading"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-ui-3xl border-b border-border px-ui-3xl py-ui-xl">
        <div className="min-w-0">
          <p className="section-kicker">Homebrew 软件管理</p>
          <h2
            className="mt-ui-xs text-xl font-semibold tracking-tight"
            id="brew-heading"
          >
            Homebrew
          </h2>
          {summary.status === "READY" && summary.data.available ? (
            <p className="mt-ui-xs break-all text-xs text-muted-foreground">
              {summary.data.version} · {summary.data.prefix}
            </p>
          ) : (
            <p className="mt-ui-xs text-xs text-muted-foreground">
              本机软件包、远程目录与受控操作
            </p>
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
        <div className="min-h-0 overflow-y-auto px-ui-3xl pb-ui-3xl overscroll-contain">
          <AsyncState kind="loading">正在后台解析 Homebrew…</AsyncState>
        </div>
      ) : summary.status === "ERROR" ? (
        <div className="min-h-0 overflow-y-auto px-ui-3xl pb-ui-3xl overscroll-contain">
          <AsyncState kind="error">
            <span className="break-words [overflow-wrap:anywhere]">
              {summary.error.message}
            </span>
          </AsyncState>
        </div>
      ) : !summary.data.available ? (
        <div className="min-h-0 overflow-y-auto px-ui-3xl pb-ui-3xl overscroll-contain">
          <AsyncState kind="empty">
            未检测到 `/opt/homebrew` 或 `/usr/local` 下的可信 Homebrew。
          </AsyncState>
        </div>
      ) : (
        <>
          <div
            className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden [hidden]:hidden"
            hidden={view !== "installed"}
          >
            <form
              className="flex min-w-0 flex-wrap items-center gap-ui-md border-b border-border bg-surface-muted px-ui-xl py-ui-md"
              onSubmit={(event) => {
                event.preventDefault();
                setPageNumber(1);
                setFilter(filterInput.trim());
              }}
            >
              <div
                className="flex shrink-0 items-center gap-ui-xs"
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
                className={`${FIELD_CLASSES} min-w-40 flex-1`}
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

            <div className="grid min-h-0 grid-rows-[minmax(0,0.85fr)_minmax(0,1.15fr)] overflow-hidden sm:grid-cols-[minmax(17.5rem,0.85fr)_minmax(0,1.15fr)] sm:grid-rows-1">
              <section
                className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-b border-border sm:border-r sm:border-b-0"
                aria-labelledby="inventory-list-heading"
              >
                <header className="flex min-h-[var(--app-row-height-standard)] min-w-0 items-center justify-between gap-ui-lg border-b border-border bg-surface-muted px-ui-xl py-ui-md">
                  <h3
                    className="text-xs font-semibold"
                    id="inventory-list-heading"
                  >
                    已安装软件
                  </h3>
                  <span className="text-xs text-muted-foreground">
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
                      <span className="break-words [overflow-wrap:anywhere]">
                        {visibleState.error.message}
                      </span>
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
                    <ul
                      className="min-h-0 overflow-y-auto overscroll-contain"
                      role="listbox"
                      aria-label={`已安装软件列表，共 ${visibleState.page.totalItems} 项，第 ${visibleState.page.page} / ${Math.max(visibleState.page.totalPages, 1)} 页`}
                    >
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
                              className={classNames(
                                "brew-inventory-row",
                                isSelected && "brew-inventory-row--selected",
                              )}
                              type="button"
                              role="option"
                              aria-label={`${item.displayName}，${item.kind === "FORMULA" ? "Formula" : "Cask"} ${item.identifier}，${item.installedVersions.join(", ") || "版本未知"}，${item.outdated ? "可更新" : "最新"}`}
                              aria-selected={isSelected}
                              tabIndex={isTabStop ? 0 : -1}
                              title={item.displayName}
                              onClick={() => selectPackage(itemSelection)}
                              onKeyDown={(event) =>
                                moveSelection(event, index)
                              }
                            >
                              <span className="min-w-0">
                                <strong className="block truncate text-sm font-semibold">
                                  {item.displayName}
                                </strong>
                                <span className="mt-ui-xs block truncate text-xs text-muted-foreground">
                                  {item.description ?? item.identifier}
                                </span>
                              </span>
                              <span className="flex min-w-0 flex-col items-end gap-ui-xs">
                                <span
                                  className="block max-w-full truncate text-xs text-muted-foreground"
                                  title={
                                    item.installedVersions.join(", ") ||
                                    "版本未知"
                                  }
                                >
                                  {item.installedVersions.join(", ") ||
                                    "版本未知"}
                                </span>
                                <StatusBadge
                                  className="min-h-5 shrink-0 px-ui-sm py-0 text-[10px]"
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
                      className="flex min-h-control-md items-center justify-between gap-ui-md border-t border-border px-ui-lg py-ui-sm text-xs text-muted-foreground"
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
                      <span role="status" aria-live="polite" aria-atomic="true">
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
                className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-ui-xl overscroll-contain"
                aria-label="Homebrew 软件包详情"
              >
                {selected ? (
                  <>
                    {visibleState.status === "ready" && !selectedIsVisible ? (
                      <p className="mb-ui-md break-words rounded-control border border-border bg-surface-muted px-ui-xl py-ui-lg text-xs text-muted-foreground">
                        所选软件包不在当前筛选页；详情与操作结果保持可见。
                      </p>
                    ) : null}
                    <BrewPackageInspector
                      idPrefix="brew-installed-package"
                      key={packageKey(selected)}
                      onChanged={handleChanged}
                      onSelectionRemoved={(removed) => {
                        if (packageKey(removed) === selectedKey) {
                          selectPackage(undefined);
                        }
                      }}
                      refreshId={refreshId}
                      selected={selected}
                    />
                  </>
                ) : (
                  <AsyncState kind="empty">
                    选择一个已安装软件包以查看详情与可用操作。
                  </AsyncState>
                )}
              </section>
            </div>
          </div>

          <div
            className="h-full min-h-0 overflow-hidden [hidden]:hidden"
            hidden={view !== "search"}
          >
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
