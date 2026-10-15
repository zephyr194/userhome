/**
 * Returns focus to the control that opened a dialog, once the dialog has
 * unmounted. When that control is gone (the notice hid itself after a
 * successful reset) focus goes to the main content, as AppShell does after the
 * quit confirmation.
 */
export function restoreFocus(target: HTMLElement | null): void {
  window.setTimeout(() => {
    (target?.isConnected
      ? target
      : document.getElementById("main-content")
    )?.focus({ preventScroll: true });
  }, 0);
}
