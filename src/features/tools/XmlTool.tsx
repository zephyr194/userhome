import { useEffect, useRef, useState } from "react";
import {
  ActionRow,
  Button,
  Panel,
  PasteButton,
  SelectField,
  StatusBadge,
  TextAreaField,
  type SelectOption,
} from "../../components/ui";
import type { AppError } from "../../ipc/core";
import {
  formatXml,
  type FormattedXml,
  type XmlFormatMode,
} from "../../ipc/textTools";
import {
  createRequestTracker,
  exceedsInputLimit,
  failureView,
  oversizedView,
  successView,
  type XmlView,
} from "./xmlToolState";
import { useRevealResult } from "./useRevealResult";

const MODE_OPTIONS: readonly SelectOption<XmlFormatMode>[] = [
  { value: "INDENT2", label: "缩进 2 空格" },
  { value: "INDENT4", label: "缩进 4 空格" },
];

export function XmlTool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<XmlFormatMode>("INDENT2");
  const [view, setView] = useState<XmlView>({ status: "idle" });
  const [copyNotice, setCopyNotice] = useState<string | undefined>();
  const [tracker] = useState(createRequestTracker);
  const resultSectionRef = useRef<HTMLElement>(null);
  const resultTitleRef = useRef<HTMLHeadingElement>(null);
  useRevealResult(
    view.status === "success" || view.status === "error" ? view : undefined,
    resultSectionRef,
    resultTitleRef,
  );

  useEffect(() => () => tracker.invalidate(), [tracker]);

  function changeInput(next: string) {
    setInput(next);
    tracker.invalidate();
    setView({ status: "idle" });
    setCopyNotice(undefined);
  }

  function submit() {
    if (exceedsInputLimit(input)) {
      tracker.invalidate();
      setView(oversizedView());
      return;
    }
    const requestId = tracker.issue();
    setView({ status: "pending" });
    setCopyNotice(undefined);
    formatXml(input, mode).then(
      (output: FormattedXml) => {
        if (tracker.isCurrent(requestId)) setView(successView(output));
      },
      (error: AppError) => {
        if (tracker.isCurrent(requestId)) setView(failureView(error));
      },
    );
  }

  async function copyResult(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice("已复制结果。");
    } catch {
      setCopyNotice("复制失败，请手动选择结果文本。");
    }
  }

  return (
    <Panel
      aria-labelledby="xml-tool-heading"
      className="grid gap-ui-12 p-ui-12"
    >
      <div className="grid gap-ui-4">
        <h2 id="xml-tool-heading" className="text-body font-semibold">
          XML 格式化
        </h2>
        <p className="text-xs text-muted-foreground">
          良构校验与缩进；保留声明、命名空间、属性、注释、CDATA 与处理指令。
          mixed content 与 xml:space="preserve" 中的空白保持原样。
        </p>
        <p className="text-xs text-muted-foreground">
          不解析 DTD、外部实体与 XInclude，遇到时直接拒绝；XML 仅作为文本显示。
        </p>
      </div>

      <TextAreaField
        label="输入"
        expandTitle="XML · 输入"
        description="上限 1 MiB（UTF-8 字节）。超过上限时不会发送。"
        action={<PasteButton onPaste={changeInput} />}
        value={input}
        onValueChange={changeInput}
        expandable
        emphasis
        rows={10}
        spellCheck={false}
        inputClassName="font-mono text-xs"
      />

      <ActionRow alignItems="end">
        <SelectField
          label="输出格式"
          value={mode}
          onValueChange={setMode}
          options={MODE_OPTIONS}
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={view.status === "pending"}
        >
          格式化
        </Button>
        <Button variant="ghost" onClick={() => changeInput("")}>
          清空
        </Button>
      </ActionRow>

      <section
        aria-labelledby="xml-result-heading"
        className="grid gap-ui-8"
        ref={resultSectionRef}
      >
        <div className="flex flex-wrap items-center justify-between gap-ui-8">
          <h3
            className="text-body font-semibold"
            id="xml-result-heading"
            ref={resultTitleRef}
            tabIndex={-1}
          >
            结果
          </h3>
          {view.status === "success" ? (
            <Button size="sm" onClick={() => copyResult(view.output.text)}>
              复制结果
            </Button>
          ) : null}
        </div>

        {view.status === "idle" ? (
          <p className="text-xs text-muted-foreground">结果会显示在这里。</p>
        ) : null}

        {view.status === "pending" ? (
          <p role="status" className="text-xs text-muted-foreground">
            正在格式化…
          </p>
        ) : null}

        {view.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              无法格式化
            </StatusBadge>
            <p className="m-0 break-words">{view.message}</p>
            {view.line !== undefined && view.column !== undefined ? (
              <p className="m-0">
                第 {view.line} 行，第 {view.column} 列
              </p>
            ) : null}
          </div>
        ) : null}

        {view.status === "success" ? (
          <pre
            tabIndex={0}
            aria-label="格式化结果"
            className="m-0 max-h-80 overflow-auto whitespace-pre rounded-control bg-surface-muted p-ui-8 font-mono text-xs"
          >
            {view.output.text}
          </pre>
        ) : null}

        {copyNotice ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {copyNotice}
          </p>
        ) : null}
      </section>
    </Panel>
  );
}
