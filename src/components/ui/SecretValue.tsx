import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
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
        "inline-flex min-w-0 max-w-full flex-wrap items-center gap-ui-md",
        className,
      )}
      data-secret-state={revealed ? "revealed" : "masked"}
      onBlur={hideWhenFocusLeaves}
      onKeyDown={hideOnEscape}
    >
      <code
        className="min-w-0 break-all rounded-control bg-surface-muted px-ui-md py-ui-xxs font-mono text-aux text-foreground"
        id={valueId}
      >
        {revealed ? (
          value === "" ? (
            <span className="font-sans text-muted-foreground">（空值）</span>
          ) : (
            value
          )
        ) : (
          <>
            <span aria-hidden="true">{SECRET_MASK}</span>
            <span className="sr-only">已隐藏</span>
          </>
        )}
      </code>
      <Button
        aria-controls={valueId}
        aria-label={`${revealed ? "隐藏" : "显示"} ${label} 的值`}
        onClick={() => dispatch("toggle")}
        size="sm"
        variant="ghost"
      >
        {revealed ? "隐藏" : "显示"}
      </Button>
      <Button
        aria-label={`复制 ${label} 的值`}
        onClick={copyValue}
        size="sm"
        variant="ghost"
      >
        复制
      </Button>
      <span className="text-aux text-muted-foreground" role="status">
        {copy === "copied"
          ? "已复制到剪贴板"
          : copy === "failed"
            ? "复制失败：无法写入剪贴板"
            : ""}
      </span>
    </span>
  );
}
