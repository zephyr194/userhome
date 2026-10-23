import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useToolSection } from "../../app/SectionContext";
import { PageShell, SectionTabs, VerticalMenu, type SectionTab, type VerticalMenuItem } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { createScrollMemory } from "../../components/ui/pageScrollMemory";
import { useT } from "../../i18n/useLocale";
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
  type DotenvEditFocus,
  type DotenvEditIntent,
} from "./environmentModel";
import { useDotenvEditor } from "./useDotenvEditor";
import { LaunchctlPage } from "./LaunchctlPage";
import { ZshPage } from "./ZshPage";

type GrantNotice = EnvironmentViewProps["grantNotice"];

type SystemTabId = "zsh" | "launchctl";

function isSystemTab(section: string): section is SystemTabId {
  return section === "zsh" || section === "launchctl";
}

/**
 * The environment page holds two levels: the system variables (zsh startup files
 * and the macOS login session, one tab each) and the dotenv files in authorized
 * directories. The route keeps its three section values; this page maps them to
 * the two levels. Tabs stay fixed above the content, which alone scrolls. The
 * system tabs only read their data the first time they are opened, then stay
 * mounted so their state survives switching back and forth.
 */
export function EnvironmentPage() {
  const t = useT();
  const [section, setSection] = useToolSection("dotenv");
  const [lastSystemTab, setLastSystemTab] = useState<SystemTabId>("zsh");
  if (isSystemTab(section) && section !== lastSystemTab) setLastSystemTab(section);
  const [zshOpened, setZshOpened] = useState(section === "zsh");
  const [launchctlOpened, setLaunchctlOpened] = useState(section === "launchctl");
  if (section === "zsh" && !zshOpened) setZshOpened(true);
  if (section === "launchctl" && !launchctlOpened) setLaunchctlOpened(true);
  // Only the content scrolls; each section keeps its own offset while another one is shown.
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollMemory] = useState(() => createScrollMemory(section));
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = scrollMemory.switchTo(section);
  }, [section, scrollMemory]);

  const domains: readonly VerticalMenuItem[] = [
    {
      id: "system",
      label: t("env.page.domain.system"),
      description: t("env.page.domain.systemDescription"),
    },
    {
      id: "dotenv",
      label: t("env.page.domain.dotenv"),
      description: t("env.page.domain.dotenvDescription"),
    },
  ];
  const systemTabs: readonly SectionTab[] = [
    { id: "zsh", label: t("env.page.tab.zsh") },
    { id: "launchctl", label: t("env.page.tab.launchctl") },
  ];
  const domain = isSystemTab(section) ? "system" : "dotenv";
  const selectDomain = (id: string) => setSection(id === "system" ? lastSystemTab : "dotenv");

  return (
    <div className="environment-page borderless-pane h-full min-h-0 min-w-0">
      <PageShell layout="master-detail" scrollKey={section}>
        <div className="environment-page__menu min-w-0 px-ui-8">
          <VerticalMenu
            items={domains}
            label={t("env.page.menu")}
            onSelect={selectDomain}
            selected={domain}
          />
        </div>
        <div className="environment-page__detail min-w-0">
          {domain === "system" ? (
            <div className="environment-page__tabs shrink-0 min-w-0 px-ui-12">
              <SectionTabs
                label={t("env.page.systemTabs")}
                onSelect={setSection}
                sections={systemTabs}
                selected={section}
              />
            </div>
          ) : null}
          <div
            className="environment-page__content min-w-0"
            onScroll={(event) => scrollMemory.record(event.currentTarget.scrollTop)}
            ref={contentRef}
          >
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
  const [editFocus, setEditFocus] = useState<DotenvEditFocus>();
  const focusCounter = useRef(0);
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

  const editFile = useCallback(
    (intent: DotenvEditIntent) => {
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
      if (intent.kind === "addition") editor.controller.addRow();
      setEditFocus({ id: ++focusCounter.current, target: intent });
    },
    [editor.controller],
  );

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
        focus: editFocus,
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
