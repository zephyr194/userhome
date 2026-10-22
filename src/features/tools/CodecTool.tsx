import { useEffect, useState } from "react";
import {
  Button,
  Panel,
  SelectField,
  StatusBadge,
  TextAreaField,
} from "../../components/ui";
import type { AppError } from "../../ipc/core";
import {
  transformText,
  type CodecAlgorithm,
  type CodecDirection,
  type TransformedText,
} from "../../ipc/textTools";
import {
  ALGORITHM_OPTIONS,
  DIRECTION_OPTIONS,
  algorithmNote,
  conversionLabel,
  failureView,
  oversizedView,
  successView,
  type CodecView,
} from "./codecToolState";
import {
  createRequestTracker,
  exceedsInputLimit,
} from "./toolRequestState";

export function CodecTool() {
  const [input, setInput] = useState("");
  const [algorithm, setAlgorithm] = useState<CodecAlgorithm>("BASE64");
  const [direction, setDirection] = useState<CodecDirection>("ENCODE");
  const [view, setView] = useState<CodecView>({ status: "idle" });
  const [copyNotice, setCopyNotice] = useState<string | undefined>();
  const [tracker] = useState(createRequestTracker);

  useEffect(() => () => tracker.invalidate(), [tracker]);

  function resetResult() {
    tracker.invalidate();
    setView({ status: "idle" });
    setCopyNotice(undefined);
  }

  function changeInput(next: string) {
    setInput(next);
    resetResult();
  }

  function changeAlgorithm(next: CodecAlgorithm) {
    setAlgorithm(next);
    resetResult();
  }

  function changeDirection(next: CodecDirection) {
    setDirection(next);
    resetResult();
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
    transformText(input, algorithm, direction).then(
      (output: TransformedText) => {
        if (tracker.isCurrent(requestId)) {
          setView(successView(output, algorithm, direction));
        }
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
      aria-labelledby="codec-tool-heading"
      className="grid gap-ui-12 border border-border p-ui-12"
    >
      <div className="grid gap-ui-4">
        <h2 id="codec-tool-heading" className="text-body font-semibold">
          文本编解码
        </h2>
        <p className="text-xs text-muted-foreground">
          单次转换，不递归解码；结果只作为文本显示，不会渲染、打开或执行。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-ui-8">
        <SelectField
          label="算法"
          value={algorithm}
          onValueChange={changeAlgorithm}
          options={ALGORITHM_OPTIONS}
        />
        <SelectField
          label="方向"
          value={direction}
          onValueChange={changeDirection}
          options={DIRECTION_OPTIONS}
        />
      </div>

      {algorithmNote(algorithm) ? (
        <p className="m-0 text-xs text-muted-foreground">
          {algorithmNote(algorithm)}
        </p>
      ) : null}

      <TextAreaField
        label="输入"
        description="上限 1 MiB（UTF-8 字节）。超过上限时不会发送。"
        value={input}
        onValueChange={changeInput}
        expandable
        emphasis
        rows={8}
        spellCheck={false}
        inputClassName="font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-ui-8">
        <Button
          variant="primary"
          onClick={submit}
          disabled={view.status === "pending"}
        >
          转换
        </Button>
        <Button variant="ghost" onClick={() => changeInput("")}>
          清空输入
        </Button>
      </div>

      <section aria-labelledby="codec-result-heading" className="grid gap-ui-8">
        <div className="flex flex-wrap items-center justify-between gap-ui-8">
          <h3 id="codec-result-heading" className="text-body font-semibold">
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
            正在转换…
          </p>
        ) : null}

        {view.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              无法转换
            </StatusBadge>
            <p className="m-0 break-words">{view.message}</p>
          </div>
        ) : null}

        {view.status === "success" ? (
          <>
            <p className="m-0 text-xs text-muted-foreground">
              {conversionLabel(view.algorithm, view.direction)}
            </p>
            {view.output.notices.length > 0 ? (
              <div className="grid gap-ui-4 rounded-control bg-warning-soft p-ui-8 text-xs text-warning">
                <StatusBadge className="justify-self-start" tone="warning">
                  提示
                </StatusBadge>
                <ul className="m-0 grid gap-ui-2 pl-ui-12">
                  {view.output.notices.map((notice) => (
                    <li key={notice}>{notice}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <TextAreaField
              label="输出"
              readOnly
              value={view.output.text}
              rows={8}
              spellCheck={false}
              inputClassName="font-mono text-xs"
            />
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
