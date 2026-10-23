import { useCallback, useRef, useState } from "react";
import { Button, CodeViewer } from "../../components/ui";
import type { CodeLanguage } from "../../components/ui/codeTokens";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  readAiConfigFile,
  type AiConfigFileView,
  type AiConfigLanguage,
  type AiToolId,
} from "../../ipc/aiConfig";
import { decodeAppError, type AppError } from "../../ipc/core";

type ConfigFileState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "failed"; error: AppError }
  | { status: "ready"; view: AiConfigFileView };

const CODE_LANGUAGES: Record<AiConfigLanguage, CodeLanguage> = {
  json: "json",
  toml: "toml",
  yaml: "plain",
  markdown: "plain",
  text: "plain",
};

export function ConfigFileViewer({ toolId }: { readonly toolId: AiToolId }) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<ConfigFileState>({ status: "closed" });
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState({ status: "loading" });
    readAiConfigFile(toolId).then(
      (view) => {
        if (requestRef.current === request) setState({ status: "ready", view });
      },
      (error: unknown) => {
        if (requestRef.current === request) {
          setState({ status: "failed", error: decodeAppError(error) });
        }
      },
    );
  }, [toolId]);

  const close = useCallback(() => {
    requestRef.current += 1;
    setState({ status: "closed" });
  }, []);

  if (state.status === "closed") {
    return (
      <section
        aria-labelledby={`ai-config-file-${toolId}`}
        className="grid min-w-0 justify-items-start gap-ui-4 border-t border-border pt-ui-8"
      >
        <h4 id={`ai-config-file-${toolId}`} className="m-0 text-body font-semibold">
          {t("aiConfig.file.heading")}
        </h4>
        <p className="m-0 text-aux text-muted-foreground">{t("aiConfig.file.note")}</p>
        <Button size="sm" onClick={load}>
          {t("aiConfig.file.open")}
        </Button>
      </section>
    );
  }

  const loading = state.status === "loading";
  return (
    <section
      aria-labelledby={`ai-config-file-${toolId}`}
      className="grid min-w-0 gap-ui-8 border-t border-border pt-ui-8"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-ui-8">
        <div className="grid min-w-0 gap-ui-4">
          <h4 id={`ai-config-file-${toolId}`} className="m-0 text-body font-semibold">
            {t("aiConfig.file.heading")}
          </h4>
          <p className="m-0 text-aux text-muted-foreground">{t("aiConfig.file.note")}</p>
        </div>
        <span className="flex flex-wrap gap-ui-4">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {t("aiConfig.file.refresh")}
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            {t("aiConfig.file.close")}
          </Button>
        </span>
      </div>
      {state.status === "loading" ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.file.loading")}
        </p>
      ) : null}
      {state.status === "failed" ? (
        <div role="alert" className="grid justify-items-start gap-ui-4">
          <p className="m-0 text-aux font-semibold text-danger">{t("aiConfig.file.failed")}</p>
          <p className="m-0 text-aux">{localizeError(state.error, locale)}</p>
          <Button size="sm" onClick={load}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "ready" ? <ConfigFileBody view={state.view} /> : null}
    </section>
  );
}

function ConfigFileBody({ view }: { readonly view: AiConfigFileView }) {
  const t = useT();
  if (!view.exists) {
    return (
      <div className="grid min-w-0 gap-ui-4">
        <p className="m-0 break-all font-mono text-aux">{view.displayPath}</p>
        <p className="m-0 text-aux">{t("aiConfig.file.absent")}</p>
      </div>
    );
  }
  const notices = [
    view.truncated ? t("aiConfig.file.truncated") : null,
    view.redactedCount > 0
      ? t("aiConfig.file.redacted", { count: view.redactedCount })
      : null,
  ].filter((notice): notice is string => notice !== null);
  return (
    <CodeViewer
      label={t("aiConfig.file.label")}
      language={CODE_LANGUAGES[view.language]}
      text={view.content ?? ""}
      title={view.displayPath.split("/").pop() ?? view.displayPath}
      notice={
        notices.length > 0 ? (
          <span className="grid gap-ui-4">
            {notices.map((notice) => (
              <span key={notice}>{notice}</span>
            ))}
          </span>
        ) : undefined
      }
    />
  );
}
