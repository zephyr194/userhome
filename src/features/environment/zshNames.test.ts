import { describe, expect, it } from "vitest";
import type {
  ZshEntryRow,
  ZshFile,
  ZshFileDetail,
  ZshFileKey,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import {
  resolveZshNames,
  zshFileDisplay,
  zshRowKey,
} from "./zshModel";

const NAMES = {
  ZSHENV: ".zshenv",
  ZPROFILE: ".zprofile",
  ZSHRC: ".zshrc",
  ZLOGIN: ".zlogin",
} as const;
const POSITIONS = { ZSHENV: 2, ZPROFILE: 4, ZSHRC: 6, ZLOGIN: 8 } as const;

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

function detail(rows: ZshRow[], overrides: Partial<ZshFileDetail> = {}): ZshFileDetail {
  const entries = rows.filter((row): row is ZshEntryRow => row.kind === "ENTRY");
  return {
    contentHash: "a".repeat(64),
    sizeBytes: 10,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: entries.length,
    secretCount: entries.filter((row) => row.secret).length,
    dynamicCount: entries.filter((row) => row.state === "DYNAMIC").length,
    unrecognizedCount: 0,
    ...overrides,
  };
}

function file(key: ZshFileKey, rows: ZshRow[], overrides: Partial<ZshFileDetail> = {}): ZshFile {
  return {
    file: key,
    name: NAMES[key],
    appliesTo: "ALL",
    position: POSITIONS[key],
    displayPath: `~/${NAMES[key]}`,
    outcome: { status: "READY", ...detail(rows, overrides) },
  };
}

function overview(files: ZshFile[]): ZshOverview {
  return {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: [],
    zdotdir: { status: "DEFAULT" },
    files,
  };
}

describe("zsh same names: the last assignment in reading order wins", () => {
  it("hides an earlier file's assignment when a later static one sets the name", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZSHRC", [entry({ line: 3, name: "EDITOR", value: "code" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZSHENV", 1)]);
    expect(resolution.notes.get(zshRowKey("ZSHRC", 3))).toEqual({
      kind: "replaces",
      replaced: [{ fileName: ".zshenv", line: 1 }],
    });
    expect(resolution.notes.has(zshRowKey("ZSHENV", 1))).toBe(false);
  });

  it("decides by reading order, not by the order the files were listed", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHRC", [entry({ line: 3, name: "EDITOR", value: "code" })]),
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZSHENV", 1)]);
  });

  it("uses the last line of the same file", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHRC", [
          entry({ line: 3, name: "EDITOR", value: "vim" }),
          entry({ line: 9, name: "EDITOR", value: "nano" }),
        ]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZSHRC", 3)]);
    expect(resolution.notes.get(zshRowKey("ZSHRC", 9))?.kind).toBe("replaces");
  });

  it("hides an earlier append when a later plain set resets the name", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "PATH", operation: "APPEND", value: "/a" })]),
        file("ZSHRC", [entry({ line: 2, name: "PATH", value: "/usr/bin" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZSHENV", 1)]);
  });

  it("keeps every occurrence when the last one is dynamic", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZSHRC", [
          entry({ line: 3, name: "EDITOR", value: "$VISUAL", state: "DYNAMIC", reason: "UNRESOLVED_REFERENCE" }),
        ]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZSHENV", 1))).toEqual({
      kind: "shared",
      others: [{ fileName: ".zshrc", line: 3 }],
    });
    expect(resolution.notes.get(zshRowKey("ZSHRC", 3))?.kind).toBe("shared");
  });

  it("keeps every occurrence when the last one appends", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "PATH", value: "/usr/bin" })]),
        file("ZSHRC", [entry({ line: 2, name: "PATH", operation: "APPEND", value: "/opt/bin" })]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZSHRC", 2))?.kind).toBe("shared");
  });

  it("says nothing about names that occur once", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "A" })]),
        file("ZSHRC", [entry({ line: 2, name: "B" })]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.size).toBe(0);
  });

  it("treats PATH and path as different names", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "PATH" })]),
        file("ZSHRC", [entry({ line: 2, name: "path" })]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.size).toBe(0);
  });

  it("does nothing when any file was cut short, because a later line may be past the cut", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR" })]),
        file("ZSHRC", [entry({ line: 3, name: "EDITOR", value: "code" })], { rowsTruncated: true }),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.size).toBe(0);
  });
});

describe("zsh file display after same-name resolution", () => {
  it("drops replaced rows and lowers the file's counts to match", () => {
    const zshenvRows: ZshRow[] = [
      entry({ line: 1, name: "TOKEN", secret: true, value: undefined, valueLength: 6 }),
      entry({ line: 2, name: "OTHER" }),
      entry({ line: 3, name: "CMD", state: "DYNAMIC", reason: "COMMAND_SUBSTITUTION", value: "$(id)" }),
    ];
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", zshenvRows),
        file("ZSHRC", [entry({ line: 4, name: "TOKEN", value: "new" })]),
      ]),
    );

    const display = zshFileDisplay("ZSHENV", detail(zshenvRows), resolution);
    expect(display.rows.map((row) => (row.kind === "ENTRY" ? row.name : row.kind))).toEqual(["OTHER", "CMD"]);
    expect(display.entryCount).toBe(2);
    expect(display.secretCount).toBe(0);
    expect(display.dynamicCount).toBe(1);
  });

  it("leaves a file untouched when nothing in it is replaced", () => {
    const rows: ZshRow[] = [{ kind: "COMMENT", line: 1, text: "# hi", withheld: false }, entry({ line: 2, name: "A" })];
    const only = file("ZSHRC", rows);
    const resolution = resolveZshNames(overview([only]));
    const display = zshFileDisplay("ZSHRC", detail(rows), resolution);
    expect(display.rows).toEqual(rows);
    expect(display.entryCount).toBe(1);
  });
});
