import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  enableZshEdit,
  executeZshEdit,
  previewZshEdit,
  readZshEditState,
  type ZshEditTarget,
} from "../../ipc/environment";
import { revokeGrant } from "../../ipc/grants";
import { useT } from "../../i18n/useLocale";
import {
  createZshEditorController,
  type ZshEditorController,
  type ZshEditorState,
} from "./zshEditorController";
import type { ZshDraftCheck } from "./zshEditorModel";

const EXPIRY_POLL_MILLIS = 1000;

/**
 * Wires the zsh block editor state machine to the backend commands. Drafts live
 * only in this hook's controller (component memory): nothing is stored in the
 * browser, and everything is dropped when the editor closes or the page
 * unmounts.
 */
export function useZshEditor(onSaved: (target: ZshEditTarget) => void): {
  controller: ZshEditorController;
  state: ZshEditorState;
  check: ZshDraftCheck | undefined;
} {
  const t = useT();
  const [controller] = useState(() =>
    createZshEditorController({
      load: readZshEditState,
      enable: enableZshEdit,
      revoke: revokeGrant,
      preview: previewZshEdit,
      execute: (target, operationId) => executeZshEdit({ operationId, target }),
    }),
  );
  // Idempotent: keeps the drafts check and new notices in the current language.
  controller.setTranslate(t);
  useEffect(() => {
    controller.setOnSaved(onSaved);
    return () => controller.setOnSaved(undefined);
  }, [controller, onSaved]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const check = useMemo(
    () => controller.check(),
    // `state` is the signal that the drafts changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, state],
  );

  const previewed = state.phase === "previewed";
  useEffect(() => {
    if (!previewed) return;
    const timer = setInterval(
      () => controller.checkExpiry(Date.now()),
      EXPIRY_POLL_MILLIS,
    );
    return () => clearInterval(timer);
  }, [controller, previewed]);

  return { controller, state, check };
}
