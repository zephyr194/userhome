import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
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
    <section className="brew-panel" aria-labelledby="brew-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">只读软件清单</p>
          <h2 id="brew-heading">已安装的软件</h2>
        </div>
        {summary.status === "READY" && summary.data.available ? (
          <p>
            Formula {summary.data.formulaCount} · Cask {summary.data.caskCount}
          </p>
        ) : null}
      </div>

      {summary.status === "LOADING" ? (
        <AsyncState kind="loading">正在后台解析 Homebrew…</AsyncState>
      ) : summary.status === "ERROR" ? (
        <AsyncState kind="error">{summary.error.message}</AsyncState>
      ) : !summary.data.available ? (
        <AsyncState kind="empty">
          未检测到 `/opt/homebrew` 或 `/usr/local` 下的可信 Homebrew。
        </AsyncState>
      ) : (
        <>
          <p className="panel-note">
            {summary.data.version} · {summary.data.prefix}
          </p>
          <BrewSearch
            onChanged={() => {
              setMutationRefresh((value) => value + 1);
              setPageNumber(1);
              onOperationChanged?.();
            }}
          />
          <form
            className="inventory-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setPageNumber(1);
              setFilter(filterInput.trim());
            }}
          >
            <label>
              类型
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as BrewPackageKind | "ALL");
                  setPageNumber(1);
                }}
              >
                <option value="ALL">全部</option>
                <option value="FORMULA">Formula</option>
                <option value="CASK">Cask</option>
              </select>
            </label>
            <label>
              筛选
              <input
                type="search"
                maxLength={128}
                value={filterInput}
                onChange={(event) => setFilterInput(event.target.value)}
              />
            </label>
            <button className="secondary-button" type="submit">
              应用
            </button>
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
              <ul className="inventory-list">
                {visibleState.page.items.map((item) => (
                  <li key={`${item.kind}-${item.identifier}`}>
                    <div>
                      <strong>{item.displayName}</strong>
                      <span className="package-kind">
                        {item.kind === "FORMULA" ? "Formula" : "Cask"}
                      </span>
                    </div>
                    <p>{item.description ?? item.identifier}</p>
                    <small>
                      {item.installedVersions.join(", ") || "版本未知"}
                      {item.outdated ? " · 可更新" : ""}
                    </small>
                  </li>
                ))}
              </ul>
              <div className="pagination" aria-label="分页">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={visibleState.page.page <= 1}
                  onClick={() => setPageNumber((value) => value - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {visibleState.page.page} /{" "}
                  {Math.max(visibleState.page.totalPages, 1)} 页
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    visibleState.page.page >= visibleState.page.totalPages
                  }
                  onClick={() => setPageNumber((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
