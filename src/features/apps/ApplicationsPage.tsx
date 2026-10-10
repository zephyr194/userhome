import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ApplicationsState } from "../../app/shellState";
import type { StaleApplicationReason } from "../../app/applicationNavigation";
import type { ApplicationsScope } from "../../app/routeDefinitions";
import { AsyncState } from "../../components/AsyncState";
import { Button, StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import {
  CATALOG_PAGE_SIZE,
  getManagedApp,
  queryManagedApps,
  type ManagedAppCapability,
  type ManagedAppCatalog,
  type ManagedAppCoverageClass,
  type ManagedAppFacets,
  type ManagedAppPage,
  type ManagedAppSummary,
} from "../../ipc/catalog";
import { decodeAppError, type AppError } from "../../ipc/core";
import type {
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import type { PreferredEditorMode } from "../../ipc/settings";
import { ApplicationIcon } from "./ApplicationIcon";
import { CatalogCoverageSummary } from "./CatalogCoverageSummary";
import { ConfigWorkspace } from "./ConfigWorkspace";
import { UnmanagedCandidates } from "./UnmanagedCandidates";

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; page: ManagedAppPage }
  | { status: "error"; error: AppError };

type DetailState =
  | { status: "idle" }
  | { status: "loading"; applicationId: string }
  | { status: "ready"; application: ManagedAppSummary }
  | { status: "error"; applicationId: string; error: AppError };

interface CatalogResult {
  requestKey: string;
  state: CatalogState;
}

interface DetailResult {
  applicationId: string;
  state:
    | { status: "ready"; application: ManagedAppSummary }
    | { status: "error"; applicationId: string; error: AppError };
}

export interface ApplicationBrowseState {
  query: string;
  category?: string;
  coverageClass?: ManagedAppCoverageClass;
  capability?: ManagedAppCapability;
  detected?: boolean;
  page: number;
  scrollTop: number;
}

const COVERAGE_PRESENTATION: Record<
  ManagedAppCoverageClass,
  { label: string; tone: "neutral" | "success" | "warning" }
> = {
  MANAGED_WRITABLE: { label: "受管可写", tone: "success" },
  MANAGED_READ_ONLY: { label: "受管只读", tone: "neutral" },
  DETECTED_UNSUPPORTED: { label: "暂不支持", tone: "warning" },
  EXCLUDED: { label: "已排除", tone: "warning" },
};

const COVERAGE_FILTERS: readonly {
  value: ManagedAppCoverageClass;
  label: string;
}[] = [
  { value: "MANAGED_WRITABLE", label: "受管可写" },
  { value: "MANAGED_READ_ONLY", label: "受管只读" },
  { value: "DETECTED_UNSUPPORTED", label: "已发现，暂不支持" },
  { value: "EXCLUDED", label: "已排除" },
];

const CAPABILITY_LABELS: Record<ManagedAppCapability, string> = {
  DETECT: "可检测",
  READ_CONFIG: "可读取配置",
  WRITE_CONFIG: "可修改配置",
  MANAGE_SERVICE: "可管理服务",
};

function facetsFromCatalog(catalog: ManagedAppCatalog): ManagedAppFacets {
  return {
    categories: [
      ...new Set(
        catalog.applications.map(
          (application) => application.presentation.category,
        ),
      ),
    ].sort(),
    coverageClasses: [
      ...new Set(
        catalog.applications.map(
          (application) => application.coverageClass,
        ),
      ),
    ],
    capabilities: [
      ...new Set(
        catalog.applications.flatMap(
          (application) => application.capabilities,
        ),
      ),
    ],
  };
}

function pageFromCatalog(catalog: ManagedAppCatalog): ManagedAppPage {
  const applications = catalog.applications.slice(0, CATALOG_PAGE_SIZE);
  return {
    schemaVersion: catalog.schemaVersion,
    coveragePolicy: catalog.coveragePolicy,
    facets: facetsFromCatalog(catalog),
    pagination: {
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      totalItems: catalog.applications.length,
      totalPages: Math.ceil(catalog.applications.length / CATALOG_PAGE_SIZE),
    },
    applications,
  };
}

function catalogStateFromShell(state: ApplicationsState): CatalogState {
  if (state.status !== "ready") {
    return state;
  }
  return {
    status: "ready",
    page: "page" in state ? state.page : pageFromCatalog(state.catalog),
  };
}

function catalogKey(applicationId: string): string {
  return `catalog:${applicationId}`;
}

function candidateKey(candidateId: string): string {
  return `candidate:${candidateId}`;
}

function selectedCatalogId(key?: string): string | undefined {
  return key?.startsWith("catalog:")
    ? key.slice("catalog:".length)
    : undefined;
}

function selectedCandidateId(key?: string): string | undefined {
  return key?.startsWith("candidate:")
    ? key.slice("candidate:".length)
    : undefined;
}

function pageRange(page: ManagedAppPage): string {
  if (page.pagination.totalItems === 0) {
    return "0";
  }
  const start =
    (page.pagination.page - 1) * page.pagination.pageSize + 1;
  const end = start + page.applications.length - 1;
  return `${start}–${end}`;
}

function isDefaultBrowseRequest(
  query: string,
  category: string | undefined,
  coverageClass: ManagedAppCoverageClass | undefined,
  capability: ManagedAppCapability | undefined,
  detected: boolean | undefined,
  page: number,
): boolean {
  return (
    query.length === 0 &&
    category === undefined &&
    coverageClass === undefined &&
    capability === undefined &&
    detected === undefined &&
    page === 1
  );
}

function candidateList(
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>,
): readonly UnmanagedCandidate[] {
  return candidates.status === "READY" ? candidates.data : [];
}

function ApplicationsWorkspace({
  candidates,
  detectedAppIds,
  detectionError,
  initialCapability,
  initialCategory,
  initialCoverage,
  initialDetected,
  initialPage,
  initialQuery,
  initialScrollTop,
  initialSelectedConfigIds,
  initialSelectedKey,
  onBrowseStateChange,
  onSelectedConfigChange,
  onSelectedKeyChange,
  onOperationChanged,
  preferredEditorMode,
  refreshId,
  state,
}: ApplicationsPageProps) {
  const initialCatalogState = catalogStateFromShell(state);
  const initialCatalogPage =
    initialCatalogState.status === "ready"
      ? initialCatalogState.page
      : undefined;
  const initialApplication =
    initialCatalogPage?.applications.find(
      (application) =>
        catalogKey(application.id) === initialSelectedKey,
    ) ?? initialCatalogPage?.applications[0];
  const [catalogResult, setCatalogResult] = useState<CatalogResult>({
    requestKey: "",
    state: initialCatalogState,
  });
  const [detailResult, setDetailResult] = useState<DetailResult | undefined>(
    initialApplication
      ? {
          applicationId: initialApplication.id,
          state: { status: "ready", application: initialApplication },
        }
      : undefined,
  );
  const [selectedKey, setSelectedKey] = useState(
    initialSelectedKey ??
      (initialApplication ? catalogKey(initialApplication.id) : undefined),
  );
  const [query, setQuery] = useState(initialQuery ?? "");
  const [category, setCategory] = useState<string | undefined>(
    initialCategory,
  );
  const [coverageClass, setCoverageClass] = useState<
    ManagedAppCoverageClass | undefined
  >(initialCoverage);
  const [capability, setCapability] = useState<
    ManagedAppCapability | undefined
  >(initialCapability);
  const [detected, setDetected] = useState<boolean | undefined>(
    initialDetected,
  );
  const [page, setPage] = useState(initialPage ?? 1);
  const [scrollTop, setScrollTop] = useState(initialScrollTop ?? 0);
  const [preferredRowIndex, setPreferredRowIndex] = useState(0);
  const [selectedConfigIds, setSelectedConfigIds] = useState<
    Record<string, string | undefined>
  >(initialSelectedConfigIds ?? {});
  const pageRequestGeneration = useRef(0);
  const detailRequestGeneration = useRef(0);
  const pendingFocus = useRef(false);
  const listHasFocus = useRef(false);
  const catalogListRef = useRef<HTMLElement>(null);
  const catalogButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedKeyRef = useRef(selectedKey);
  const scrollTopRef = useRef(scrollTop);
  const selectedConfigChangeRef = useRef(onSelectedConfigChange);
  const browseStateChangeRef = useRef(onBrowseStateChange);
  const detectedIdsKey = detectedAppIds?.join("\0");
  const stableDetectedAppIds = useMemo(
    () =>
      detectedIdsKey === undefined
        ? undefined
        : detectedIdsKey.length === 0
          ? []
          : detectedIdsKey.split("\0"),
    [detectedIdsKey],
  );
  const detectedIdSet = useMemo(
    () => new Set(stableDetectedAppIds ?? []),
    [stableDetectedAppIds],
  );
  const unmanagedCandidates = useMemo(
    () => candidateList(candidates),
    [candidates],
  );
  const defaultRequest = isDefaultBrowseRequest(
    query,
    category,
    coverageClass,
    capability,
    detected,
    page,
  );
  const requestKey = JSON.stringify({
    query,
    category,
    coverageClass,
    capability,
    detected,
    detectedIdsKey,
    page,
    refreshId,
  });
  const providerError =
    !defaultRequest && state.status === "error"
      ? state.error
      : undefined;
  const queryWaiting =
    !defaultRequest &&
    !providerError &&
    !detectionError &&
    (state.status === "loading" ||
      (detected !== undefined && stableDetectedAppIds === undefined));
  const detectionFilterError =
    detected !== undefined ? detectionError : undefined;
  const catalogState: CatalogState = defaultRequest
    ? catalogStateFromShell(state)
    : providerError
      ? { status: "error", error: providerError }
      : detectionFilterError
        ? { status: "error", error: detectionFilterError }
        : queryWaiting || catalogResult.requestKey !== requestKey
          ? { status: "loading" }
          : catalogResult.state;
  const catalogPage =
    catalogState.status === "ready" ? catalogState.page : undefined;
  const catalogApplications = useMemo(
    () => catalogPage?.applications ?? [],
    [catalogPage],
  );
  const groupedApplications = useMemo(
    () =>
      [
        ...new Set(
          catalogApplications.map(
            (application) => application.presentation.category,
          ),
        ),
      ].map((groupCategory) => ({
        category: groupCategory,
        applications: catalogApplications
          .map((application, index) => ({ application, index }))
          .filter(
            ({ application }) =>
              application.presentation.category === groupCategory,
          ),
      })),
    [catalogApplications],
  );
  const currentCatalogId = selectedCatalogId(selectedKey);
  const currentCandidateId = selectedCandidateId(selectedKey);
  const selectedCandidate = unmanagedCandidates.find(
    (candidate) => candidate.candidateId === currentCandidateId,
  );
  const fallbackApplication =
    catalogApplications.find(
      (application) => application.id === currentCatalogId,
    ) ??
    catalogApplications[
      Math.min(
        preferredRowIndex,
        Math.max(catalogApplications.length - 1, 0),
      )
    ];
  const effectiveSelectedKey = selectedCandidate
    ? selectedKey
    : fallbackApplication
      ? catalogKey(fallbackApplication.id)
      : catalogState.status === "ready"
        ? undefined
        : selectedKey;
  const effectiveCatalogId = selectedCatalogId(effectiveSelectedKey);
  const detailState: DetailState = effectiveCatalogId
    ? detailResult?.applicationId === effectiveCatalogId
      ? detailResult.state
      : { status: "loading", applicationId: effectiveCatalogId }
    : { status: "idle" };
  const selectedIndex = Math.max(
    0,
    catalogApplications.findIndex(
      (application) => application.id === effectiveCatalogId,
    ),
  );

  useEffect(() => {
    selectedConfigChangeRef.current = onSelectedConfigChange;
  }, [onSelectedConfigChange]);

  useEffect(() => {
    browseStateChangeRef.current = onBrowseStateChange;
  }, [onBrowseStateChange]);

  const reconcilePageSelection = useCallback(
    (nextPage: ManagedAppPage) => {
      const selectedCandidateIdentifier = selectedCandidateId(
        selectedKeyRef.current,
      );
      if (
        selectedCandidateIdentifier &&
        unmanagedCandidates.some(
          (candidate) =>
            candidate.candidateId === selectedCandidateIdentifier,
        )
      ) {
        return;
      }
      const selectedApplicationIdentifier = selectedCatalogId(
        selectedKeyRef.current,
      );
      const nextApplication =
        nextPage.applications.find(
          (application) =>
            application.id === selectedApplicationIdentifier,
        ) ??
        nextPage.applications[
          Math.min(
            preferredRowIndex,
            Math.max(nextPage.applications.length - 1, 0),
          )
        ];
      const nextKey = nextApplication
        ? catalogKey(nextApplication.id)
        : undefined;
      if (nextKey !== selectedKeyRef.current) {
        selectedKeyRef.current = nextKey;
        setSelectedKey(nextKey);
        onSelectedKeyChange?.(nextKey);
      }
      if (pendingFocus.current && nextKey) {
        pendingFocus.current = false;
        requestAnimationFrame(() =>
          catalogButtonRefs.current.get(nextKey)?.focus(),
        );
      }
    },
    [
      onSelectedKeyChange,
      preferredRowIndex,
      unmanagedCandidates,
    ],
  );

  useEffect(() => {
    browseStateChangeRef.current?.({
      query,
      category,
      coverageClass,
      capability,
      detected,
      page,
      scrollTop,
    });
  }, [
    capability,
    category,
    coverageClass,
    detected,
    page,
    query,
    scrollTop,
  ]);

  useEffect(() => {
    if (defaultRequest) {
      const shellCatalogState = catalogStateFromShell(state);
      if (shellCatalogState.status === "ready") {
        reconcilePageSelection(shellCatalogState.page);
      }
    }
  }, [defaultRequest, reconcilePageSelection, state]);

  useEffect(() => {
    const generation = ++pageRequestGeneration.current;
    if (
      defaultRequest ||
      queryWaiting ||
      providerError ||
      detectionFilterError
    ) {
      return;
    }

    pendingFocus.current = listHasFocus.current;
    void queryManagedApps({
      query,
      category,
      coverageClass,
      capability,
      detected,
      detectedAppIds: stableDetectedAppIds,
      page,
    })
      .then((nextPage) => {
        if (pageRequestGeneration.current === generation) {
          reconcilePageSelection(nextPage);
          setCatalogResult({
            requestKey,
            state: { status: "ready", page: nextPage },
          });
        }
      })
      .catch((error) => {
        if (pageRequestGeneration.current === generation) {
          const pageError = decodeAppError(error);
          if (pageError.code === "INVALID_INPUT" && page > 1) {
            setPreferredRowIndex(0);
            pendingFocus.current = listHasFocus.current;
            setPage(1);
            scrollTopRef.current = 0;
            setScrollTop(0);
            return;
          }
          setCatalogResult({
            requestKey,
            state: {
              status: "error",
              error: pageError,
            },
          });
        }
      });
  }, [
    capability,
    category,
    coverageClass,
    detected,
    detectedIdsKey,
    detectionFilterError,
    page,
    providerError,
    queryWaiting,
    query,
    reconcilePageSelection,
    refreshId,
    requestKey,
    stableDetectedAppIds,
    defaultRequest,
  ]);

  useEffect(() => {
    const applicationId = effectiveCatalogId;
    const generation = ++detailRequestGeneration.current;
    if (!applicationId) {
      return;
    }

    void getManagedApp(applicationId)
      .then((application) => {
        if (detailRequestGeneration.current === generation) {
          setDetailResult({
            applicationId,
            state: { status: "ready", application },
          });
        }
      })
      .catch((error) => {
        if (detailRequestGeneration.current === generation) {
          setDetailResult({
            applicationId,
            state: {
              status: "error",
              applicationId,
              error: decodeAppError(error),
            },
          });
        }
      });
  }, [effectiveCatalogId, refreshId]);

  useLayoutEffect(() => {
    if (catalogListRef.current) {
      catalogListRef.current.scrollTop = scrollTopRef.current;
    }
  }, [catalogPage]);

  const updateConfigSelection = useCallback(
    (applicationId: string, configId?: string) => {
      setSelectedConfigIds((current) => {
        if (current[applicationId] === configId) {
          return current;
        }
        if (configId === undefined) {
          const next = { ...current };
          delete next[applicationId];
          selectedConfigChangeRef.current?.(applicationId, undefined);
          return next;
        }
        selectedConfigChangeRef.current?.(applicationId, configId);
        return { ...current, [applicationId]: configId };
      });
    },
    [],
  );

  function resetToFirstPage() {
    setPreferredRowIndex(0);
    pendingFocus.current = listHasFocus.current;
    setPage(1);
    scrollTopRef.current = 0;
    setScrollTop(0);
  }

  function selectCatalogApplication(
    application: ManagedAppSummary,
    focus = false,
  ) {
    const key = catalogKey(application.id);
    selectedKeyRef.current = key;
    setSelectedKey(key);
    const index = catalogApplications.findIndex(
      (candidate) => candidate.id === application.id,
    );
    if (index >= 0) {
      setPreferredRowIndex(index);
    }
    onSelectedKeyChange?.(key);
    if (focus) {
      catalogButtonRefs.current.get(key)?.focus();
    }
  }

  function selectCandidate(candidate: UnmanagedCandidate) {
    const key = candidateKey(candidate.candidateId);
    selectedKeyRef.current = key;
    setSelectedKey(key);
    onSelectedKeyChange?.(undefined);
  }

  function navigatePage(targetPage: number, rowIndex = selectedIndex) {
    if (
      !catalogPage ||
      targetPage < 1 ||
      targetPage > catalogPage.pagination.totalPages ||
      targetPage === catalogPage.pagination.page
    ) {
      return;
    }
    setPreferredRowIndex(rowIndex);
    pendingFocus.current = listHasFocus.current;
    if (
      targetPage === 1 &&
      isDefaultBrowseRequest(
        query,
        category,
        coverageClass,
        capability,
        detected,
        targetPage,
      )
    ) {
      const shellCatalogState = catalogStateFromShell(state);
      if (shellCatalogState.status === "ready") {
        reconcilePageSelection(shellCatalogState.page);
      }
    }
    setPage(targetPage);
    scrollTopRef.current = 0;
    setScrollTop(0);
  }

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    if (!catalogPage) {
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      navigatePage(
        catalogPage.pagination.page +
          (event.key === "PageUp" ? -1 : 1),
        currentIndex,
      );
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = Math.min(
        currentIndex + 1,
        catalogApplications.length - 1,
      );
    } else if (event.key === "ArrowUp") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = catalogApplications.length - 1;
    }
    if (nextIndex === undefined || nextIndex === currentIndex) {
      return;
    }

    event.preventDefault();
    selectCatalogApplication(catalogApplications[nextIndex], true);
  }

  const facets =
    catalogPage?.facets ??
    (initialCatalogPage?.facets ?? {
      categories: [],
      coverageClasses: [],
      capabilities: [],
    });
  const totalItems = catalogPage?.pagination.totalItems;

  return (
    <section
      className="applications-workspace"
      aria-labelledby="applications-heading"
    >
      <header className="applications-workspace__header">
        <div>
          <p className="section-kicker">
            {catalogPage
              ? `受管目录 v${catalogPage.schemaVersion}`
              : "受管目录"}
          </p>
          <h2 id="applications-heading">Applications</h2>
          <p>目录筛选由本机 Rust provider 执行；未受管候选保持只读隔离。</p>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <strong className="block text-sm text-foreground">
            {totalItems === undefined ? "—" : `${totalItems} 项`}
          </strong>
          <span role="status" aria-live="polite" aria-atomic="true">
            {catalogPage
              ? `当前显示 ${pageRange(catalogPage)}`
              : "目录待就绪"}
          </span>
        </div>
      </header>

      {catalogPage ? <CatalogCoverageSummary catalog={catalogPage} /> : null}

      <div className="applications-workspace__filters" aria-label="应用筛选">
        <label className="min-w-0 flex-1">
          <span>搜索</span>
          <input
            type="search"
            maxLength={256}
            value={query}
            placeholder="名称、说明、ID、格式或安全路径别名"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              resetToFirstPage();
            }}
          />
        </label>
        <label>
          <span>分类</span>
          <select
            value={category ?? "ALL"}
            onChange={(event) => {
              setCategory(
                event.currentTarget.value === "ALL"
                  ? undefined
                  : event.currentTarget.value,
              );
              resetToFirstPage();
            }}
          >
            <option value="ALL">全部分类</option>
            {facets.categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>覆盖</span>
          <select
            value={coverageClass ?? "ALL"}
            onChange={(event) => {
              setCoverageClass(
                event.currentTarget.value === "ALL"
                  ? undefined
                  : (event.currentTarget
                      .value as ManagedAppCoverageClass),
              );
              resetToFirstPage();
            }}
          >
            <option value="ALL">全部覆盖级别</option>
            {COVERAGE_FILTERS.filter((filter) =>
              facets.coverageClasses.includes(filter.value),
            ).map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>能力</span>
          <select
            value={capability ?? "ALL"}
            onChange={(event) => {
              setCapability(
                event.currentTarget.value === "ALL"
                  ? undefined
                  : (event.currentTarget.value as ManagedAppCapability),
              );
              resetToFirstPage();
            }}
          >
            <option value="ALL">全部能力</option>
            {facets.capabilities.map((value) => (
              <option key={value} value={value}>
                {CAPABILITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>检测</span>
          <select
            value={
              detected === undefined
                ? "ALL"
                : detected
                  ? "DETECTED"
                  : "NOT_DETECTED"
            }
            disabled={stableDetectedAppIds === undefined}
            onChange={(event) => {
              setDetected(
                event.currentTarget.value === "ALL"
                  ? undefined
                  : event.currentTarget.value === "DETECTED",
              );
              resetToFirstPage();
            }}
          >
            <option value="ALL">全部检测状态</option>
            <option value="DETECTED">本机已检测</option>
            <option value="NOT_DETECTED">本机未检测</option>
          </select>
        </label>
      </div>

      <div className="applications-workspace__body">
        <aside
          ref={catalogListRef}
          className="applications-workspace__list"
          aria-label="应用与配置候选列表"
          aria-busy={catalogState.status === "loading" ? "true" : undefined}
          onFocusCapture={() => {
            listHasFocus.current = true;
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              listHasFocus.current = false;
            }
          }}
          onScroll={(event) => {
            if (catalogState.status !== "ready") {
              return;
            }
            const nextScrollTop = Math.round(
              event.currentTarget.scrollTop,
            );
            scrollTopRef.current = nextScrollTop;
            setScrollTop(nextScrollTop);
          }}
        >
          <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Catalog 结果</span>
            <span className="shrink-0">
              {catalogPage
                ? `${pageRange(catalogPage)} / ${catalogPage.pagination.totalItems}`
                : "—"}
            </span>
          </div>

          {catalogState.status === "loading" ? (
            <div className="px-3 pb-1">
              <AsyncState kind="loading">
                {detected !== undefined && stableDetectedAppIds === undefined
                  ? "正在等待本机应用检测结果…"
                  : "正在加载受管应用目录…"}
              </AsyncState>
            </div>
          ) : catalogState.status === "error" ? (
            <div className="px-3 pb-1">
              <AsyncState kind="error">
                {catalogState.error.message}
              </AsyncState>
            </div>
          ) : catalogApplications.length === 0 ? (
            <div className="p-3">
              <AsyncState kind="empty">
                没有符合筛选条件的 catalog 应用。
              </AsyncState>
            </div>
          ) : (
            <div
              role="listbox"
              aria-label={`受管应用目录，共 ${catalogPage?.pagination.totalItems} 项，第 ${catalogPage?.pagination.page} / ${catalogPage?.pagination.totalPages} 页，显示 ${catalogPage ? pageRange(catalogPage) : "0"}`}
            >
              {groupedApplications.map((group, groupIndex) => (
                <section
                  key={group.category}
                  role="group"
                  aria-labelledby={`application-group-${groupIndex}`}
                >
                  <h3
                    id={`application-group-${groupIndex}`}
                    className="sticky top-0 z-[1] border-b border-border bg-surface-muted px-3 py-1.5 text-[11px] font-semibold text-muted-foreground"
                  >
                    {group.category} · {group.applications.length}
                  </h3>
                  <ul role="presentation">
                    {group.applications.map(({ application, index }) => {
                      const key = catalogKey(application.id);
                      const isSelected =
                        effectiveSelectedKey === key;
                      const coverage =
                        COVERAGE_PRESENTATION[application.coverageClass];
                      return (
                        <li key={application.id} role="presentation">
                          <button
                            ref={(button) => {
                              if (button) {
                                catalogButtonRefs.current.set(key, button);
                              } else {
                                catalogButtonRefs.current.delete(key);
                              }
                            }}
                            type="button"
                            role="option"
                            className={classNames(
                              "applications-workspace__row",
                              isSelected && "applications-workspace__row--selected",
                            )}
                            aria-label={application.displayName}
                            aria-selected={isSelected}
                            tabIndex={isSelected ? 0 : -1}
                            title={application.displayName}
                            onClick={() =>
                              selectCatalogApplication(application)
                            }
                            onKeyDown={(event) =>
                              moveSelection(event, index)
                            }
                          >
                            <span
                              className={classNames(
                                "grid size-9 shrink-0 place-items-center rounded-md border",
                                isSelected
                                  ? "border-primary/30 bg-surface text-primary"
                                  : "border-border bg-surface-muted text-muted-foreground",
                              )}
                            >
                              <ApplicationIcon
                                className="size-5"
                                iconKey={application.iconKey}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <strong className="min-w-0 flex-1 truncate text-sm font-semibold">
                                  {application.displayName}
                                </strong>
                                <StatusBadge
                                  className="min-h-5 shrink-0 px-1.5 py-0 text-[10px]"
                                  tone={coverage.tone}
                                >
                                  {coverage.label}
                                </StatusBadge>
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {application.presentation.category}
                                {detectedIdSet.has(application.id)
                                  ? " · 本机已检测"
                                  : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {catalogPage && catalogPage.pagination.totalPages > 0 ? (
            <div
              className="grid gap-2 border-t border-border p-3"
              aria-label="Catalog 分页"
            >
              <div className="grid grid-cols-4 gap-2">
                <Button
                  size="sm"
                  disabled={catalogPage.pagination.page <= 1}
                  onClick={() => navigatePage(1)}
                >
                  首页
                </Button>
                <Button
                  size="sm"
                  disabled={catalogPage.pagination.page <= 1}
                  onClick={() =>
                    navigatePage(catalogPage.pagination.page - 1)
                  }
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  disabled={
                    catalogPage.pagination.page >=
                    catalogPage.pagination.totalPages
                  }
                  onClick={() =>
                    navigatePage(catalogPage.pagination.page + 1)
                  }
                >
                  下一页
                </Button>
                <Button
                  size="sm"
                  disabled={
                    catalogPage.pagination.page >=
                    catalogPage.pagination.totalPages
                  }
                  onClick={() =>
                    navigatePage(catalogPage.pagination.totalPages)
                  }
                >
                  末页
                </Button>
              </div>
              <div
                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              >
                <span>
                  第 {catalogPage.pagination.page} /{" "}
                  {catalogPage.pagination.totalPages} 页
                </span>
                <label className="flex items-center gap-2">
                  <span>跳转</span>
                  <select
                    value={catalogPage.pagination.page}
                    onChange={(event) =>
                      navigatePage(Number(event.currentTarget.value))
                    }
                  >
                    {Array.from(
                      { length: catalogPage.pagination.totalPages },
                      (_, index) => index + 1,
                    ).map((pageNumber) => (
                      <option key={pageNumber} value={pageNumber}>
                        {pageNumber}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          <section
            className="border-t border-border"
            aria-labelledby="unmanaged-candidates-heading"
          >
            <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <h3
                id="unmanaged-candidates-heading"
                className="font-semibold text-foreground"
              >
                未受管候选
              </h3>
              <span>
                {candidates.status === "READY"
                  ? `${unmanagedCandidates.length} 项`
                  : "—"}
              </span>
            </div>
            {candidates.status === "LOADING" ? (
              <div className="px-3 pb-3">
                <AsyncState kind="loading">
                  正在补充只读候选元数据…
                </AsyncState>
              </div>
            ) : candidates.status === "ERROR" ? (
              <div className="px-3 pb-3">
                <AsyncState kind="error">
                  {candidates.error.message}
                </AsyncState>
              </div>
            ) : unmanagedCandidates.length === 0 ? (
              <div className="px-3 pb-3">
                <AsyncState kind="empty">没有未受管候选项。</AsyncState>
              </div>
            ) : (
              <ul>
                {unmanagedCandidates.map((candidate) => {
                  const key = candidateKey(candidate.candidateId);
                  const isSelected = effectiveSelectedKey === key;
                  return (
                    <li key={candidate.candidateId}>
                      <button
                        type="button"
                        className={classNames(
                          "applications-workspace__row applications-workspace__row--candidate",
                          isSelected && "applications-workspace__row--selected",
                        )}
                        aria-pressed={isSelected}
                        title={candidate.displayName}
                        onClick={() => selectCandidate(candidate)}
                      >
                        <ApplicationIcon
                          className="size-4 shrink-0"
                          iconKey="candidate"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {candidate.displayName}
                        </span>
                        <StatusBadge
                          className="min-h-5 shrink-0 px-1.5 py-0 text-[10px]"
                          tone="warning"
                        >
                          只读元数据
                        </StatusBadge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>

        <div className="applications-workspace__detail">
          {selectedCandidate ? (
            <UnmanagedCandidates
              selectedCandidate={selectedCandidate}
              state={candidates}
            />
          ) : detailState.status === "loading" ? (
            <div className="p-5">
              <AsyncState kind="loading">正在加载应用详情…</AsyncState>
            </div>
          ) : detailState.status === "error" ? (
            <div className="p-5">
              <AsyncState kind="error">
                {detailState.error.message}
              </AsyncState>
            </div>
          ) : detailState.status === "ready" ? (
            <ConfigWorkspace
              key={detailState.application.id}
              application={detailState.application}
              onOperationChanged={onOperationChanged}
              onSelectedConfigChange={updateConfigSelection}
              preferredEditorMode={preferredEditorMode ?? "STRUCTURED"}
              refreshId={refreshId}
              selectedConfigId={
                selectedConfigIds[detailState.application.id]
              }
            />
          ) : (
            <div className="p-5">
              <AsyncState kind="empty">
                选择一个 catalog 应用或未受管候选以查看详情。
              </AsyncState>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface ApplicationsPageProps {
  /**
   * T116 wires these through for the applications scope and candidate
   * navigation. T118 renders the formal scope UI; until then they are accepted
   * for type-safe forwarding and selection, not displayed.
   */
  applicationsScope?: ApplicationsScope;
  candidateId?: string;
  sourceRefreshId?: string;
  staleReason?: StaleApplicationReason;
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>;
  detectedAppIds?: readonly string[];
  detectionError?: AppError;
  initialCapability?: ManagedAppCapability;
  initialCategory?: string;
  initialCoverage?: ManagedAppCoverageClass;
  initialDetected?: boolean;
  initialPage?: number;
  initialQuery?: string;
  initialScrollTop?: number;
  initialSelectedConfigIds?: Record<string, string>;
  initialSelectedKey?: string;
  onBrowseStateChange?: (state: ApplicationBrowseState) => void;
  onSelectedConfigChange?: (
    applicationId: string,
    configId?: string,
  ) => void;
  onSelectedKeyChange?: (key?: string) => void;
  onOperationChanged?: () => void;
  preferredEditorMode?: PreferredEditorMode;
  refreshId?: string;
  state: ApplicationsState;
}

export function ApplicationsPage(props: ApplicationsPageProps) {
  return <ApplicationsWorkspace {...props} />;
}
