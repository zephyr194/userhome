// Fixtures shared by the zsh editor tests (model, controller and view).
import type {
  ZshEditOutcome,
  ZshEditPreview,
  ZshEditState,
  ZshEditExecution,
} from "../../ipc/environment";
import type { WriteOutcome } from "../../ipc/resources";

export const GRANT_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
export const HASH = "a".repeat(64);
export const SECRET_TEXT = "hunter2-very-secret";

export function stateOf(overrides: Partial<ZshEditState> = {}): ZshEditState {
  return {
    file: "ZSHRC",
    name: ".zshrc",
    appliesTo: "INTERACTIVE",
    position: 6,
    displayPath: "~/.zshrc",
    fullPath: "/Users/me/.zshrc",
    exists: true,
    contentHash: HASH,
    enabled: true,
    grantId: GRANT_ID,
    block: {
      status: "PRESENT",
      beginLine: 3,
      endLine: 8,
      variables: [
        { name: "EDITOR", line: 4, secret: false, hasValue: true, valueLength: 3, value: "vim" },
        { name: "API_TOKEN", line: 5, secret: true, hasValue: true, valueLength: 12 },
      ],
      path: ["/opt/tool/bin", "$HOME/bin"],
    },
    outside: {
      variables: [
        { name: "EDITOR", line: 1, beforeBlock: true, state: "STATIC", secret: false },
        { name: "LANG", line: 10, beforeBlock: false, state: "STATIC", secret: false },
      ],
      path: [
        {
          line: 2,
          beforeBlock: true,
          operation: "SET",
          state: "DYNAMIC",
          reason: "COMMAND_SUBSTITUTION",
          segments: [
            { text: "$(brew --prefix)/bin", state: "DYNAMIC" },
            { text: "$PATH", state: "REFERENCE" },
          ],
        },
        {
          line: 11,
          beforeBlock: false,
          operation: "SET",
          state: "STATIC",
          segments: [{ text: "/opt/static/bin", state: "STATIC" }],
        },
      ],
      dynamicPathLines: [
        { line: 12, beforeBlock: false, reason: "BLOCK", text: "if x; then PATH=y; fi", withheld: false },
      ],
      truncated: false,
    },
    ...overrides,
  };
}

/** A file without a block (and optionally without the file itself). */
export function emptyStateOf(overrides: Partial<ZshEditState> = {}): ZshEditState {
  return stateOf({
    block: { status: "ABSENT" },
    outside: { variables: [], path: [], dynamicPathLines: [], truncated: false },
    ...overrides,
  });
}

export function readyOutcome(state: ZshEditState = stateOf()): ZshEditOutcome {
  return { status: "READY", ...state };
}

export function previewOf(overrides: Partial<ZshEditPreview> = {}): ZshEditPreview {
  return {
    operationId: "op-1",
    summary: "Replace ~/.zshrc.",
    effects: [],
    expiresAt: "2026-10-16T10:05:00.000Z",
    kind: "REPLACE",
    recoveryPoint: "BACKUP",
    target: "~/.zshrc",
    currentHash: HASH,
    proposedHash: "b".repeat(64),
    diff: { lines: [], redacted: true, truncated: false },
    file: "ZSHRC",
    appliesTo: "INTERACTIVE",
    position: 6,
    displayPath: "~/.zshrc",
    fullPath: "/Users/me/.zshrc",
    createdBlock: false,
    variableChanges: [
      { name: "EDITOR", change: "MODIFY", secret: false, before: "vim", after: "nvim", omitted: false },
    ],
    blockDiff: [
      { kind: "REMOVED", text: "export EDITOR='vim'" },
      { kind: "ADDED", text: "export EDITOR='nvim'" },
    ],
    warnings: [{ kind: "OVERRIDES_EARLIER_ASSIGNMENT", name: "EDITOR", line: 1 }],
    effectNote: "改动仅对之后新开的终端可能生效。",
    ...overrides,
  };
}

export function executionOf(outcome: Partial<WriteOutcome> = {}): ZshEditExecution {
  return {
    operationId: "op-1",
    summary: "Replace ~/.zshrc.",
    effects: [],
    expiresAt: "2026-10-16T10:05:00.000Z",
    status: "SUCCEEDED",
    events: [],
    outcome: {
      kind: "REPLACE",
      status: "SUCCEEDED",
      fileState: "WRITTEN",
      recoveryPoint: "BACKUP",
      backupId: "backup-1",
      summary: "The file was written and verified.",
      ...outcome,
    },
    file: "ZSHRC",
    effectNote: "改动仅对之后新开的终端可能生效。",
  };
}
