/** 固定遮盖串：不随秘密值长度变化，避免泄露长度。 */
export const SECRET_MASK = "••••••••";

export type SecretCopyFeedback = "idle" | "copied" | "failed";

export interface SecretViewState {
  readonly revealed: boolean;
  readonly copy: SecretCopyFeedback;
}

export type SecretViewAction =
  | "reveal"
  | "hide"
  | "toggle"
  | "copied"
  | "copyFailed";

/** 默认遮盖；明文与复制结果只存在于组件内存状态，不进入任何浏览器存储。 */
export const INITIAL_SECRET_VIEW_STATE: SecretViewState = {
  revealed: false,
  copy: "idle",
};

export function secretViewReducer(
  state: SecretViewState,
  action: SecretViewAction,
): SecretViewState {
  switch (action) {
    case "reveal":
      return { revealed: true, copy: "idle" };
    case "hide":
      return state.revealed || state.copy !== "idle"
        ? INITIAL_SECRET_VIEW_STATE
        : state;
    case "toggle":
      return { revealed: !state.revealed, copy: "idle" };
    case "copied":
      return { ...state, copy: "copied" };
    case "copyFailed":
      return { ...state, copy: "failed" };
  }
}
