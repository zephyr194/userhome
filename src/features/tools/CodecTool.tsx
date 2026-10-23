import { useEffect, useState } from "react";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  ActionRow,
  Button,
  Panel,
  PasteButton,
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
  algorithmNote,
  algorithmOptions,
  conversionLabel,
  directionOptions,
  failureView,
  noticeText,
  oversizedView,
  successView,
  type CodecView,
} from "./codecToolState";
import {
  createRequestTracker,
  exceedsInputLimit,
} from "./toolRequestState";

export function CodecTool() {
  const t = useT();
  const locale = useLocale();
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
      setView(oversizedView(locale));
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
        if (tracker.isCurrent(requestId)) setView(failureView(error, locale));
      },
    );
  }

  async function copyResult(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(t("tools.result.copied"));
    } catch {
      setCopyNotice(t("tools.result.copyFailed"));
    }
  }

  return (
    <Panel
      aria-labelledby="codec-tool-heading"
      className="grid gap-ui-12 p-ui-12"
    >
      <div className="grid gap-ui-4">
        <h2 id="codec-tool-heading" className="text-body font-semibold">
          {t("tools.codec.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("tools.codec.description")}
        </p>
      </div>

      <ActionRow alignItems="end">
        <SelectField
          label={t("tools.codec.algorithm")}
          value={algorithm}
          onValueChange={changeAlgorithm}
          options={algorithmOptions(locale)}
        />
        <SelectField
          label={t("tools.codec.direction")}
          value={direction}
          onValueChange={changeDirection}
          options={directionOptions(locale)}
        />
      </ActionRow>

      {algorithmNote(algorithm, locale) ? (
        <p className="m-0 text-xs text-muted-foreground">
          {algorithmNote(algorithm, locale)}
        </p>
      ) : null}

      <TextAreaField
        label={t("tools.input.label")}
        expandTitle={t("tools.codec.inputExpandTitle")}
        description={t("tools.input.limit")}
        action={<PasteButton onPaste={changeInput} />}
        value={input}
        onValueChange={changeInput}
        expandable
        emphasis
        rows={8}
        spellCheck={false}
        inputClassName="font-mono text-xs"
      />

      <ActionRow>
        <Button
          variant="primary"
          onClick={submit}
          disabled={view.status === "pending"}
        >
          {t("tools.action.convert")}
        </Button>
        <Button variant="ghost" onClick={() => changeInput("")}>
          {t("tools.action.clearInput")}
        </Button>
      </ActionRow>

      <section aria-labelledby="codec-result-heading" className="grid gap-ui-8">
        <div className="flex flex-wrap items-center justify-between gap-ui-8">
          <h3 id="codec-result-heading" className="text-body font-semibold">
            {t("tools.result.heading")}
          </h3>
          {view.status === "success" ? (
            <Button size="sm" variant="ghost" onClick={() => copyResult(view.output.text)}>
              {t("tools.result.copy")}
            </Button>
          ) : null}
        </div>

        {view.status === "idle" ? (
          <p className="text-xs text-muted-foreground">{t("tools.result.placeholder")}</p>
        ) : null}

        {view.status === "pending" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("tools.codec.converting")}
          </p>
        ) : null}

        {view.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              {t("tools.codec.failed")}
            </StatusBadge>
            <p className="m-0 break-words">{view.message}</p>
          </div>
        ) : null}

        {view.status === "success" ? (
          <>
            <p className="m-0 text-xs text-muted-foreground">
              {conversionLabel(view.algorithm, view.direction, locale)}
            </p>
            {view.output.notices.length > 0 ? (
              <div className="grid gap-ui-4 rounded-control bg-warning-soft p-ui-8 text-xs text-warning">
                <StatusBadge className="justify-self-start" tone="warning">
                  {t("tools.codec.hint")}
                </StatusBadge>
                <ul className="m-0 grid gap-ui-2 pl-ui-12">
                  {view.output.notices.map((notice) => (
                    <li key={notice}>{noticeText(notice, locale)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <TextAreaField
              label={t("tools.codec.output")}
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
