// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditExecution, EditPreview } from "../../ipc/servicesAdopt";
import type { LaunchdOwnership } from "../../ipc/services";
import { configFile, launchdService, ownership } from "./launchdFixtures";
import { ServiceManagement } from "./ServiceManagement";

const mocks = vi.hoisted(() => ({
  discard: vi.fn(),
  execute: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("../../ipc/servicesAdopt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/servicesAdopt")>()),
  discardEditLaunchdService: mocks.discard,
  executeEditLaunchdService: mocks.execute,
  previewEditLaunchdService: mocks.preview,
}));

const LABEL = "com.vendor.backup";
const FILE = `~/Library/LaunchAgents/${LABEL}.plist`;
const SAVED_TITLE = `已保存配置 ${FILE}`;

const ADOPTED: LaunchdOwnership = ownership({
  kind: "USERHOME_ADOPTED",
  modifiable: true,
  readOnlyReasons: [],
  evidence: ["ADOPTION_RECORD", "DOMAIN_GUI", "OWNER_CURRENT_USER", "REGULAR_FILE"],
});

const EDIT_PREVIEW: EditPreview = {
  operationId: "op-7",
  kind: "REPLACE",
  recoveryPoint: "BACKUP",
  target: FILE,
  currentHash: "a".repeat(64),
  proposedHash: "b".repeat(64),
  diff: { lines: [], redacted: true, truncated: false },
  summary: "edit",
  effects: [],
  expiresAt: "2026-10-20T10:05:00Z",
  label: LABEL,
  domain: "GUI",
  filePath: FILE,
  changes: ["RunAtLoad"],
  environmentSet: [],
  environmentRemoved: [],
  backup: "执行前把原始 plist 备份到 UserHome 备份目录。",
  reloadNote: "配置已保存，需重新加载任务才生效；本步不会加载或重启。",
};

const EDIT_EXECUTION: EditExecution = {
  operationId: "op-7",
  summary: "edit",
  effects: [],
  expiresAt: "2026-10-20T10:05:00Z",
  status: "SUCCEEDED",
  events: [],
  outcome: {
    kind: "REPLACE",
    status: "SUCCEEDED",
    fileState: "WRITTEN",
    recoveryPoint: "BACKUP",
    backupId: "backup-1",
    summary: "s",
  },
  label: LABEL,
  domain: "GUI",
  filePath: FILE,
  reloadRequired: true,
  reloadNote: EDIT_PREVIEW.reloadNote,
};

function adoptedJob() {
  return launchdService({
    ownership: ADOPTED,
    configFiles: [
      configFile({
        details: {
          programArguments: ["/usr/local/bin/tool", "--serve"],
          argumentsTruncated: false,
          environmentKeys: ["MODE"],
          runAtLoad: false,
          keepAlive: { mode: "NEVER", conditions: [] },
        },
      }),
    ],
  });
}

beforeEach(() => {
  mocks.preview.mockReset().mockResolvedValue(EDIT_PREVIEW);
  mocks.execute.mockReset().mockResolvedValue(EDIT_EXECUTION);
  mocks.discard.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ServiceManagement saved notice", () => {
  it("shows the saved title once after an edit is saved, not again beside the dialog", async () => {
    render(<ServiceManagement onChanged={() => undefined} service={adoptedJob()} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: /可执行文件路径/ }), {
      target: { value: "/usr/local/bin/tool-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(SAVED_TITLE)).toHaveLength(1));
  });
});
