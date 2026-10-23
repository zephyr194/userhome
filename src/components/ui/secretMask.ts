/** 固定遮盖串：不随秘密值长度变化，避免泄露长度。 */
export const SECRET_MASK = "••••••••";

export interface SecretViewState {
  readonly revealed: boolean;
}

export type SecretViewAction = "reveal" | "hide" | "toggle";

/** 默认遮盖；明文只存在于组件内存状态，不进入任何浏览器存储。 */
export const INITIAL_SECRET_VIEW_STATE: SecretViewState = {
  revealed: false,
};

export function secretViewReducer(
  state: SecretViewState,
  action: SecretViewAction,
): SecretViewState {
  switch (action) {
    case "reveal":
      return { revealed: true };
    case "hide":
      return state.revealed ? INITIAL_SECRET_VIEW_STATE : state;
    case "toggle":
      return { revealed: !state.revealed };
  }
}
