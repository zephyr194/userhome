import { useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import {
  executeBrewAction,
  getBrewPackage,
  previewBrewAction,
  searchBrewPackages,
  type BrewPackageAction,
  type BrewPackageDetails as BrewPackageDetailsValue,
  type BrewPackageKind,
  type BrewSearchPage,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  getOperation,
  type OperationDetails,
  type OperationPreview,
} from "../../ipc/operations";
import { BrewActionDialog } from "./BrewActionDialog";
import { BrewPackageDetails } from "./BrewPackageDetails";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; page: BrewSearchPage }
  | { status: "error"; error: AppError };

type DetailsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; details: BrewPackageDetailsValue }
  | { status: "error"; error: AppError };

const SEARCH_INPUT_CLASSES =
  "min-h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

export function BrewSearch({ onChanged }: { onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const [detailsState, setDetailsState] = useState<DetailsState>({
    status: "idle",
  });
  const [preview, setPreview] = useState<OperationPreview>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [busy, setBusy] = useState(false);

  async function runSearch(searchQuery: string, page: number) {
    setSearchState({ status: "loading" });
    setDetailsState({ status: "idle" });
    setPreview(undefined);
    setOperation(undefined);
    setActionError(undefined);
    try {
      const result = await searchBrewPackages({
        query: searchQuery,
        page,
        pageSize: 25,
      });
      setSearchState({ status: "ready", page: result });
    } catch (error) {
      setSearchState({ status: "error", error: decodeAppError(error) });
    }
  }

  async function loadDetails(kind: BrewPackageKind, identifier: string) {
    setDetailsState({ status: "loading" });
    setPreview(undefined);
    setOperation(undefined);
    setActionError(undefined);
    try {
      setDetailsState({
        status: "ready",
        details: await getBrewPackage(kind, identifier),
      });
    } catch (error) {
      setDetailsState({ status: "error", error: decodeAppError(error) });
    }
  }

  async function createPreview(action: BrewPackageAction) {
    if (detailsState.status !== "ready") return;
    setActionError(undefined);
    setOperation(undefined);
    try {
      setPreview(
        await previewBrewAction({
          action,
          kind: detailsState.details.kind,
          identifier: detailsState.details.identifier,
        }),
      );
    } catch (error) {
      setActionError(decodeAppError(error));
    }
  }

  async function confirmAction() {
    if (!preview) return;
    const selectedDetails =
      detailsState.status === "ready" ? detailsState.details : undefined;
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await executeBrewAction(preview.operationId);
      setOperation(result);
      onChanged();
      if (selectedDetails) {
        try {
          setDetailsState({
            status: "ready",
            details: await getBrewPackage(
              selectedDetails.kind,
              selectedDetails.identifier,
            ),
          });
        } catch (error) {
          setActionError(decodeAppError(error));
        }
      }
    } catch (error) {
      setActionError(decodeAppError(error));
      try {
        setOperation(await getOperation(preview.operationId));
      } catch {
        setOperation(undefined);
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const selectedPackage =
    detailsState.status === "ready" ? detailsState.details : undefined;

  return (
    <section
      className="min-w-0 border-b border-border bg-surface-muted/60 px-5 py-5"
      aria-labelledby="brew-search-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            Homebrew 搜索
          </p>
          <h3
            className="mt-1 text-base font-semibold"
            id="brew-search-heading"
          >
            查找 Formula 或 Cask
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          搜索远程目录后选择软件包查看详情
        </p>
      </div>

      <form
        className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const searchQuery = query.trim();
          setActiveQuery(searchQuery);
          void runSearch(searchQuery, 1);
        }}
      >
        <label className="sr-only" htmlFor="brew-package-search">
          搜索词
        </label>
        <input
          className={SEARCH_INPUT_CLASSES}
          id="brew-package-search"
          type="search"
          maxLength={128}
          placeholder="输入软件包名称，例如 caddy"
          required
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          className="w-full sm:w-auto"
          variant="primary"
          type="submit"
          disabled={searchState.status === "loading"}
        >
          {searchState.status === "loading" ? "正在搜索…" : "搜索"}
        </Button>
      </form>

      {searchState.status === "loading" ? (
        <AsyncState kind="loading">正在搜索 Homebrew 目录…</AsyncState>
      ) : searchState.status === "error" ? (
        <AsyncState kind="error">{searchState.error.message}</AsyncState>
      ) : searchState.status === "ready" &&
        searchState.page.items.length === 0 ? (
        <AsyncState kind="empty">没有找到匹配的软件。</AsyncState>
      ) : searchState.status === "ready" ? (
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,0.85fr)_minmax(18rem,1.15fr)]">
          <section
            className="min-w-0 overflow-hidden rounded-md border border-border bg-surface"
            aria-labelledby="brew-search-results-heading"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <h4
                className="text-sm font-semibold"
                id="brew-search-results-heading"
              >
                搜索结果
              </h4>
              <span className="text-xs text-muted-foreground">
                {searchState.page.totalItems} 项
              </span>
            </header>
            <ul
              className="max-h-72 divide-y divide-border overflow-y-auto"
              aria-label="Homebrew 搜索结果"
            >
              {searchState.page.items.map((item) => {
                const selected =
                  selectedPackage?.kind === item.kind &&
                  selectedPackage.identifier === item.identifier;
                return (
                  <li
                    className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5"
                    key={`${item.kind}-${item.identifier}`}
                  >
                    <span className="min-w-0">
                      <strong className="block truncate font-mono text-xs font-semibold">
                        {item.identifier}
                      </strong>
                      <StatusBadge className="mt-1">
                        {item.kind === "FORMULA" ? "Formula" : "Cask"}
                      </StatusBadge>
                    </span>
                    <Button
                      size="sm"
                      variant={selected ? "primary" : "secondary"}
                      onClick={() =>
                        void loadDetails(item.kind, item.identifier)
                      }
                    >
                      {selected ? "已选择" : "查看详情"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <nav
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5"
              aria-label="搜索结果分页"
            >
              <Button
                size="sm"
                disabled={searchState.page.page <= 1}
                onClick={() =>
                  void runSearch(activeQuery, searchState.page.page - 1)
                }
              >
                上一页
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {searchState.page.page} /{" "}
                {Math.max(searchState.page.totalPages, 1)}
              </span>
              <Button
                size="sm"
                disabled={
                  searchState.page.page >= searchState.page.totalPages
                }
                onClick={() =>
                  void runSearch(activeQuery, searchState.page.page + 1)
                }
              >
                下一页
              </Button>
            </nav>
          </section>

          <div className="min-w-0">
            {detailsState.status === "loading" ? (
              <AsyncState kind="loading">正在加载详情…</AsyncState>
            ) : detailsState.status === "error" ? (
              <AsyncState kind="error">
                {detailsState.error.message}
              </AsyncState>
            ) : detailsState.status === "ready" ? (
              <BrewPackageDetails
                details={detailsState.details}
                onAction={(action) => void createPreview(action)}
              />
            ) : (
              <div
                className="grid min-h-40 place-items-center rounded-md border border-dashed border-border bg-surface px-4 text-center text-sm text-muted-foreground"
                role="status"
              >
                选择一个搜索结果以查看版本、安装状态和可用操作。
              </div>
            )}
          </div>
        </div>
      ) : null}

      {actionError && !preview ? (
        <div className="mt-4">
          <AsyncState kind="error">{actionError.message}</AsyncState>
        </div>
      ) : null}
      {preview ? (
        <BrewActionDialog
          preview={preview}
          operation={operation}
          error={actionError}
          busy={busy}
          onConfirm={() => void confirmAction()}
          onCancel={() => {
            setPreview(undefined);
            setOperation(undefined);
            setActionError(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
