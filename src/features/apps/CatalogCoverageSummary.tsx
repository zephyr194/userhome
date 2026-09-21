import { useEffect, useState } from "react";
import { AsyncState } from "../../components/AsyncState";
import { StatusBadge } from "../../components/ui";
import type { ManagedAppCatalog } from "../../ipc/catalog";
import {
  exportSanitizedBaseline,
  type SanitizedBaselineManifest,
} from "../../ipc/discovery";
import { decodeAppError, type AppError } from "../../ipc/core";
import { summarizeCatalogCoverage } from "./catalogCoverage";

type CoverageState =
  | { status: "loading" }
  | { status: "ready"; manifest: SanitizedBaselineManifest }
  | { status: "error"; error: AppError };

export function CatalogCoverageSummary({
  catalog,
}: {
  catalog: ManagedAppCatalog;
}) {
  const [state, setState] = useState<CoverageState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void exportSanitizedBaseline()
      .then((manifest) => {
        if (active) setState({ status: "ready", manifest });
      })
      .catch((error) => {
        if (active) {
          setState({ status: "error", error: decodeAppError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="applications-workspace__coverage">
        <AsyncState kind="loading">正在核对脱敏基线覆盖率…</AsyncState>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="applications-workspace__coverage">
        <AsyncState kind="error">{state.error.message}</AsyncState>
      </div>
    );
  }

  const metrics = summarizeCatalogCoverage(catalog, state.manifest);
  const percentage = `${metrics.eligibleTextPercent.toFixed(1)}%`;
  return (
    <section
      className="applications-workspace__coverage"
      aria-labelledby="catalog-coverage-heading"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="catalog-coverage-heading" className="text-sm font-semibold">
            Catalog 覆盖完整性
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            脱敏基线 {state.manifest.completeness === "COMPLETE" ? "完整" : "部分"}
            ，省略 {metrics.omittedCandidateCount} 项敏感或排除记录。
          </p>
        </div>
        <StatusBadge tone={metrics.complete ? "success" : "warning"}>
          {metrics.complete ? "达到门槛" : "需要补充覆盖"}
        </StatusBadge>
      </div>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">候选分类</dt>
          <dd className="mt-0.5 font-semibold">
            {metrics.classifiedCandidateCount}/{metrics.totalCandidateCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Priority A</dt>
          <dd className="mt-0.5 font-semibold">
            {catalog.coveragePolicy.priorityAUsable}/
            {catalog.coveragePolicy.priorityATotal}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Priority B</dt>
          <dd className="mt-0.5 font-semibold">
            {catalog.coveragePolicy.priorityBCovered}/
            {catalog.coveragePolicy.priorityBTotal}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">可用文本根</dt>
          <dd className="mt-0.5 font-semibold">
            {metrics.managedEligibleTextCount}/{metrics.eligibleTextCount} ·{" "}
            {percentage}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        门槛 {catalog.coveragePolicy.minimumEligibleTextPercent}%；已排除{" "}
        {metrics.excludedCandidateCount} 项。文本分母在脱敏前统计，排除项不会缩小门槛基数。
      </p>
    </section>
  );
}
