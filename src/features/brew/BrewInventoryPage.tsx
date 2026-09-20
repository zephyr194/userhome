import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, Panel, StatusBadge } from "../../components/ui";
import type { ModuleSnapshot, BrewInventorySummary } from "../../ipc/discovery";
import {
  listBrewPackages,
  type BrewPackageKind,
  type BrewPackagePage,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import { BrewSearch } from "./BrewSearch";

type InventoryState =
  | { status: "loading"; requestKey: string }
  | { status: "ready"; requestKey: string; page: BrewPackagePage }
  | { status: "error"; requestKey: string; error: AppError };

const FIELD_CLASSES =
  "min-h-9 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function BrewInventoryPage({
  onOperationChanged,
  refreshId,
  summary,
}: {
  onOperationChanged?: () => void;
  refreshId?: string;
  summary: ModuleSnapshot<BrewInventorySummary>;
}) {
  const [kind, setKind] = useState<BrewPackageKind | "ALL">("ALL");
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [mutationRefresh, setMutationRefresh] = useState(0);
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

  return (
    <Panel
      className="min-w-0 overflow-hidden"
      aria-labelledby="brew-heading"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            Homebrew 软件管理
          </p>
          <h2
            className="mt-1 text-xl font-semibold tracking-tight"
            id="brew-heading"
          >
            已安装的软件
          </h2>
          {summary.status === "READY" && summary.data.available ? (
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {summary.data.version} · {summary.data.prefix}
            </p>
          ) : null}
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
        <div className="px-5 pb-5">
          <AsyncState kind="loading">正在后台解析 Homebrew…</AsyncState>
        </div>
      ) : summary.status === "ERROR" ? (
        <div className="px-5 pb-5">
          <AsyncState kind="error">{summary.error.message}</AsyncState>
        </div>
      ) : !summary.data.available ? (
        <div className="px-5 pb-5">
          <AsyncState kind="empty">
            未检测到 `/opt/homebrew` 或 `/usr/local` 下的可信 Homebrew。
          </AsyncState>
        </div>
      ) : (
        <>
          <BrewSearch
            onChanged={() => {
              setMutationRefresh((value) => value + 1);
              setPageNumber(1);
              onOperationChanged?.();
            }}
          />

          <section
            className="min-w-0 px-5 py-5"
            aria-labelledby="inventory-list-heading"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                  本机清单
                </p>
                <h3
                  className="mt-1 text-base font-semibold"
                  id="inventory-list-heading"
                >
                  已安装 Formula 与 Cask
                </h3>
              </div>
              {visibleState.status === "ready" ? (
                <p className="text-xs text-muted-foreground">
                  共 {visibleState.page.totalItems} 项
                </p>
              ) : null}
            </div>

            <form
              className="mt-4 grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                setPageNumber(1);
                setFilter(filterInput.trim());
              }}
            >
              <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                类型
                <select
                  className={FIELD_CLASSES}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as BrewPackageKind | "ALL");
                    setPageNumber(1);
                  }}
                >
                  <option value="ALL">全部类型</option>
                  <option value="FORMULA">Formula</option>
                  <option value="CASK">Cask</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                筛选已安装软件
                <input
                  className={FIELD_CLASSES}
                  type="search"
                  maxLength={128}
                  placeholder="按名称筛选"
                  value={filterInput}
                  onChange={(event) => setFilterInput(event.target.value)}
                />
              </label>
              <Button className="w-full sm:w-auto" type="submit">
                应用筛选
              </Button>
            </form>

            {visibleState.status === "loading" ? (
              <AsyncState kind="loading">正在加载清单…</AsyncState>
            ) : visibleState.status === "error" ? (
              <AsyncState kind="error">
                {visibleState.error.message}
              </AsyncState>
            ) : visibleState.page.items.length === 0 ? (
              <AsyncState kind="empty">没有符合条件的软件。</AsyncState>
            ) : (
              <>
                <ul
                  className="mt-4 min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border"
                  aria-label="已安装软件列表"
                >
                  {visibleState.page.items.map((item) => (
                    <li
                      className="grid min-w-0 gap-2 bg-surface px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      key={`${item.kind}-${item.identifier}`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <strong className="min-w-0 break-words text-sm font-semibold">
                            {item.displayName}
                          </strong>
                          <StatusBadge>
                            {item.kind === "FORMULA" ? "Formula" : "Cask"}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {item.description ?? item.identifier}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:max-w-48 sm:justify-end">
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {item.installedVersions.join(", ") || "版本未知"}
                        </span>
                        <StatusBadge tone={item.outdated ? "warning" : "success"}>
                          {item.outdated ? "可更新" : "已是最新"}
                        </StatusBadge>
                      </div>
                    </li>
                  ))}
                </ul>
                <nav
                  className="mt-4 flex flex-wrap items-center justify-between gap-3"
                  aria-label="已安装软件分页"
                >
                  <Button
                    size="sm"
                    disabled={visibleState.page.page <= 1}
                    onClick={() => setPageNumber((value) => value - 1)}
                  >
                    上一页
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    第 {visibleState.page.page} /{" "}
                    {Math.max(visibleState.page.totalPages, 1)} 页
                  </span>
                  <Button
                    size="sm"
                    disabled={
                      visibleState.page.page >= visibleState.page.totalPages
                    }
                    onClick={() => setPageNumber((value) => value + 1)}
                  >
                    下一页
                  </Button>
                </nav>
              </>
            )}
          </section>
        </>
      )}
    </Panel>
  );
}
