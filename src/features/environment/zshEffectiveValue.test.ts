import { describe, expect, it } from "vitest";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import { zshVariableRows } from "./variableChainModel";

const NAMES = { ZSHENV: ".zshenv", ZPROFILE: ".zprofile", ZSHRC: ".zshrc", ZLOGIN: ".zlogin" } as const;
const APPLIES = { ZSHENV: "ALL", ZPROFILE: "LOGIN", ZSHRC: "INTERACTIVE", ZLOGIN: "LOGIN" } as const;
const POSITIONS = { ZSHENV: 2, ZPROFILE: 4, ZSHRC: 6, ZLOGIN: 8 } as const;
const ORDER: ZshOrderStep[] = (Object.keys(NAMES) as ZshFileKey[]).map((key) => ({
  position: POSITIONS[key],
  scope: "USER",
  pathLabel: `~/${NAMES[key]}`,
  appliesTo: APPLIES[key],
  file: key,
  readByUserHome: true,
}));

function entry(overrides: Partial<ZshEntryRow> & { line: number; name: string }): ZshEntryRow {
  return {
    kind: "ENTRY",
    endLine: overrides.line,
    exported: true,
    operation: "SET",
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "vim",
    state: "STATIC",
    ...overrides,
  };
}

function ready(rows: ZshRow[]): ZshFile["outcome"] {
  return {
    status: "READY",
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: rows.filter((row) => row.kind === "ENTRY").length,
    secretCount: rows.filter((row) => row.kind === "ENTRY" && row.secret).length,
    dynamicCount: 0,
    unrecognizedCount: 0,
  };
}

function file(key: ZshFileKey, outcome: ZshFile["outcome"]): ZshFile {
  return {
    file: key,
    name: NAMES[key],
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    displayPath: `~/${NAMES[key]}`,
    outcome,
  };
}

function overview(files: ZshFile[]): ZshOverview {
  return {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: ORDER,
    zdotdir: { status: "DEFAULT" },
    files,
  };
}

function finalOf(files: ZshFile[], name: string) {
  return zshVariableRows(overview(files)).find((row) => row.name === name)?.final;
}

describe("zsh effective value: static values", () => {
  it("takes a plain value as its own effective text", () => {
    const final = finalOf(
      [file("ZSHENV", ready([entry({ line: 1, name: "EDITOR", value: "vim" })]))],
      "EDITOR",
    );
    expect(final?.effective).toEqual({ kind: "text", text: "vim" });
  });

  it("leaves a masked value without an effective text, since it is loaded on demand", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([entry({ line: 1, name: "TOKEN", secret: true, value: undefined, valueLength: 4 })]),
        ),
      ],
      "TOKEN",
    );
    expect(final?.effective).toBeUndefined();
  });
});

describe("zsh effective value: references", () => {
  it("expands a reference to an earlier assignment of the same shell", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "BASE", value: "/opt" }),
            entry({ line: 2, name: "BIN", value: "$BASE/bin", state: "REFERENCE" }),
          ]),
        ),
      ],
      "BIN",
    );
    expect(final?.value).toEqual({ kind: "text", text: "$BASE/bin" });
    expect(final?.effective).toEqual({ kind: "text", text: "/opt/bin" });
  });

  it("expands the braced form and several references in one value", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "ROOT", value: "/srv" }),
            entry({ line: 2, name: "SUB", value: "app", state: "STATIC" }),
            entry({ line: 3, name: "DIR", value: "${ROOT}/${SUB}/bin", state: "REFERENCE" }),
          ]),
        ),
      ],
      "DIR",
    );
    expect(final?.effective).toEqual({ kind: "text", text: "/srv/app/bin" });
  });

  it("uses the latest earlier assignment, not the first", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "BASE", value: "/old" }),
            entry({ line: 2, name: "BASE", value: "/new" }),
            entry({ line: 3, name: "BIN", value: "$BASE/bin", state: "REFERENCE" }),
          ]),
        ),
      ],
      "BIN",
    );
    expect(final?.effective).toEqual({ kind: "text", text: "/new/bin" });
  });

  it("does not expand a name that is not assigned before it, and says which name is missing", () => {
    const final = finalOf(
      [file("ZSHENV", ready([entry({ line: 1, name: "BIN", value: "$HOME/bin", state: "REFERENCE" })]))],
      "BIN",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "reference", names: ["HOME"] });
  });

  it("does not expand a secret, and says it is hidden", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "TOKEN", secret: true, value: undefined, valueLength: 4 }),
            entry({ line: 2, name: "AUTH", value: "$TOKEN:x", state: "REFERENCE" }),
          ]),
        ),
      ],
      "AUTH",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "hidden", names: ["TOKEN"] });
  });

  it("does not expand a value that depends on a run-time result", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "NOW", value: "$(date)", state: "DYNAMIC", secret: false }),
            entry({ line: 2, name: "STAMP", value: "$NOW", state: "REFERENCE" }),
          ]),
        ),
      ],
      "STAMP",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "dynamic", names: ["NOW"] });
  });

  it("does not expand a form the reader does not support, such as a default operator", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "BASE", value: "/opt" }),
            entry({ line: 2, name: "BIN", value: "${BASE:-/usr}/bin", state: "REFERENCE" }),
          ]),
        ),
      ],
      "BIN",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "complex", names: [] });
  });

  it("does not expand an appending assignment, since its result depends on the shell", () => {
    const final = finalOf(
      [
        file(
          "ZSHENV",
          ready([
            entry({ line: 1, name: "PATH", value: "/usr/bin" }),
            entry({ line: 2, name: "PATH", value: "/opt/bin", operation: "APPEND" }),
          ]),
        ),
      ],
      "PATH",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "append", names: [] });
  });
});

describe("zsh effective value: which shell sees an assignment", () => {
  it("lets a login file expand a value set by .zshenv, which every shell reads", () => {
    const final = finalOf(
      [
        file("ZSHENV", ready([entry({ line: 1, name: "BASE", value: "/opt" })])),
        file("ZLOGIN", ready([entry({ line: 3, name: "BIN", value: "$BASE/bin", state: "REFERENCE" })])),
      ],
      "BIN",
    );
    expect(final?.effective).toEqual({ kind: "text", text: "/opt/bin" });
  });

  it("does not expand a value set only by a login file in an interactive shell's file", () => {
    const final = finalOf(
      [
        file("ZPROFILE", ready([entry({ line: 1, name: "BASE", value: "/opt" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "BIN", value: "$BASE/bin", state: "REFERENCE" })])),
      ],
      "BIN",
    );
    expect(final?.effective).toEqual({ kind: "unresolved", reason: "reference", names: ["BASE"] });
  });

  it("merges two scopes into one row when the expanded values agree", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHENV", ready([entry({ line: 1, name: "BASE", value: "/opt" })])),
        file("ZPROFILE", ready([entry({ line: 3, name: "BIN", value: "$BASE/bin", state: "REFERENCE" })])),
        file("ZSHRC", ready([entry({ line: 5, name: "BIN", value: "/opt/bin" })])),
      ]),
    );
    const bin = rows.filter((row) => row.name === "BIN");
    expect(bin).toHaveLength(1);
    expect(bin[0]?.final.effective).toEqual({ kind: "text", text: "/opt/bin" });
  });
});
