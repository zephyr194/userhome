// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchdActionPreview, LaunchdService } from "../../ipc/services";
import { deferred, type Deferred } from "../../test/deferred";
import { createdService, sampleDiscovery } from "./launchdFixtures";
import { EMPTY_FILTER } from "./launchdModel";
import { ServicesView, type ServicesViewProps } from "./ServicesView";

// The backend answer of each preview is held back by hand, so a late answer can
// be placed after the user has moved to another job.
const previews = new Map<string, Deferred<LaunchdActionPreview>>();
const previewLaunchdAction = vi.fn(
  (request: { action: string; label: string }) => {
    const answer = deferred<LaunchdActionPreview>();
    previews.set(request.label, answer);
    return answer.promise;
  },
);

vi.mock("../../ipc/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/services")>()),
  previewLaunchdAction: (request: { action: string; label: string }) =>
    previewLaunchdAction(request),
}));

function job(name: string): LaunchdService {
  const label = `com.zephyr194.userhome.agent.${name}`;
  return { ...createdService(), id: `gui/501/${label}`, label };
}

const FIRST = job("first");
const SECOND = job("second");

function previewOf(service: LaunchdService): LaunchdActionPreview {
  return {
    operationId: `op-${service.label}`,
    summary: "s",
    effects: [],
    expiresAt: "2026-11-03T10:05:00Z",
    action: "RESTART",
    domain: "GUI",
    label: service.label,
    meaning: ["重新启动这个任务。"],
    persistence: ["重启后不保留。"],
    commands: [`launchctl kickstart -k gui/501/${service.label}`],
    current: { loaded: true, running: true, pid: 9 },
    keepAlive: true,
    noChange: false,
  };
}

function props(selected: LaunchdService): ServicesViewProps {
  return {
    state: {
      status: "ready",
      discovery: sampleDiscovery({ services: [FIRST, SECOND] }),
      refreshing: false,
    },
    evidence: { status: "ready", summaries: [] },
    filter: EMPTY_FILTER,
    selectedId: selected.id,
    refreshDisabled: false,
    onFilterChange: () => {},
    onSelect: () => {},
    onRefresh: () => {},
  };
}

async function settle() {
  await act(async () => {});
}

function startRestart() {
  fireEvent.click(screen.getByRole("button", { name: "重启" }));
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  previews.clear();
  vi.clearAllMocks();
});

describe("services view: a preview that arrives after the selection moved", () => {
  it("opens no confirmation for the job the user already left", async () => {
    const { rerender } = render(<ServicesView {...props(FIRST)} />);
    startRestart();
    expect(previewLaunchdAction).toHaveBeenCalledTimes(1);

    // The user moves to the next job while the first preview is still reading.
    rerender(<ServicesView {...props(SECOND)} />);
    previews.get(FIRST.label)!.resolve(previewOf(FIRST));
    await settle();

    expect(screen.queryByLabelText("重启预览")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认重启" })).toBeNull();
    // The new job's panel is untouched: nothing is reading, nothing is blocked.
    expect(screen.queryByText(/正在读取重启的预览/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "重启" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps the new job's own preview when the old answer lands after it", async () => {
    const { rerender } = render(<ServicesView {...props(FIRST)} />);
    startRestart();
    rerender(<ServicesView {...props(SECOND)} />);
    startRestart();
    expect(previewLaunchdAction).toHaveBeenCalledTimes(2);

    previews.get(SECOND.label)!.resolve(previewOf(SECOND));
    await settle();
    previews.get(FIRST.label)!.resolve(previewOf(FIRST));
    await settle();

    const card = screen.getByLabelText("重启预览");
    expect(card.textContent).toContain(SECOND.label);
    expect(card.textContent).not.toContain(FIRST.label);
    expect(screen.getAllByRole("button", { name: "确认重启" })).toHaveLength(1);
  });

  it("shows no error from an old preview that failed after the move", async () => {
    const { rerender } = render(<ServicesView {...props(FIRST)} />);
    startRestart();
    rerender(<ServicesView {...props(SECOND)} />);

    previews.get(FIRST.label)!.reject({
      code: "CONFLICT",
      message: "busy",
      retryable: false,
    });
    await settle();

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
