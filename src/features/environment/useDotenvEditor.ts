import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  executeEnvironmentEdit,
  previewEnvironmentCreate,
  previewEnvironmentEdit,
} from "../../ipc/environment";
import {
  createDotenvEditorController,
  type DotenvEditorController,
  type EditorState,
} from "./dotenvEditorController";
import type { DraftCheck, EditorTarget } from "./dotenvEditorModel";

const EXPIRY_POLL_MILLIS = 1000;

/**
 * Wires the editor state machine to the backend commands. Drafts live only in
 * this hook's controller (component memory): nothing is stored in the browser,
 * and everything is dropped when the editor closes or the page unmounts.
 */
export function useDotenvEditor(onSaved: (target: EditorTarget) => void): {
  controller: DotenvEditorController;
  state: EditorState;
  check: DraftCheck;
} {
  const [controller] = useState(() =>
    createDotenvEditorController({
      preview: (target, edits) =>
        target.kind === "existing"
          ? previewEnvironmentEdit(
              target.grantId,
              target.path,
              target.settings,
              target.file.contentHash,
              edits,
            )
          : previewEnvironmentCreate(target.grantId, edits),
      execute: (target, operationId) =>
        executeEnvironmentEdit({
          operationId,
          grantId: target.grantId,
          ...(target.kind === "existing" ? { relativePath: target.path } : {}),
        }),
    }),
  );
  useEffect(() => {
    controller.setOnSaved(onSaved);
    return () => controller.setOnSaved(undefined);
  }, [controller, onSaved]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const check = useMemo<DraftCheck>(
    () =>
      controller.check() ?? {
        edits: [],
        problems: { entries: {}, additions: {} },
        ready: false,
      },
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
