import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useT } from "../../i18n/useLocale";
import { Button } from "./Button";
import { classNames } from "./classNames";
import {
  INITIAL_SECRET_VIEW_STATE,
  SECRET_MASK,
  secretViewReducer,
} from "./secretMask";

export interface SecretValueProps {
  className?: string;
  /** 秘密所属项的可访问名称（如变量名），用于按钮的 aria-label。 */
  label: string;
  /** 改变该值会丢弃显示状态并恢复遮盖，用于切换到另一个条目时。 */
  resetKey?: string | number;
  value: string;
}

export function SecretValue({ resetKey, ...props }: SecretValueProps) {
  return <SecretValueView key={resetKey} {...props} />;
}

function SecretValueView({
  className,
  label,
  value,
}: Omit<SecretValueProps, "resetKey">) {
  const [state, dispatch] = useReducer(
    secretViewReducer,
    INITIAL_SECRET_VIEW_STATE,
  );
  const valueId = useId();
  const t = useT();
  const { copy, revealed } = state;

  useEffect(() => {
    if (!revealed) return;
    const hideWhenBackgrounded = () => {
      if (document.visibilityState === "hidden") dispatch("hide");
    };
    document.addEventListener("visibilitychange", hideWhenBackgrounded);
    return () =>
      document.removeEventListener("visibilitychange", hideWhenBackgrounded);
  }, [revealed]);

  const hideWhenFocusLeaves = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        dispatch("hide");
      }
    },
    [],
  );

  const hideOnEscape = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") dispatch("hide");
  }, []);

  const copyValue = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      dispatch("copied");
    } catch {
      dispatch("copyFailed");
    }
  };

  return (
    <span
      className={classNames(
        "inline-flex min-w-0 max-w-full flex-wrap items-center gap-ui-8",
        className,
      )}
      data-secret-state={revealed ? "revealed" : "masked"}
      onBlur={hideWhenFocusLeaves}
      onKeyDown={hideOnEscape}
    >
      <code
        className="min-w-0 break-all rounded-control bg-surface-muted px-ui-8 py-ui-2 font-mono text-aux text-foreground"
        id={valueId}
      >
        {revealed ? (
          value === "" ? (
            <span className="font-sans text-muted-foreground">
              {t("common.secret.emptyValue")}
            </span>
          ) : (
            value
          )
        ) : (
          <>
            <span aria-hidden="true">{SECRET_MASK}</span>
            <span className="sr-only">{t("common.secret.hiddenValue")}</span>
          </>
        )}
      </code>
      <Button
        aria-controls={valueId}
        aria-label={
          revealed
            ? t("common.secret.hideValueOf", { label })
            : t("common.secret.showValueOf", { label })
        }
        onClick={() => dispatch("toggle")}
        variant="ghost"
      >
        {revealed ? t("common.secret.hide") : t("common.secret.show")}
      </Button>
      <Button
        aria-label={t("common.secret.copyValueOf", { label })}
        onClick={copyValue}
        variant="ghost"
      >
        {t("common.copy")}
      </Button>
      <span className="text-aux text-muted-foreground" role="status">
        {copy === "copied"
          ? t("common.clipboard.copied")
          : copy === "failed"
            ? t("common.clipboard.writeFailed")
            : ""}
      </span>
    </span>
  );
}
