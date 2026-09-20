import { Button, StatusBadge } from "../../components/ui";
import type {
  BrewPackageAction,
  BrewPackageDetails as BrewPackageDetailsValue,
} from "../../ipc/brew";

export function BrewPackageDetails({
  details,
  onAction,
}: {
  details: BrewPackageDetailsValue;
  onAction: (action: BrewPackageAction) => void;
}) {
  const installed = details.installedVersions.length > 0;

  return (
    <section
      className="min-w-0 rounded-md border border-border bg-surface"
      aria-labelledby="package-details-heading"
    >
      <header className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              软件包详情
            </p>
            <h3
              className="mt-1 break-words text-base font-semibold"
              id="package-details-heading"
            >
              {details.displayName}
            </h3>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {details.identifier}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge>
              {details.kind === "FORMULA" ? "Formula" : "Cask"}
            </StatusBadge>
            <StatusBadge tone={installed ? "success" : "neutral"}>
              {installed ? "已安装" : "未安装"}
            </StatusBadge>
            {details.outdated ? (
              <StatusBadge tone="warning">可更新</StatusBadge>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-w-0 space-y-4 px-4 py-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {details.description ?? "Homebrew 未提供描述。"}
        </p>
        <dl className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">当前版本</dt>
            <dd className="mt-1 break-all text-sm font-medium">
              {details.currentVersion ?? "未知"}
            </dd>
          </div>
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">已安装版本</dt>
            <dd className="mt-1 break-all text-sm font-medium">
              {details.installedVersions.join(", ") || "未安装"}
            </dd>
          </div>
          <div className="min-w-0 bg-surface-muted px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">更新状态</dt>
            <dd className="mt-1 text-sm font-medium">
              {details.outdated
                ? "有新版本可用"
                : installed
                  ? "已是最新版本"
                  : "安装后可检查更新"}
            </dd>
          </div>
        </dl>

        {details.homepage ? (
          <p className="min-w-0 break-all text-xs text-muted-foreground">
            主页：{details.homepage}
          </p>
        ) : null}

        <div
          className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"
          aria-label={`${details.displayName} 可用操作`}
        >
          {!installed ? (
            <Button variant="primary" onClick={() => onAction("INSTALL")}>
              安装 {details.kind === "FORMULA" ? "Formula" : "Cask"}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={!details.outdated}
                onClick={() => onAction("UPGRADE")}
              >
                {details.outdated ? "更新软件包" : "无需更新"}
              </Button>
              <Button
                variant="danger"
                onClick={() => onAction("UNINSTALL")}
              >
                卸载 {details.identifier}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
