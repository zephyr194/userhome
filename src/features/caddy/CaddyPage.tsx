import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActionRow, Button, PageShell, Panel, SectionTabs } from "../../components/ui";
import { useToolSection } from "../../app/SectionContext";
import { routeSectionsOf } from "../../app/routeDefinitions";
import {
  caddyDetect,
  caddyLoadRules,
  caddyPreview,
  caddySave,
  caddyTlsStatus,
  isWorkdirRequired,
  type CaddyExposure,
  type CaddyIssue,
  type CaddyRulesSource,
  type CaddyTlsSiteStatus,
} from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import { selectTlsMaterialGrant } from "../../ipc/grants";
import { CaddyDetectPanel, type DetectState } from "./CaddyDetectPanel";
import { CaddyWorkdirPanel } from "./CaddyWorkdirPanel";
import { useCaddyWorkdir } from "./useCaddyWorkdir";
import { CaddyPreviewPanel } from "./CaddyPreviewPanel";
import { CaddyRulesEditor } from "./CaddyRulesEditor";
import { RouteNavigationContext } from "../../app/routeNavigation";
import { CaddyRunPanel } from "./CaddyRunPanel";
import { serviceFocusIntent, type ServiceTarget } from "./caddyConflictModel";
import { CaddySaveBar, type SaveState } from "./CaddySaveBar";
import { RawEditor } from "./RawEditor";
import {
  createDebouncer,
  createRequestTracker,
  type Debouncer,
  type RequestTracker,
} from "./caddyPreviewFlow";
import {
  createIdSource,
  externalExposures,
  mapIssuesToFields,
  rulesFromDraft,
  saveGate,
  siteDraftsFromRules,
  withTlsGrant,
  type IdSource,
  type PreviewState,
  type SiteDraft,
  type TlsSlot,
} from "./caddyRulesModel";

const PREVIEW_DEBOUNCE_MS = 250;
const NO_ISSUES: CaddyIssue[] = [];
const NO_EXPOSURES: CaddyExposure[] = [];
const CADDY_SECTIONS = routeSectionsOf("caddy");

type EditorSource = "rules" | "raw";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; source: CaddyRulesSource }
  | { status: "failed"; error: AppError };

interface PreviewRuntime {
  tracker: RequestTracker;
  debouncer: Debouncer;
}

function createPreviewRuntime(): PreviewRuntime {
  return {
    tracker: createRequestTracker(),
    debouncer: createDebouncer(PREVIEW_DEBOUNCE_MS, {
      set: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clear: (handle) => window.clearTimeout(handle as number),
    }),
  };
}

export function CaddyPage() {
  const onNavigate = useContext(RouteNavigationContext);
  const [ids] = useState<IdSource>(createIdSource);
  const [runtime] = useState(createPreviewRuntime);
  const [detect, setDetect] = useState<DetectState>({ status: "loading" });
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [sites, setSites] = useState<SiteDraft[]>([]);
  const [tlsStatuses, setTlsStatuses] = useState<CaddyTlsSiteStatus[]>([]);
  const [tlsError, setTlsError] = useState<string | undefined>(undefined);
  const sitesRef = useRef<SiteDraft[]>(sites);
  const [preview, setPreview] = useState<PreviewState>({ status: "pending" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [section, setSection] = useToolSection("rules");
  const [editorSource, setEditorSource] = useState<EditorSource>("rules");
  if ((section === "rules" || section === "raw") && section !== editorSource) {
    setEditorSource(section);
  }
  const showRules = section === "rules";
  const showRaw = section === "raw";
  const showRun = section === "run";
  const workdir = useCaddyWorkdir();
  const workdirReason = workdir.blockReason;
  const workdirReady = workdirReason === undefined;
  const refreshWorkdir = workdir.refresh;

  const schedulePreview = useCallback(
    (next: SiteDraft[]) => {
      setPreview({ status: "pending" });
      runtime.debouncer.schedule(() => {
        const local = rulesFromDraft(next);
        if (!local.ok) {
          runtime.tracker.invalidate();
          setTlsStatuses([]);
          return;
        }
        const requestId = runtime.tracker.issue();
        caddyTlsStatus(local.rules).then(
          (statuses) => {
            if (runtime.tracker.isCurrent(requestId)) setTlsStatuses(statuses);
          },
          () => {
            if (runtime.tracker.isCurrent(requestId)) setTlsStatuses([]);
          },
        );
        caddyPreview(local.rules).then(
          (result) => {
            if (runtime.tracker.isCurrent(requestId)) {
              setPreview({ status: "ready", preview: result });
            }
          },
          (error: AppError) => {
            if (runtime.tracker.isCurrent(requestId)) {
              setPreview({ status: "failed", error });
            }
          },
        );
      });
    },
    [runtime],
  );

  const runDetect = useCallback(() => {
    caddyDetect().then(
      (report) => setDetect({ status: "ready", report }),
      (error: AppError) => setDetect({ status: "failed", error }),
    );
  }, []);

  useEffect(() => {
    runDetect();
  }, [runDetect]);

  function retryDetect() {
    setDetect({ status: "loading" });
    runDetect();
  }

  useEffect(() => {
    if (!workdirReady) return;
    let active = true;
    caddyLoadRules().then(
      (loaded) => {
        if (!active) return;
        const drafts = siteDraftsFromRules(loaded.rules, ids);
        sitesRef.current = drafts;
        setSites(drafts);
        setLoad({ status: "ready", source: loaded.source });
        schedulePreview(drafts);
      },
      (error: AppError) => {
        if (!active) return;
        if (isWorkdirRequired(error)) {
          refreshWorkdir();
          return;
        }
        setLoad({ status: "failed", error });
      },
    );
    return () => {
      active = false;
    };
  }, [ids, schedulePreview, workdirReady, refreshWorkdir]);

  useEffect(
    () => () => {
      runtime.debouncer.cancel();
      runtime.tracker.invalidate();
    },
    [runtime],
  );

  const localResult = useMemo(() => rulesFromDraft(sites), [sites]);
  const saving = saveState.status === "saving";
  const gate =
    workdirReason === undefined
      ? saveGate({ localValid: localResult.ok, preview, saving })
      : { enabled: false, reason: workdirReason };
  const validation = useMemo(
    () => (preview.status === "ready" ? preview.preview.validation : undefined),
    [preview],
  );
  const exposures = validation?.exposures ?? NO_EXPOSURES;
  const exposedSites = useMemo(
    () => new Set(externalExposures(exposures).map((exposure) => exposure.site)),
    [exposures],
  );
  const mapped = useMemo(
    () => mapIssuesToFields(validation?.issues ?? NO_ISSUES),
    [validation],
  );

  async function pickTlsFile(siteIndex: number, slot: TlsSlot) {
    setTlsError(undefined);
    try {
      const result = await selectTlsMaterialGrant();
      if (result.status !== "SELECTED") return;
      changeSites(withTlsGrant(sitesRef.current, siteIndex, slot, result.grant.id));
    } catch (error) {
      setTlsError((error as AppError).message);
    }
  }

  function changeSites(next: SiteDraft[]) {
    sitesRef.current = next;
    setSites(next);
    runtime.tracker.invalidate();
    setSaveState((current) => (current.status === "saving" ? current : { status: "idle" }));
    schedulePreview(next);
  }

  function save() {
    if (!localResult.ok) return;
    setSaveState({ status: "saving" });
    caddySave(localResult.rules).then(
      () => {
        setSaveState({ status: "saved" });
        runtime.tracker.invalidate();
        schedulePreview(sitesRef.current);
      },
      (error: AppError) => setSaveState({ status: "failed", error }),
    );
  }

  return (
    <PageShell layout="strip" scrollKey="compact">
      {onNavigate ? (
        <ActionRow>
          <Button
            className="caddy-back"
            size="sm"
            onClick={() => onNavigate({ routeId: "systemTools" })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14.5 6 8.5 12l6 6" />
            </svg>
            返回系统工具
          </Button>
        </ActionRow>
      ) : null}
      <SectionTabs
        label="Caddy 分区"
        sections={CADDY_SECTIONS}
        selected={section}
        onSelect={setSection}
      />
      <div className="page-shell__cell">
        <Panel className="caddy-status grid min-w-0 p-ui-8">
          <CaddyWorkdirPanel
            load={workdir.load}
            action={workdir.action}
            legacyPath={workdir.legacyPath}
            onRetry={refreshWorkdir}
            onSelect={workdir.select}
            onUseDefault={workdir.useDefault}
            onConfirmRevoke={workdir.confirmRevoke}
            onCancelRevoke={workdir.cancelRevoke}
            onRevoke={workdir.revoke}
            onDismissLegacy={workdir.dismissLegacy}
          />
          <CaddyDetectPanel state={detect} onRetry={retryDetect} />
        </Panel>
      </div>
      <div className="page-shell__cell" hidden={!showRules}>
        <div className="grid min-w-0 gap-ui-12">
          {workdirReason !== undefined && workdir.load.status !== "loading" ? (
            <p role="status" className="m-0 text-body text-muted-foreground">
              {workdirReason}后才能读取或保存规则。
            </p>
          ) : null}
          {load.status === "loading" && (workdirReady || workdir.load.status === "loading") ? (
            <p role="status" className="m-0 text-body text-muted-foreground">
              正在读取已保存的规则……
            </p>
          ) : null}
          {workdirReady && load.status === "failed" ? (
            <Panel role="alert" className="grid gap-ui-8 p-ui-8">
              <p className="m-0 text-body font-semibold text-danger">无法读取已保存的规则</p>
              <p className="m-0 text-body">{load.error.message}</p>
              <p className="m-0 text-aux text-muted-foreground">
                规则未能读取，因此保存已停用，以免覆盖现有文件。
              </p>
            </Panel>
          ) : null}
          {workdirReady && load.status === "ready" ? (
            <>
              {load.source === "DEFAULT" ? (
                <p role="status" className="m-0 text-body text-muted-foreground">
                  尚未保存任何规则，下方是默认示例。保存后才会写入私有目录。
                </p>
              ) : null}
              {tlsError ? (
                <p role="alert" className="m-0 text-aux text-danger">
                  {tlsError}
                </p>
              ) : null}
              <CaddyRulesEditor
                sites={sites}
                localErrors={localResult.ok ? {} : localResult.errors}
                mapped={mapped}
                exposedSites={exposedSites}
                tlsStatuses={tlsStatuses}
                ids={ids}
                onChange={changeSites}
                onPickTlsFile={(siteIndex, slot) => void pickTlsFile(siteIndex, slot)}
              />
              <CaddySaveBar gate={gate} saveState={saveState} onSave={save} />
              <CaddyPreviewPanel localValid={localResult.ok} preview={preview} exposures={exposures} />
            </>
          ) : null}
        </div>
      </div>
      <div className="page-shell__cell" hidden={!showRun}>
        <CaddyRunPanel
          source={editorSource === "raw" ? "RAW" : "RULES"}
          onOpenService={(target: ServiceTarget) => onNavigate?.(serviceFocusIntent(target))}
          workdirReason={workdirReason}
        />
      </div>
      <div className="page-shell__cell" hidden={!showRaw}>
        <RawEditor
          hidden={!showRaw}
          workdirReason={workdirReason}
          onWorkdirRequired={refreshWorkdir}
        />
      </div>
    </PageShell>
  );
}
