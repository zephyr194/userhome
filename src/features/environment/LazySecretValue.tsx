import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type FocusEvent,
  type Ref,
} from "react";
import { Button } from "../../components/ui";
import { SecretValue } from "../../components/ui/SecretValue";
import { SECRET_MASK } from "../../components/ui/secretMask";
import { decodeAppError } from "../../ipc/core";
import {
  INITIAL_LAZY_VALUE,
  lazyValueReducer,
  type LazyValueState,
} from "./environmentModel";

export interface LazySecretValueProps {
  /** 条目名称，用于按钮的可访问名称。 */
  label: string;
  /** 取回明文；只在用户点击“载入”后调用，结果不得被缓存。 */
  load: () => Promise<string>;
  /** 改变它会丢弃已取回的明文（切换文件或条目）。 */
  resetKey: string;
}

/**
 * 列表不携带秘密值：用户先显式“载入”，明文才从后端取回并交给共享
 * SecretValue（默认遮盖，再显式显示/复制）。焦点离开、页面隐藏、切换条目或
 * 卸载时明文随组件状态一并丢弃，不写入任何浏览器存储。
 */
export function LazySecretValue({ resetKey, ...props }: LazySecretValueProps) {
  return <LazySecretValueView key={resetKey} {...props} />;
}

function LazySecretValueView({
  label,
  load,
}: Omit<LazySecretValueProps, "resetKey">) {
  const [state, dispatch] = useReducer(lazyValueReducer, INITIAL_LAZY_VALUE);
  const wrapper = useRef<HTMLSpanElement>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready) return;
    // The fetch button is gone; keep keyboard focus inside this entry.
    wrapper.current?.querySelector("button")?.focus();
    const discardWhenBackgrounded = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "discard" });
    };
    document.addEventListener("visibilitychange", discardWhenBackgrounded);
    return () =>
      document.removeEventListener("visibilitychange", discardWhenBackgrounded);
  }, [ready]);

  const discardWhenFocusLeaves = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        dispatch({ type: "discard" });
      }
    },
    [],
  );

  const fetchValue = async () => {
    dispatch({ type: "load" });
    try {
      const value = await load();
      if (active.current) dispatch({ type: "loaded", value });
    } catch (error) {
      if (active.current) {
        dispatch({ type: "failed", message: decodeAppError(error).message });
      }
    }
  };

  return (
    <LazySecretValueBody
      onBlur={discardWhenFocusLeaves}
      onFetch={() => void fetchValue()}
      label={label}
      state={state}
      wrapper={wrapper}
    />
  );
}

export function LazySecretValueBody({
  label,
  onBlur,
  onFetch,
  state,
  wrapper,
}: {
  label: string;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onFetch: () => void;
  state: LazyValueState;
  wrapper?: Ref<HTMLSpanElement>;
}) {
  if (state.status === "ready") {
    return (
      <span
        className="inline-flex min-w-0 max-w-full"
        onBlur={onBlur}
        ref={wrapper}
      >
        <SecretValue label={label} value={state.value} />
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-ui-md">
      <code className="rounded-control bg-surface-muted px-ui-md py-ui-xxs font-mono text-aux text-foreground">
        <span aria-hidden="true">{SECRET_MASK}</span>
        <span className="sr-only">已隐藏，值尚未载入</span>
      </code>
      <Button
        aria-label={`载入 ${label} 的值`}
        disabled={state.status === "loading"}
        onClick={onFetch}
        size="sm"
        variant="ghost"
      >
        {state.status === "loading" ? "载入中…" : "载入值"}
      </Button>
      <span className="text-aux text-danger" role="status">
        {state.status === "failed" ? `载入失败：${state.message}` : ""}
      </span>
    </span>
  );
}
