import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useT } from "../../i18n/useLocale";
import { Button } from "./Button";
import { classNames } from "./classNames";
import { canHighlight, tokenizeLines, type CodeLanguage, type CodeLine } from "./codeTokens";
import { Modal } from "./Modal";

export interface CodeViewerProps {
  /** 可访问名称，例如“解析后的内容”。 */
  label: string;
  language: CodeLanguage;
  /** 原文。复制与窗口版都只使用这一份文本，行号不进入文本。 */
  text: string;
  /** 窗口标题，一般是文件名。 */
  title: string;
  initialWrap?: boolean;
  /** 工具行左侧的说明，例如敏感值已遮盖的提示。 */
  notice?: ReactNode;
  scrollClassName?: string;
  /** false 时不显示“在窗口中查看”（已经在弹层里时使用）。 */
  allowWindow?: boolean;
}

export function CodeViewer({
  allowWindow = true,
  initialWrap = false,
  label,
  language,
  notice,
  scrollClassName,
  text,
  title,
}: CodeViewerProps) {
  const t = useT();
  const [wrap, setWrap] = useState(initialWrap);
  const [windowOpen, setWindowOpen] = useState(false);
  const highlight = useMemo(() => canHighlight(text), [text]);
  const lines = useMemo(
    () => tokenizeLines(text, highlight ? language : "plain"),
    [text, highlight, language],
  );
  const toggleWrap = () => setWrap((value) => !value);

  return (
    <div className="grid min-w-0 gap-ui-8">
      <CodeToolbar
        highlightOff={!highlight}
        notice={notice}
        onOpenWindow={allowWindow ? () => setWindowOpen(true) : undefined}
        onToggleWrap={toggleWrap}
        wrap={wrap}
      />
      <CodeSurface
        className={scrollClassName}
        label={label}
        lines={lines}
        wrap={wrap}
      />
      <Modal
        bodyClassName="r6-code-window-body"
        className="r6-code-window"
        footer={
          <Button data-modal-cancel onClick={() => setWindowOpen(false)} size="sm" variant="secondary">
            {t("common.close")}
          </Button>
        }
        onClose={() => setWindowOpen(false)}
        open={windowOpen}
        title={title}
      >
        <div className="r6-code-window-content">
          <CodeToolbar
            highlightOff={!highlight}
            notice={notice}
            onToggleWrap={toggleWrap}
            wrap={wrap}
          />
          <CodeSurface className="r6-code-fill" label={label} lines={lines} wrap={wrap} />
        </div>
      </Modal>
    </div>
  );
}

function CodeToolbar({
  highlightOff,
  notice,
  onOpenWindow,
  onToggleWrap,
  wrap,
}: {
  highlightOff: boolean;
  notice?: ReactNode;
  onOpenWindow?: () => void;
  onToggleWrap: () => void;
  wrap: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-ui-8">
      <div className="min-w-0 text-aux text-muted-foreground">
        {notice}
        {highlightOff ? <p className="m-0">{t("common.code.highlightOff")}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-ui-8">
        <Button onClick={onToggleWrap} size="sm" variant="ghost">
          {wrap ? t("common.code.unwrap") : t("common.code.wrap")}
        </Button>
        {onOpenWindow ? (
          <Button aria-haspopup="dialog" onClick={onOpenWindow} size="sm" variant="ghost">
            {t("common.code.openWindow")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CodeSurface({
  className,
  label,
  lines,
  wrap,
}: {
  className?: string;
  label: string;
  lines: readonly CodeLine[];
  wrap: boolean;
}) {
  return (
    <div
      aria-label={label}
      className={classNames(
        "r6-code-scroll r4-fe4-scroll min-w-0 rounded-control bg-surface-muted font-mono text-aux",
        wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre",
        className,
      )}
      role="region"
      tabIndex={0}
    >
      {lines.map((tokens, index) => (
        <div className="r6-code-line" key={index}>
          <span aria-hidden="true" className="r6-code-gutter">
            {index + 1}
          </span>
          <span className="r6-code-text">
            {tokens.map((token, tokenIndex) =>
              token.kind ? (
                <span data-token={token.kind} key={tokenIndex}>
                  {token.text}
                </span>
              ) : (
                <Fragment key={tokenIndex}>{token.text}</Fragment>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
