import { describe, expect, it } from "vitest";
import type { AdoptExecution, AdoptPreview } from "../../ipc/servicesAdopt";
import type { AppError } from "../../ipc/core";
import type { LaunchdOwnership, LaunchdPlistDetails } from "../../ipc/services";
import {
  APPLE_OWNERSHIP,
  DAEMON_OWNERSHIP,
  THIRD_PARTY_OWNERSHIP,
  configFile,
  createdService,
  launchdService,
  ownership,
} from "./launchdFixtures";
import {
  INITIAL_ADOPT_FLOW,
  adoptFlowReducer,
  type AdoptFlowState,
} from "./adoptServiceModel";
import * as adoptModel from "./adoptServiceModel";
import { withZh } from "./testTranslators";

const adoptionBlockers = withZh(adoptModel.adoptionBlockers);
const describeAdoptFailure = withZh(adoptModel.describeAdoptFailure);
const describeAdoptSuccess = withZh(adoptModel.describeAdoptSuccess);
const editBlockers = withZh(adoptModel.editBlockers);
const managementOf = withZh(adoptModel.managementOf);

const LABEL = "com.vendor.backup";

const USERHOME_ADOPTED: LaunchdOwnership = ownership({
  kind: "USERHOME_ADOPTED",
  modifiable: true,
  readOnlyReasons: [],
  evidence: ["ADOPTION_RECORD", "DOMAIN_GUI", "OWNER_CURRENT_USER", "REGULAR_FILE"],
});

/** A current user's job with no program key, so it is editable once adopted. */
function plistDetails(overrides: Partial<LaunchdPlistDetails> = {}): LaunchdPlistDetails {
  return {
    programArguments: ["/usr/local/bin/tool", "--serve"],
    argumentsTruncated: false,
    environmentKeys: ["MODE"],
    runAtLoad: false,
    keepAlive: { mode: "NEVER", conditions: [] },
    ...overrides,
  };
}

function editableFile() {
  return configFile({ details: plistDetails() });
}

function adoptPreview(): AdoptPreview {
  return {
    operationId: "op-1",
    summary: `接管任务 ${LABEL}`,
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    label: LABEL,
    domain: "GUI",
    source: "~/Library/LaunchAgents（当前用户）",
    filePath: `~/Library/LaunchAgents/${LABEL}.plist`,
    backup: "执行前备份",
    changedFields: [],
    externalManagerNote: "可能由外部工具管理",
    effectNote: "接管只记录所有权",
  };
}

function adoptExecution(): AdoptExecution {
  return {
    operationId: "op-1",
    summary: "done",
    effects: [],
    expiresAt: "2026-10-20T10:05:00Z",
    status: "SUCCEEDED",
    events: [],
    label: LABEL,
    domain: "GUI",
    filePath: `~/Library/LaunchAgents/${LABEL}.plist`,
    backupId: "adopt-0123",
    plistChanged: false,
    effectNote: "接管只记录所有权",
  };
}

const ERROR: AppError = { code: "CONFLICT", message: "changed", retryable: false };

describe("management entry per ownership class", () => {
  it("offers adoption for the current user's own job", () => {
    expect(managementOf(launchdService())).toEqual({ kind: "adopt" });
  });

  it("explains, without a button, why a current user's job cannot be adopted", () => {
    const view = managementOf(
      launchdService({
        ownership: ownership({
          readOnlyReasons: ["NOT_ADOPTED", "SYMBOLIC_LINK"],
          evidence: ["SYMBOLIC_LINK"],
        }),
      }),
    );
    expect(view.kind).toBe("adoptBlocked");
    if (view.kind !== "adoptBlocked") return;
    expect(view.reasons).toHaveLength(1);
    expect(view.reasons[0]).toContain("符号链接");
  });

  it("offers an edit and a release for an adopted job", () => {
    const view = managementOf(
      launchdService({
        ownership: USERHOME_ADOPTED,
        configFiles: [editableFile()],
      }),
    );
    expect(view).toEqual({ kind: "adopted", editBlockers: [] });
  });

  it("gives no entry to a system, Apple, third-party or UserHome-created job", () => {
    for (const ownershipClass of [
      APPLE_OWNERSHIP,
      DAEMON_OWNERSHIP,
      THIRD_PARTY_OWNERSHIP,
    ]) {
      expect(managementOf(launchdService({ ownership: ownershipClass }))).toEqual({
        kind: "none",
      });
    }
    expect(managementOf(createdService())).toEqual({ kind: "none" });
  });
});

describe("adoption blockers", () => {
  it("refuses a job whose discovery found more than one configuration file", () => {
    const reasons = adoptionBlockers(
      launchdService({ configFiles: [editableFile(), editableFile()] }),
    );
    expect(reasons.join("")).toContain("多个配置文件");
  });

  it("ignores only the not-adopted reason", () => {
    expect(adoptionBlockers(launchdService())).toEqual([]);
  });
});

describe("edit blockers", () => {
  it("refuses a job that still uses the Program key", () => {
    const reasons = editBlockers(
      launchdService({
        ownership: USERHOME_ADOPTED,
        configFiles: [configFile({ details: plistDetails({ program: "/bin/x" }) })],
      }),
    );
    expect(reasons.join("")).toContain("Program");
  });

  it("refuses an adopted job whose verdict is read-only, with the reasons", () => {
    const reasons = editBlockers(
      launchdService({
        ownership: ownership({
          kind: "USERHOME_ADOPTED",
          modifiable: false,
          readOnlyReasons: ["LABEL_NOT_FROM_PLIST"],
          evidence: ["ADOPTION_RECORD"],
        }),
        configFiles: [editableFile()],
      }),
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("refuses a job whose configuration could not be read or was truncated", () => {
    expect(
      editBlockers(
        launchdService({
          ownership: USERHOME_ADOPTED,
          configFiles: [configFile({ details: undefined })],
        }),
      ).join(""),
    ).toContain("无法读取");
    expect(
      editBlockers(
        launchdService({
          ownership: USERHOME_ADOPTED,
          configFiles: [configFile({ details: plistDetails({ argumentsTruncated: true }) })],
        }),
      ).join(""),
    ).toContain("过长");
  });
});

describe("adoption flow", () => {
  function walk(...actions: Parameters<typeof adoptFlowReducer>[1][]): AdoptFlowState {
    return actions.reduce(adoptFlowReducer, INITIAL_ADOPT_FLOW);
  }

  it("runs preview, confirmation and success in order", () => {
    const state = walk(
      { type: "previewRequested" },
      { type: "previewLoaded", preview: adoptPreview() },
      { type: "confirmRequested" },
      { type: "executed", execution: adoptExecution() },
    );
    expect(state.phase).toBe("done");
  });

  it("ignores an event that does not fit the phase", () => {
    expect(adoptFlowReducer(INITIAL_ADOPT_FLOW, { type: "confirmRequested" })).toBe(
      INITIAL_ADOPT_FLOW,
    );
    const previewed = walk(
      { type: "previewRequested" },
      { type: "previewLoaded", preview: adoptPreview() },
    );
    expect(adoptFlowReducer(previewed, { type: "executed", execution: adoptExecution() })).toBe(
      previewed,
    );
  });

  it("keeps the preview when the confirmation is refused, so it can be re-previewed", () => {
    const failed = walk(
      { type: "previewRequested" },
      { type: "previewLoaded", preview: adoptPreview() },
      { type: "confirmRequested" },
      { type: "executeFailed", error: ERROR },
    );
    expect(failed).toEqual({ phase: "failed", error: ERROR, preview: adoptPreview() });
    expect(adoptFlowReducer(failed, { type: "previewRequested" })).toEqual({ phase: "previewing" });
  });
});

describe("adoption wording", () => {
  it("names the backend's own category for each refusal kind", () => {
    const cases: [AppError["code"], string][] = [
      ["NOT_FOUND", "已不存在"],
      ["CONFLICT", "已变化"],
      ["PERMISSION_DENIED", "接管被拒绝"],
      ["VALIDATION_FAILED", "接管未完成"],
    ];
    for (const [code, text] of cases) {
      expect(describeAdoptFailure({ code, message: "后端原因", retryable: false }).title).toContain(text);
    }
  });

  it("passes the backend's per-reason refusal text through", () => {
    const notice = describeAdoptFailure({
      code: "PERMISSION_DENIED",
      message: "该任务不能接管：plist 为二进制格式，无法保真编辑，已拒绝。",
      retryable: false,
    });
    expect(notice.detail).toContain("二进制格式");
  });

  it("shows the backup and the read-back result on success", () => {
    const notice = describeAdoptSuccess(adoptExecution());
    expect(notice.title).toContain(LABEL);
    expect(notice.detail).toContain("adopt-0123");
    expect(notice.detail).toContain("回读确认");
  });
});
