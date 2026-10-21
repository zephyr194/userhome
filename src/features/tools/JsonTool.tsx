import { useEffect, useState } from "react";
import {
  Button,
  Panel,
  SelectField,
  StatusBadge,
  TextAreaField,
  type SelectOption,
} from "../../components/ui";
import type { AppError } from "../../ipc/core";
import {
  formatJson,
  type FormattedJson,
  type JsonFormatMode,
} from "../../ipc/textTools";
import {
  createRequestTracker,
  exceedsInputLimit,
  failureView,
  oversizedView,
  successView,
  type JsonView,
} from "./jsonToolState";

const MODE_OPTIONS: readonly SelectOption<JsonFormatMode>[] = [
  { value: "INDENT2", label: "缩进 2 空格" },
  { value: "INDENT4", label: "缩进 4 空格" },
  { value: "MINIFY", label: "压缩" },
];

export function JsonTool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<JsonFormatMode>("INDENT2");
  const [view, setView] = useState<JsonView>({ status: "idle" });
  const [copyNotice, setCopyNotice] = useState<string | undefined>();
  const [tracker] = useState(createRequestTracker);

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
    formatJson(input, mode).then(
      (output: FormattedJson) => {
        if (tracker.isCurrent(requestId)) setView(successView(output, mode));
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
      aria-labelledby="json-tool-heading"
      className="grid gap-ui-xl border border-border p-ui-2xl"
    >
      <div className="grid gap-ui-xs">
        <h2 id="json-tool-heading" className="text-body font-semibold">
          JSON 格式化
        </h2>
        <p className="text-xs text-muted-foreground">
          严格 JSON 校验；数字、字符串与重复键保留原文，只调整空白。
        </p>
      </div>

      <TextAreaField
        label="输入"
        description="上限 1 MiB（UTF-8 字节）。超过上限时不会发送。"
        value={input}
        onValueChange={changeInput}
        rows={10}
        spellCheck={false}
        inputClassName="font-mono text-xs"
      />

      <div className="flex flex-wrap items-end gap-ui-md">
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
      </div>

      <section aria-labelledby="json-result-heading" className="grid gap-ui-md">
        <div className="flex flex-wrap items-center justify-between gap-ui-md">
          <h3 id="json-result-heading" className="text-body font-semibold">
            结果
          </h3>
          {view.status === "success" ? (
            <Button
              size="sm"
              onClick={() => copyResult(view.output.text)}
            >
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
            className="grid gap-ui-xs rounded-control bg-danger-soft p-ui-lg text-xs text-danger"
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
          <>
            {view.output.warnings.length > 0 || view.output.omittedWarnings > 0 ? (
              <div className="grid gap-ui-xs rounded-control bg-warning-soft p-ui-lg text-xs text-warning">
                <StatusBadge className="justify-self-start" tone="warning">
                  重复键
                </StatusBadge>
                <p className="m-0">
                  输入中存在重复键，已按原样保留，未合并或删除。
                </p>
                <ul className="m-0 grid gap-ui-xxs pl-ui-xl">
                  {view.output.warnings.map((warning, index) => (
                    <li key={`${warning.line}:${warning.column}:${index}`}>
                      键 “{warning.key}”：第 {warning.line} 行，第 {warning.column} 列
                    </li>
                  ))}
                </ul>
                {view.output.omittedWarnings > 0 ? (
                  <p className="m-0">
                    另有 {view.output.omittedWarnings} 条警告未列出。
                  </p>
                ) : null}
              </div>
            ) : null}
            <pre
              tabIndex={0}
              aria-label="格式化结果"
              className="m-0 max-h-80 overflow-auto whitespace-pre rounded-control bg-surface-muted p-ui-lg font-mono text-xs"
            >
              {view.output.text}
            </pre>
          </>
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
