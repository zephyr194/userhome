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
    <section className="package-details" aria-labelledby="package-details-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">
            {details.kind === "FORMULA" ? "Formula" : "Cask"} 详情
          </p>
          <h3 id="package-details-heading">{details.displayName}</h3>
        </div>
        <span className="package-kind">{details.identifier}</span>
      </div>
      <p>{details.description ?? "Homebrew 未提供描述。"}</p>
      <dl className="package-metadata">
        <div>
          <dt>当前版本</dt>
          <dd>{details.currentVersion ?? "未知"}</dd>
        </div>
        <div>
          <dt>已安装</dt>
          <dd>{details.installedVersions.join(", ") || "未安装"}</dd>
        </div>
        <div>
          <dt>更新状态</dt>
          <dd>{details.outdated ? "可更新" : "无待更新版本"}</dd>
        </div>
      </dl>
      {details.homepage ? (
        <p className="panel-note">主页：{details.homepage}</p>
      ) : null}
      <div className="dialog-actions">
        {!installed ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => onAction("INSTALL")}
          >
            安装
          </button>
        ) : (
          <>
            <button
              className="primary-button"
              type="button"
              disabled={!details.outdated}
              onClick={() => onAction("UPGRADE")}
            >
              更新
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => onAction("UNINSTALL")}
            >
              卸载 {details.identifier}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
