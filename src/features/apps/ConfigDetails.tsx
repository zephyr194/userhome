import type { ConfigDocument } from "../../ipc/config";

export function ConfigDetails({ document }: { document: ConfigDocument }) {
  return (
    <section className="config-details" aria-labelledby="config-details-heading">
      <p className="section-kicker">配置详情</p>
      <h3 id="config-details-heading">{document.configId}</h3>
      <dl className="config-metadata">
        <div>
          <dt>路径</dt>
          <dd>{document.displayPath}</dd>
        </div>
        <div>
          <dt>权限</dt>
          <dd>{document.mode === undefined ? "不可用" : document.mode.toString(8)}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{document.sizeBytes === undefined ? "不可用" : `${document.sizeBytes} bytes`}</dd>
        </div>
        <div>
          <dt>敏感级别</dt>
          <dd>{document.sensitivity}</dd>
        </div>
      </dl>
      {document.symlink && (
        <p className="status-note">符号链接目标：{document.symlink.targetDisplayPath}</p>
      )}
      {document.content === undefined ? (
        <p role="status">此配置仅显示元数据，内容不会离开 Rust 边界。</p>
      ) : (
        <>
          {document.contentRedacted && (
            <p className="status-note">可能包含秘密的行已隐藏。</p>
          )}
          <pre className="config-content">{document.content}</pre>
        </>
      )}
    </section>
  );
}
