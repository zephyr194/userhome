import { describe, expect, it } from "vitest";
import type {
  ZshAppliesTo,
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
const APPLIES: Record<ZshFileKey, ZshAppliesTo> = {
  ZSHENV: "ALL",
  ZPROFILE: "LOGIN",
  ZSHRC: "INTERACTIVE",
  ZLOGIN: "LOGIN",
};

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
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    displayPath: `~/${NAMES[key]}`,
    outcome: { status: "READY", ...detail(rows, overrides) },
  };
}

function unreadable(
  key: ZshFileKey,
  reason: "PERMISSION_DENIED" | "NOT_FOUND" = "PERMISSION_DENIED",
): ZshFile {
  return {
    file: key,
    name: NAMES[key],
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    displayPath: `~/${NAMES[key]}`,
    outcome: { status: "UNAVAILABLE", reason, message: "无法读取" },
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

describe("zsh same names: a later assignment hides an earlier one only where it covers it", () => {
  it("hides an earlier login assignment when a later login file sets the name", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZLOGIN", [entry({ line: 3, name: "EDITOR", value: "code" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZPROFILE", 1)]);
    expect(resolution.notes.get(zshRowKey("ZLOGIN", 3))).toEqual({
      kind: "replaces",
      appliesTo: "LOGIN",
      replaced: [{ fileName: ".zprofile", line: 1, appliesTo: "LOGIN" }],
    });
    expect(resolution.notes.has(zshRowKey("ZPROFILE", 1))).toBe(false);
  });

  it("keeps an all-shells value when a later interactive file sets it, and says non-interactive zsh still uses it", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZSHRC", [entry({ line: 3, name: "EDITOR", value: "code" })]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZSHENV", 1))).toEqual({
      kind: "narrower",
      appliesTo: "ALL",
      narrower: [{ fileName: ".zshrc", line: 3, appliesTo: "INTERACTIVE" }],
    });
    expect(resolution.notes.get(zshRowKey("ZSHRC", 3))).toEqual({
      kind: "shared",
      appliesTo: "INTERACTIVE",
      others: [{ fileName: ".zshenv", line: 1, appliesTo: "ALL" }],
    });
  });

  it("keeps the earlier value for a login shell that the later interactive file does not cover", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZSHRC", [entry({ line: 3, name: "EDITOR", value: "code" })]),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZPROFILE", 1))?.kind).toBe("narrower");
  });

  it("decides by reading order, not by the order the files were listed", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZLOGIN", [entry({ line: 3, name: "EDITOR", value: "code" })]),
        file("ZPROFILE", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZPROFILE", 1)]);
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

  it("hides an earlier append when a later plain set in the same scope resets the name", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", [entry({ line: 1, name: "PATH", operation: "APPEND", value: "/a" })]),
        file("ZLOGIN", [entry({ line: 2, name: "PATH", value: "/usr/bin" })]),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZPROFILE", 1)]);
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
      appliesTo: "ALL",
      others: [{ fileName: ".zshrc", line: 3, appliesTo: "INTERACTIVE" }],
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

describe("zsh same names when a later file could not be read", () => {
  it("marks an earlier value as possibly overridden instead of treating it as final", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        unreadable("ZLOGIN"),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZSHENV", 1))).toEqual({
      kind: "unread",
      appliesTo: "ALL",
      unreadFiles: [".zlogin"],
    });
  });

  it("does not hide a login value because a later login file could not be read", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        unreadable("ZLOGIN"),
      ]),
    );
    expect(resolution.hidden.size).toBe(0);
    expect(resolution.notes.get(zshRowKey("ZPROFILE", 1))?.kind).toBe("unread");
  });

  it("does not mark anything for a later file that is absent", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZSHENV", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        unreadable("ZLOGIN", "NOT_FOUND"),
      ]),
    );
    expect(resolution.notes.size).toBe(0);
  });

  it("ignores an unreadable file that comes before the value", () => {
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", [entry({ line: 1, name: "EDITOR", value: "vim" })]),
        file("ZLOGIN", [entry({ line: 2, name: "EDITOR", value: "code" })]),
        unreadable("ZSHRC"),
      ]),
    );
    expect([...resolution.hidden]).toEqual([zshRowKey("ZPROFILE", 1)]);
    expect(resolution.notes.get(zshRowKey("ZLOGIN", 2))?.kind).toBe("replaces");
  });
});

describe("zsh file display after same-name resolution", () => {
  it("drops replaced rows and lowers the file's counts to match", () => {
    const zprofileRows: ZshRow[] = [
      entry({ line: 1, name: "TOKEN", secret: true, value: undefined, valueLength: 6 }),
      entry({ line: 2, name: "OTHER" }),
      entry({ line: 3, name: "CMD", state: "DYNAMIC", reason: "COMMAND_SUBSTITUTION", value: "$(id)" }),
    ];
    const resolution = resolveZshNames(
      overview([
        file("ZPROFILE", zprofileRows),
        file("ZLOGIN", [entry({ line: 4, name: "TOKEN", value: "new" })]),
      ]),
    );

    const display = zshFileDisplay("ZPROFILE", detail(zprofileRows), resolution);
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
