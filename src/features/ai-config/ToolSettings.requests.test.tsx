// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeEditCatalog,
  ClaudeEditItem,
  ClaudeReadView,
  ClaudeSnapshotSummary,
} from "../../ipc/aiConfig";
import { deferred } from "../../test/deferred";
import { renderStrict } from "../../test/renderStrict";
import { ToolSettings } from "./ToolSettings";

const getClaudeSnapshot = vi.fn();
const getClaudeEditCatalog = vi.fn();
const readClaudeSettings = vi.fn();
const publishToolSearchItems = vi.fn();

vi.mock("../../ipc/aiConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/aiConfig")>()),
  getClaudeSnapshot: (...args: unknown[]) => getClaudeSnapshot(...args),
  getClaudeEditCatalog: (...args: unknown[]) => getClaudeEditCatalog(...args),
  readClaudeSettings: (...args: unknown[]) => readClaudeSettings(...args),
}));

vi.mock("./configSearchStore", () => ({
  publishToolSearchItems: (...args: unknown[]) => publishToolSearchItems(...args),
}));

function snapshot(sourceUrl: string): ClaudeSnapshotSummary {
  return {
    toolId: "claude-code",
    displayName: "Claude Code",
    sourceUrl,
    retrievedOn: "2026-10-21",
    documentedVersion: "unknown",
    settingCount: 1,
    resourceCount: 1,
    editable: 0,
    displayOnly: 1,
    versionUnknown: 0,
    notApplicable: 0,
    unsupported: 0,
    unknownValueType: 0,
  };
}

function catalog(keyPath: string): ClaudeEditCatalog {
  const item: ClaudeEditItem = {
    keyPath,
    valueType: "string",
    allowedValues: [],
    editable: false,
    reason: null,
    verifiedVersion: null,
    description: "",
    descriptionTruncated: false,
    defaultNote: "",
    sourceUrl: "https://docs.invalid/item",
    sourceRetrievedOn: "2026-10-21",
  };
  return { detectedVersion: null, items: [item] };
}

const READY_VIEW: ClaudeReadView = {
  toolId: "claude-code",
  layers: [],
  entries: [],
  warnings: [],
};

async function settle() {
  await act(async () => {});
}

function publishedKeys(): string[] {
  const calls = publishToolSearchItems.mock.calls;
  const items = calls[calls.length - 1]?.[1] as readonly { keyPath: string }[] | undefined;
  return (items ?? []).map((item) => item.keyPath);
}

beforeEach(() => {
  readClaudeSettings.mockResolvedValue(READY_VIEW);
  getClaudeSnapshot.mockResolvedValue(snapshot("https://example.test/default"));
  getClaudeEditCatalog.mockResolvedValue(catalog("default"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ToolSettings definition requests", () => {
  it("shows the snapshot of the newest StrictMode mount when the older answer arrives last", async () => {
    const first = deferred<ClaudeSnapshotSummary>();
    const second = deferred<ClaudeSnapshotSummary>();
    getClaudeSnapshot
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderStrict(<ToolSettings />);
    expect(getClaudeSnapshot).toHaveBeenCalledTimes(2);

    second.resolve(snapshot("https://example.test/newest"));
    await settle();
    first.resolve(snapshot("https://example.test/stale"));
    await settle();

    expect(screen.getByText(/https:\/\/example\.test\/newest/)).toBeTruthy();
    expect(screen.queryByText(/https:\/\/example\.test\/stale/)).toBeNull();
  });

  it("falls back to the unavailable note when the snapshot read fails", async () => {
    getClaudeSnapshot.mockRejectedValue({ code: "INTERNAL", message: "x", retryable: false });

    renderStrict(<ToolSettings />);
    await settle();

    expect(screen.queryByText(/https:\/\/example\.test/)).toBeNull();
    expect(screen.getByText("定义摘要不可用。")).toBeTruthy();
  });

  it("indexes the catalog of the newest StrictMode mount when the older answer arrives last", async () => {
    const first = deferred<ClaudeEditCatalog>();
    const second = deferred<ClaudeEditCatalog>();
    getClaudeEditCatalog
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    renderStrict(<ToolSettings />);
    expect(getClaudeEditCatalog).toHaveBeenCalledTimes(2);

    second.resolve(catalog("newest.key"));
    await settle();
    first.resolve(catalog("stale.key"));
    await settle();

    expect(publishedKeys()).toEqual(["newest.key"]);
  });

  it("drops a catalog answer that arrives after the page unmounted", async () => {
    const late = deferred<ClaudeEditCatalog>();
    getClaudeEditCatalog.mockReturnValue(late.promise);

    const { unmount } = renderStrict(<ToolSettings />);
    await settle();
    publishToolSearchItems.mockClear();
    unmount();
    late.resolve(catalog("after.unmount"));
    await settle();

    expect(publishToolSearchItems).not.toHaveBeenCalled();
  });
});
