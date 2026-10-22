import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useToolSection } from "../../app/SectionContext";
import { PageShell, VerticalMenu, type VerticalMenuItem } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { decodeAppError } from "../../ipc/core";
import {
  readEnvironmentFile,
  revealEnvironmentValue,
  scanEnvironmentFiles,
  type EnvRow,
} from "../../ipc/environment";
import {
  listGrants,
  revokeGrant,
  selectDirectoryGrant,
  selectSaveLocationGrant,
} from "../../ipc/grants";
import type { EditorTarget } from "./dotenvEditorModel";
import { EnvironmentView, type EnvironmentViewProps } from "./EnvironmentView";
import {
  INITIAL_ENVIRONMENT_STATE,
  checkSettings,
  environmentReducer,
} from "./environmentModel";
import { useDotenvEditor } from "./useDotenvEditor";
import { LaunchctlPage } from "./LaunchctlPage";
import { ZshPage } from "./ZshPage";

type GrantNotice = EnvironmentViewProps["grantNotice"];

const DOMAINS: readonly VerticalMenuItem[] = [
  { id: "dotenv", label: "项目 dotenv", description: "授权目录中的 .env 文件" },
  { id: "zsh", label: "用户 zsh", description: "启动文件与读取顺序" },
  { id: "launchctl", label: "登录会话", description: "GUI 应用看到的变量" },
];

/**
 * The environment page holds three domains in one place, without a new
 * navigation entry: dotenv files in authorized directories, the current user's
 * zsh startup files, and the macOS login session. The zsh and login session
 * domains only read their data the first time they are opened, and then stay
 * mounted so their state survives switching back and forth.
 */
export function EnvironmentPage() {
  const [section, setSection] = useToolSection("dotenv");
  const [zshOpened, setZshOpened] = useState(section === "zsh");
  const [launchctlOpened, setLaunchctlOpened] = useState(section === "launchctl");
  if (section === "zsh" && !zshOpened) setZshOpened(true);
  if (section === "launchctl" && !launchctlOpened) setLaunchctlOpened(true);
  return (
    <div className="environment-page h-full min-h-0 min-w-0">
      <PageShell layout="master-detail" scrollKey={section}>
        <div className="environment-page__menu min-w-0">
          <VerticalMenu
            items={DOMAINS}
            label="环境变量域"
            onSelect={setSection}
            selected={section}
          />
        </div>
        <div className="min-w-0">
          <div className="min-w-0" hidden={section !== "dotenv"}>
            <DotenvPage />
          </div>
          <div className="min-w-0" hidden={section !== "zsh"}>
            <PageRegion>{zshOpened ? <ZshPage /> : null}</PageRegion>
          </div>
          <div className="min-w-0" hidden={section !== "launchctl"}>
            <PageRegion>{launchctlOpened ? <LaunchctlPage /> : null}</PageRegion>
          </div>
        </div>
      </PageShell>
    </div>
  );
}

/**
 * Wires the environment view and the key editor to the backend. Nothing is
 * stored in the browser: authorizations, scan results, revealed values and
 * editor drafts only live in component state, and every response is matched
 * to the request that asked for it.
 */
function DotenvPage() {
  const [state, dispatch] = useReducer(
    environmentReducer,
    INITIAL_ENVIRONMENT_STATE,
  );
  const [addingGrant, setAddingGrant] = useState(false);
  const [choosingNewFile, setChoosingNewFile] = useState(false);
  const [grantNotice, setGrantNotice] = useState<GrantNotice>();
  const requestCounter = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadGrants = useCallback(async (preferred?: string) => {
    try {
      const grants = await listGrants();
      dispatch({ type: "grantsLoaded", grants });
      if (preferred) dispatch({ type: "grantSelected", grantId: preferred });
    } catch (error) {
      dispatch({ type: "grantsFailed", error: decodeAppError(error) });
    }
  }, []);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const addGrant = useCallback(async () => {
    setAddingGrant(true);
    setGrantNotice(undefined);
    try {
      const result = await selectDirectoryGrant();
      if (result.status === "CANCELLED") {
        setGrantNotice({ tone: "info", text: "已取消，没有添加授权。" });
      } else {
        await loadGrants(result.grant.id);
      }
    } catch (error) {
      setGrantNotice({ tone: "error", text: decodeAppError(error).message });
    } finally {
      setAddingGrant(false);
    }
  }, [loadGrants]);

  const revoke = useCallback(
    async (grantId: string) => {
      setGrantNotice(undefined);
      try {
        await revokeGrant(grantId);
        setGrantNotice({ tone: "info", text: "授权已撤销。" });
      } catch (error) {
        setGrantNotice({ tone: "error", text: decodeAppError(error).message });
      }
      await loadGrants();
    },
    [loadGrants],
  );

  const scan = useCallback(() => {
    const current = stateRef.current;
    const check = checkSettings(current.patternsText, current.recursive);
    if (!current.selectedGrantId || !check.ok) return;
    const requestId = ++requestCounter.current;
    dispatch({ type: "scanRequested", requestId });
    scanEnvironmentFiles(current.selectedGrantId, check.settings).then(
      (outcome) =>
        dispatch({
          type: "scanSucceeded",
          requestId,
          outcome,
          settings: check.settings,
        }),
      (error: unknown) =>
        dispatch({
          type: "scanFailed",
          requestId,
          error: decodeAppError(error),
        }),
    );
  }, []);

  const selectFile = useCallback((path: string) => {
    const current = stateRef.current;
    if (!current.selectedGrantId || current.scan.status !== "ready") return;
    const requestId = ++requestCounter.current;
    dispatch({ type: "fileRequested", requestId, path });
    readEnvironmentFile(current.selectedGrantId, path, current.scan.settings).then(
      (outcome) => dispatch({ type: "fileLoaded", requestId, outcome }),
      (error: unknown) =>
        dispatch({ type: "fileFailed", requestId, error: decodeAppError(error) }),
    );
  }, []);

  // After a transaction ran, show what the file now contains.
  const reloadAfterSave = useCallback(
    (target: EditorTarget) => {
      if (target.kind === "existing") selectFile(target.path);
    },
    [selectFile],
  );
  const editor = useDotenvEditor(reloadAfterSave);

  const editFile = useCallback(() => {
    const current = stateRef.current;
    if (
      !current.selectedGrantId ||
      current.scan.status !== "ready" ||
      current.file.status !== "loaded" ||
      current.file.outcome.status !== "READY"
    ) {
      return;
    }
    editor.controller.openExisting({
      grantId: current.selectedGrantId,
      path: current.file.path,
      settings: current.scan.settings,
      file: current.file.outcome.file,
    });
  }, [editor.controller]);

  // The native save panel names the target and the file name; the backend turns
  // that into a one-file authorization. Nothing is created until a preview is
  // confirmed.
  const newFile = useCallback(async () => {
    setChoosingNewFile(true);
    setGrantNotice(undefined);
    try {
      const result = await selectSaveLocationGrant();
      if (result.status === "CANCELLED") {
        setGrantNotice({ tone: "info", text: "已取消，没有创建文件。" });
      } else {
        editor.controller.openNew({
          grantId: result.grant.id,
          displayPath: result.grant.displayPath,
        });
      }
    } catch (error) {
      setGrantNotice({ tone: "error", text: decodeAppError(error).message });
    } finally {
      setChoosingNewFile(false);
    }
  }, [editor.controller]);

  // The plaintext goes straight to the caller (LazySecretValue) and is never
  // kept in page state.
  const loadValue = useCallback(
    (row: Extract<EnvRow, { kind: "ENTRY" }>) => {
      const current = stateRef.current;
      if (
        !current.selectedGrantId ||
        current.scan.status !== "ready" ||
        current.file.status !== "loaded"
      ) {
        return Promise.reject({
          code: "CONFLICT",
          message: "文件已变化，请重新选择文件。",
          retryable: false,
        });
      }
      return revealEnvironmentValue(
        current.selectedGrantId,
        current.file.path,
        current.scan.settings,
        { line: row.line, key: row.key },
      );
    },
    [],
  );

  return (
    <EnvironmentView
      addingGrant={addingGrant}
      choosingNewFile={choosingNewFile}
      editor={{
        actions: editor.controller,
        check: editor.check,
        state: editor.state,
      }}
      grantNotice={grantNotice}
      onEditFile={editFile}
      onNewFile={() => void newFile()}
      onAddGrant={() => void addGrant()}
      onLoadValue={loadValue}
      onPatternsChange={(text) => dispatch({ type: "patternsChanged", text })}
      onRecursiveChange={(recursive) =>
        dispatch({ type: "recursiveChanged", recursive })
      }
      onReloadGrants={() => void loadGrants()}
      onRevokeGrant={(grantId) => void revoke(grantId)}
      onScan={scan}
      onSelectFile={selectFile}
      onSelectGrant={(grantId) => dispatch({ type: "grantSelected", grantId })}
      state={state}
    />
  );
}
