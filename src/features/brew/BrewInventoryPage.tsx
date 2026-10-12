import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, SelectField, StatusBadge, TextField } from "../../components/ui";
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
import { BrewInventoryList } from "./BrewInventoryList";
import { BrewPackageInspector } from "./BrewPackageDetails";
import { BrewSearch } from "./BrewSearch";
import { packageKey } from "./packageKey";

type InventoryState =
  | { status: "loading"; requestKey: string }
  | { status: "ready"; requestKey: string; page: BrewPackagePage }
  | { status: "error"; requestKey: string; error: AppError };

type BrewView = "installed" | "search";


/**
 * Single Homebrew workbench: one context toolbar, an installed/search list and
 * a persistent detail pane. The page owns no hero or second main title — the
 * shell toolbar already carries the route identity.
 */
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

  return (
    <section className="brew-workspace" id="brew-workspace" aria-label="Homebrew 软件">
      <div className="brew-workspace__header">
        <div className="min-w-0">
          {summary.status === "READY" && summary.data.available ? (
            <p className="break-all text-xs text-muted-foreground">
              {summary.data.version} · {summary.data.prefix}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
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
      </div>

      {summary.status === "LOADING" ? (
        <div className="brew-workspace__provider-state">
          <AsyncState kind="loading">正在后台解析 Homebrew…</AsyncState>
        </div>
      ) : summary.status === "ERROR" ? (
        <div className="brew-workspace__provider-state">
          <AsyncState kind="error">
            <span className="break-words [overflow-wrap:anywhere]">
              {summary.error.message}
            </span>
          </AsyncState>
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
              <SelectField
                label="软件包类型"
                value={kind}
                options={[
                  { value: "ALL", label: "全部类型" },
                  { value: "FORMULA", label: "Formula" },
                  { value: "CASK", label: "Cask" },
                ]}
                onValueChange={(value) => {
                  setKind(value as BrewPackageKind | "ALL");
                  setPageNumber(1);
                }}
              />
              <TextField
                label="筛选已安装软件"
                type="search"
                maxLength={128}
                placeholder="筛选已安装软件"
                value={filterInput}
                onValueChange={(value) => {
                  setFilterInput(value);
                  if (value.length === 0) clearFilter();
                }}
              />
              <Button size="sm" type="submit">
                筛选
              </Button>
            </form>

            <div className="brew-workspace__body">
              <BrewInventoryList
                onPageChange={setPageNumber}
                onSelect={selectPackage}
                selected={selected}
                state={visibleState}
              />

              <section
                className="brew-workspace__detail"
                aria-label="Homebrew 软件包详情"
              >
                {selected ? (
                  <>
                    {visibleState.status === "ready" && !selectedIsVisible ? (
                      <p className="mb-ui-md break-words rounded-control border border-border bg-surface-muted px-ui-xl py-ui-lg text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
            className="brew-workspace__search-view"
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
