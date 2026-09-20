import { useState } from "react";
import {
  executeBrewAction,
  getBrewPackage,
  previewBrewAction,
  searchBrewPackages,
  type BrewPackageAction,
  type BrewPackageDetails as BrewPackageDetailsValue,
  type BrewSearchPage,
} from "../../ipc/brew";
import { decodeAppError, type AppError } from "../../ipc/core";
import { getOperation, type OperationDetails, type OperationPreview } from "../../ipc/operations";
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

export function BrewSearch({ onChanged }: { onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [detailsState, setDetailsState] = useState<DetailsState>({ status: "idle" });
  const [preview, setPreview] = useState<OperationPreview>();
  const [operation, setOperation] = useState<OperationDetails>();
  const [actionError, setActionError] = useState<AppError>();
  const [busy, setBusy] = useState(false);

  async function submitSearch() {
    setSearchState({ status: "loading" });
    setDetailsState({ status: "idle" });
    setPreview(undefined);
    try {
      const page = await searchBrewPackages({
        query: query.trim(),
        page: 1,
        pageSize: 25,
      });
      setSearchState({ status: "ready", page });
    } catch (error) {
      setSearchState({ status: "error", error: decodeAppError(error) });
    }
  }

  async function loadDetails(
    kind: "FORMULA" | "CASK",
    identifier: string,
  ) {
    setDetailsState({ status: "loading" });
    setPreview(undefined);
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
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await executeBrewAction(preview.operationId);
      setOperation(result);
      onChanged();
      if (detailsState.status === "ready") {
        await loadDetails(
          detailsState.details.kind,
          detailsState.details.identifier,
        );
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

  return (
    <section className="brew-search" aria-labelledby="brew-search-heading">
      <p className="section-kicker">Homebrew 搜索</p>
      <h3 id="brew-search-heading">查找 Formula 或 Cask</h3>
      <form
        className="inventory-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void submitSearch();
        }}
      >
        <label>
          搜索词
          <input
            type="search"
            maxLength={128}
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={searchState.status === "loading"}
        >
          搜索
        </button>
      </form>
      {searchState.status === "loading" ? <p role="status">正在搜索…</p> : null}
      {searchState.status === "error" ? (
        <p role="alert">{searchState.error.message}</p>
      ) : null}
      {searchState.status === "ready" ? (
        searchState.page.items.length === 0 ? (
          <p>没有找到匹配的软件。</p>
        ) : (
          <ul className="search-results">
            {searchState.page.items.map((item) => (
              <li key={`${item.kind}-${item.identifier}`}>
                <span>
                  <strong>{item.identifier}</strong>
                  <small>{item.kind === "FORMULA" ? "Formula" : "Cask"}</small>
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadDetails(item.kind, item.identifier)}
                >
                  查看详情
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {detailsState.status === "loading" ? <p role="status">正在加载详情…</p> : null}
      {detailsState.status === "error" ? (
        <p role="alert">{detailsState.error.message}</p>
      ) : null}
      {detailsState.status === "ready" ? (
        <BrewPackageDetails
          details={detailsState.details}
          onAction={(action) => void createPreview(action)}
        />
      ) : null}
      {actionError && !preview ? <p role="alert">{actionError.message}</p> : null}
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
