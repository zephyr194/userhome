// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeBuiltCommand,
  ClaudeOptionItem,
  ClaudeOptionSummary,
} from "../../ipc/aiConfig";
import { deferred } from "../../test/deferred";
import { renderStrict } from "../../test/renderStrict";
import { CommandBuilder } from "./CommandBuilder";

const getClaudeOptions = vi.fn();
const buildClaudeCommand = vi.fn();

vi.mock("../../ipc/aiConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/aiConfig")>()),
  getClaudeOptions: (...args: unknown[]) => getClaudeOptions(...args),
  buildClaudeCommand: (...args: unknown[]) => buildClaudeCommand(...args),
}));

function flag(id: string): ClaudeOptionItem {
  return {
    id,
    kind: "flag",
    valueType: "boolean",
    allowedValues: [],
    description: `Flag ${id}.`,
    generatable: true,
    secret: false,
    singleInvocation: true,
    excludes: [],
    requires: [],
    risks: [],
    versions: null,
    configAlternative: null,
  };
}

const SUMMARY: ClaudeOptionSummary = {
  coverageNote: "收录范围：已核实的子集。",
  flagsCoverage: null,
  envCoverage: null,
  items: [flag("--alpha"), flag("--beta")],
};

function built(text: string): ClaudeBuiltCommand {
  return { text, notices: [], placeholders: [] };
}

async function settle() {
  await act(async () => {});
}

async function mountReady() {
  renderStrict(<CommandBuilder />);
  await settle();
  expect(screen.getByLabelText("--alpha")).toBeTruthy();
}

beforeEach(() => {
  getClaudeOptions.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommandBuilder command requests", () => {
  it("shows the command of the newest selection when the older answer arrives last", async () => {
    const older = deferred<ClaudeBuiltCommand>();
    const newer = deferred<ClaudeBuiltCommand>();
    buildClaudeCommand
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await mountReady();

    fireEvent.click(screen.getByLabelText("--alpha"));
    fireEvent.click(screen.getByLabelText("--beta"));
    expect(buildClaudeCommand).toHaveBeenCalledTimes(2);

    newer.resolve(built("claude --alpha --beta"));
    await settle();
    older.resolve(built("claude --alpha"));
    await settle();

    expect(screen.getByLabelText("生成的命令").textContent).toBe("claude --alpha --beta");
  });

  it("drops a late answer once the selection is emptied again", async () => {
    const late = deferred<ClaudeBuiltCommand>();
    buildClaudeCommand.mockReturnValueOnce(late.promise);
    await mountReady();

    fireEvent.click(screen.getByLabelText("--alpha"));
    expect(buildClaudeCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("--alpha"));

    late.resolve(built("claude --alpha"));
    await settle();

    expect(screen.queryByLabelText("生成的命令")).toBeNull();
  });

  it("shows the failure of the newest request, not the older success", async () => {
    const older = deferred<ClaudeBuiltCommand>();
    const newer = deferred<ClaudeBuiltCommand>();
    buildClaudeCommand
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await mountReady();

    fireEvent.click(screen.getByLabelText("--alpha"));
    fireEvent.click(screen.getByLabelText("--beta"));
    newer.reject({ code: "INTERNAL", message: "boom", retryable: false });
    await settle();
    older.resolve(built("claude --alpha"));
    await settle();

    expect(screen.queryByLabelText("生成的命令")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
