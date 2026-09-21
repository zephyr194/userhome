import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ApplicationsState } from "../../app/shellState";
import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import { classNames } from "../../components/ui/classNames";
import type {
  ManagedAppCatalog,
  ManagedAppCoverageClass,
  ManagedAppSummary,
} from "../../ipc/catalog";
import type {
  ModuleSnapshot,
  UnmanagedCandidate,
} from "../../ipc/discovery";
import { ApplicationIcon } from "./ApplicationIcon";
import { ConfigWorkspace } from "./ConfigWorkspace";
import { UnmanagedCandidates } from "./UnmanagedCandidates";

type ApplicationEntry =
  | {
      key: string;
      kind: "catalog";
      application: ManagedAppSummary;
      category: string;
      coverageClass: ManagedAppCoverageClass;
      displayName: string;
      description: string;
      iconKey: string;
    }
  | {
      key: string;
      kind: "candidate";
      candidate: UnmanagedCandidate;
      category: "未受管候选";
      coverageClass: ManagedAppCoverageClass;
      displayName: string;
      description: string;
      iconKey: "candidate";
    };

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
  value: "ALL" | ManagedAppCoverageClass;
  label: string;
}[] = [
  { value: "ALL", label: "全部覆盖级别" },
  { value: "MANAGED_WRITABLE", label: "受管可写" },
  { value: "MANAGED_READ_ONLY", label: "受管只读" },
  { value: "DETECTED_UNSUPPORTED", label: "已发现，暂不支持" },
  { value: "EXCLUDED", label: "已排除" },
];

function catalogEntries(catalog?: ManagedAppCatalog): ApplicationEntry[] {
  return (
    catalog?.applications.map((application) => ({
      key: `catalog:${application.id}`,
      kind: "catalog" as const,
      application,
      category: application.presentation.category,
      coverageClass: application.coverageClass,
      displayName: application.displayName,
      description: application.description,
      iconKey: application.iconKey,
    })) ?? []
  );
}

function candidateEntries(
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>,
): ApplicationEntry[] {
  if (candidates.status !== "READY") return [];
  return candidates.data.map((candidate) => ({
    key: `candidate:${candidate.name}`,
    kind: "candidate",
    candidate,
    category: "未受管候选",
    coverageClass: candidate.coverageClass,
    displayName: candidate.name,
    description: "仅显示安全分类后的浅层文件系统元数据。",
    iconKey: "candidate",
  }));
}

function keyboardTargetIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  entryCount: number,
): number | undefined {
  if (event.key === "ArrowDown") {
    return Math.min(currentIndex + 1, entryCount - 1);
  }
  if (event.key === "ArrowUp") {
    return Math.max(currentIndex - 1, 0);
  }
  if (event.key === "Home") {
    return 0;
  }
  if (event.key === "End") {
    return entryCount - 1;
  }
  return undefined;
}

function ApplicationsWorkspace({
  candidates,
  onOperationChanged,
  state,
}: {
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>;
  onOperationChanged?: () => void;
  state: ApplicationsState;
}) {
  const catalog = state.status === "ready" ? state.catalog : undefined;
  const entries = useMemo(
    () => [...catalogEntries(catalog), ...candidateEntries(candidates)],
    [candidates, catalog],
  );
  const categories = useMemo(
    () => [...new Set(entries.map((entry) => entry.category))].sort(),
    [entries],
  );
  const [selectedKey, setSelectedKey] = useState(entries[0]?.key);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [coverage, setCoverage] = useState<
    "ALL" | ManagedAppCoverageClass
  >("ALL");
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusedKey = useRef<string | undefined>(undefined);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return entries.filter(
      (entry) =>
        (category === "ALL" || entry.category === category) &&
        (coverage === "ALL" || entry.coverageClass === coverage) &&
        (normalizedQuery.length === 0 ||
          entry.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
          entry.description.toLocaleLowerCase().includes(normalizedQuery) ||
          entry.category.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [category, coverage, entries, query]);

  const selectedEntry =
    filteredEntries.find((entry) => entry.key === selectedKey) ??
    filteredEntries[0];

  useEffect(() => {
    if (
      !focusedKey.current ||
      filteredEntries.some((entry) => entry.key === focusedKey.current)
    ) {
      return;
    }

    const fallback = selectedEntry;
    focusedKey.current = fallback?.key;
    if (fallback) {
      setSelectedKey(fallback.key);
      requestAnimationFrame(() => buttonRefs.current.get(fallback.key)?.focus());
    }
  }, [filteredEntries, selectedEntry]);

  function moveSelection(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    const nextIndex = keyboardTargetIndex(
      event,
      currentIndex,
      filteredEntries.length,
    );
    if (nextIndex === undefined || nextIndex === currentIndex) {
      return;
    }

    event.preventDefault();
    const nextEntry = filteredEntries[nextIndex];
    setSelectedKey(nextEntry.key);
    focusedKey.current = nextEntry.key;
    buttonRefs.current.get(nextEntry.key)?.focus();
  }

  return (
    <section
      className="applications-workspace"
      aria-labelledby="applications-heading"
    >
      <header className="applications-workspace__header">
        <div>
          <p className="section-kicker">
            {catalog ? `受管目录 v${catalog.schemaVersion}` : "受管目录"}
          </p>
          <h2 id="applications-heading">Applications</h2>
          <p>通过覆盖级别区分可写、只读与仅元数据条目。</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <strong className="block text-sm text-foreground">
            {entries.length} 项
          </strong>
          {catalog ? `${catalog.applications.length} 个 catalog 定义` : "目录待就绪"}
        </div>
      </header>

      <div className="applications-workspace__filters" aria-label="应用筛选">
        <label className="min-w-0 flex-1">
          <span>搜索</span>
          <input
            type="search"
            value={query}
            placeholder="名称、说明或分类"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>分类</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
          >
            <option value="ALL">全部分类</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>覆盖</span>
          <select
            value={coverage}
            onChange={(event) =>
              setCoverage(
                event.currentTarget.value as
                  | "ALL"
                  | ManagedAppCoverageClass,
              )
            }
          >
            {COVERAGE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="applications-workspace__body">
        <aside
          className="applications-workspace__list"
          aria-label="应用与配置候选列表"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span>结果</span>
            <span>{filteredEntries.length} 项</span>
          </div>

          {state.status === "loading" ? (
            <div className="px-3 pb-1">
              <AsyncState kind="loading">正在加载受管应用目录…</AsyncState>
            </div>
          ) : state.status === "error" ? (
            <div className="px-3 pb-1">
              <AsyncState kind="error">{state.error.message}</AsyncState>
            </div>
          ) : null}

          {filteredEntries.length === 0 ? (
            <div className="p-3">
              <AsyncState kind="empty">没有符合筛选条件的条目。</AsyncState>
            </div>
          ) : (
            <ul role="listbox" aria-label="应用与配置候选列表">
              {filteredEntries.map((entry, index) => {
                const isSelected = selectedEntry?.key === entry.key;
                const coverageValue =
                  COVERAGE_PRESENTATION[entry.coverageClass];
                return (
                  <li key={entry.key} role="presentation">
                    <button
                      ref={(button) => {
                        if (button) {
                          buttonRefs.current.set(entry.key, button);
                        } else {
                          buttonRefs.current.delete(entry.key);
                        }
                      }}
                      type="button"
                      role="option"
                      className={classNames(
                        "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors",
                        "hover:bg-surface-muted focus-visible:relative focus-visible:z-10",
                        isSelected
                          ? "bg-primary-soft text-foreground"
                          : "bg-surface",
                      )}
                      aria-selected={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => setSelectedKey(entry.key)}
                      onFocus={() => {
                        focusedKey.current = entry.key;
                      }}
                      onKeyDown={(event) => moveSelection(event, index)}
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
                          iconKey={entry.iconKey}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-start justify-between gap-2">
                          <strong className="truncate text-sm font-semibold">
                            {entry.displayName}
                          </strong>
                          <StatusBadge
                            className="min-h-5 shrink-0 px-1.5 py-0 text-[10px]"
                            tone={coverageValue.tone}
                          >
                            {coverageValue.label}
                          </StatusBadge>
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {entry.category}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                          {entry.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {candidates.status === "LOADING" ? (
            <div className="border-t border-border px-3 pb-3">
              <AsyncState kind="loading">正在补充未受管候选元数据…</AsyncState>
            </div>
          ) : candidates.status === "ERROR" ? (
            <div className="border-t border-border px-3 pb-3">
              <AsyncState kind="error">{candidates.error.message}</AsyncState>
            </div>
          ) : null}
        </aside>

        <div className="applications-workspace__detail">
          {!selectedEntry ? (
            <div className="p-5">
              <AsyncState kind="empty">
                选择一个应用或调整筛选条件以查看详情。
              </AsyncState>
            </div>
          ) : selectedEntry.kind === "catalog" ? (
            <ConfigWorkspace
              key={selectedEntry.application.id}
              application={selectedEntry.application}
              onOperationChanged={onOperationChanged}
            />
          ) : (
            <UnmanagedCandidates
              selectedCandidate={selectedEntry.candidate}
              state={candidates}
            />
          )}
        </div>
      </div>
    </section>
  );
}

interface ApplicationsPageProps {
  candidates: ModuleSnapshot<readonly UnmanagedCandidate[]>;
  onOperationChanged?: () => void;
  state: ApplicationsState;
}

export function ApplicationsPage({
  candidates,
  onOperationChanged,
  state,
}: ApplicationsPageProps) {
  return (
    <ApplicationsWorkspace
      candidates={candidates}
      onOperationChanged={onOperationChanged}
      state={state}
    />
  );
}
