import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../../i18n/useLocale";
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
import { useRevealResult } from "./useRevealResult";

export function JsonTool() {
  const t = useT();
  const locale = useLocale();
  const modeOptions: readonly SelectOption<JsonFormatMode>[] = [
    { value: "INDENT2", label: t("tools.format.indent2") },
    { value: "INDENT4", label: t("tools.format.indent4") },
    { value: "MINIFY", label: t("tools.format.minify") },
  ];
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<JsonFormatMode>("INDENT2");
  const [view, setView] = useState<JsonView>({ status: "idle" });
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
      setView(oversizedView(locale));
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
      aria-labelledby="json-tool-heading"
      className="grid gap-ui-12 p-ui-12"
    >
      <div className="grid gap-ui-4">
        <h2 id="json-tool-heading" className="text-body font-semibold">
          {t("tools.json.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("tools.json.description")}
        </p>
      </div>

      <TextAreaField
        label={t("tools.input.label")}
        expandTitle={t("tools.json.inputExpandTitle")}
        description={t("tools.input.limit")}
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
          label={t("tools.format.outputLabel")}
          value={mode}
          onValueChange={setMode}
          options={modeOptions}
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={view.status === "pending"}
        >
          {t("tools.action.format")}
        </Button>
        <Button variant="ghost" onClick={() => changeInput("")}>
          {t("tools.action.clear")}
        </Button>
      </ActionRow>

      <section
        aria-labelledby="json-result-heading"
        className="grid gap-ui-8"
        ref={resultSectionRef}
      >
        <div className="flex flex-wrap items-center justify-between gap-ui-8">
          <h3
            className="text-body font-semibold"
            id="json-result-heading"
            ref={resultTitleRef}
            tabIndex={-1}
          >
            {t("tools.result.heading")}
          </h3>
          {view.status === "success" ? (
            <Button
              size="sm"
              onClick={() => copyResult(view.output.text)}
            >
              {t("tools.result.copy")}
            </Button>
          ) : null}
        </div>

        {view.status === "idle" ? (
          <p className="text-xs text-muted-foreground">{t("tools.result.placeholder")}</p>
        ) : null}

        {view.status === "pending" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("tools.format.pending")}
          </p>
        ) : null}

        {view.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              {t("tools.format.failed")}
            </StatusBadge>
            <p className="m-0 break-words">{view.message}</p>
            {view.line !== undefined && view.column !== undefined ? (
              <p className="m-0">
                {t("tools.format.position", { line: view.line, column: view.column })}
              </p>
            ) : null}
          </div>
        ) : null}

        {view.status === "success" ? (
          <>
            {view.output.warnings.length > 0 || view.output.omittedWarnings > 0 ? (
              <div className="grid gap-ui-4 rounded-control bg-warning-soft p-ui-8 text-xs text-warning">
                <StatusBadge className="justify-self-start" tone="warning">
                  {t("tools.json.duplicateBadge")}
                </StatusBadge>
                <p className="m-0">
                  {t("tools.json.duplicateNote")}
                </p>
                <ul className="m-0 grid gap-ui-2 pl-ui-12">
                  {view.output.warnings.map((warning, index) => (
                    <li key={`${warning.line}:${warning.column}:${index}`}>
                      {t("tools.json.duplicateKey", { key: warning.key, line: warning.line, column: warning.column })}
                    </li>
                  ))}
                </ul>
                {view.output.omittedWarnings > 0 ? (
                  <p className="m-0">
                    {t("tools.json.moreWarnings", { count: view.output.omittedWarnings })}
                  </p>
                ) : null}
              </div>
            ) : null}
            <pre
              tabIndex={0}
              aria-label={t("tools.format.resultLabel")}
              className="m-0 max-h-80 overflow-auto whitespace-pre rounded-control bg-surface-muted p-ui-8 font-mono text-xs"
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
