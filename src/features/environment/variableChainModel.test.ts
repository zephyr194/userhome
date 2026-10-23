import { describe, expect, it } from "vitest";
import type {
  EnvRow,
  LaunchctlEntry,
  ZshEntryRow,
  ZshFile,
  ZshFileKey,
  ZshOrderStep,
  ZshOverview,
  ZshRow,
} from "../../ipc/environment";
import {
  dotenvVariableRows,
  launchctlVariableRows,
  zshVariableRows,
} from "./variableChainModel";

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

const MISSING: ZshFile["outcome"] = {
  status: "UNAVAILABLE",
  reason: "NOT_FOUND",
  message: "文件不存在或已被移动。",
};

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

describe("zsh chain: one name across files", () => {
  it("gives a single row for a name a later login file sets, with the earlier value as process value", () => {
    const rows = zshVariableRows(
      overview([
        file("ZPROFILE", ready([entry({ line: 1, name: "EDITOR", value: "vim" })])),
        file("ZLOGIN", ready([entry({ line: 3, name: "EDITOR", value: "code" })])),
      ]),
    );
    const editor = rows.filter((row) => row.name === "EDITOR");
    expect(editor).toHaveLength(1);
    expect(editor[0]?.final.value).toEqual({ kind: "text", text: "code" });
    expect(editor[0]?.final.source).toEqual({ file: ".zlogin", line: 3 });
    expect(editor[0]?.chain.map((step) => step.source)).toEqual([{ file: ".zprofile", line: 1 }]);
  });

  it("keeps the earlier occurrences of a name as the chain, in reading order", () => {
    const rows = zshVariableRows(
      overview([
        file("ZPROFILE", ready([entry({ line: 1, name: "PATH", value: "/a" })])),
        file(
          "ZLOGIN",
          ready([
            entry({ line: 2, name: "PATH", value: "/b", operation: "APPEND" }),
            entry({ line: 4, name: "PATH", value: "/c" }),
          ]),
        ),
      ]),
    );
    const path = rows.find((row) => row.name === "PATH");
    expect(path?.final.value).toEqual({ kind: "text", text: "/c" });
    expect(path?.chain.map((step) => step.value)).toEqual([
      { kind: "text", text: "/a" },
      { kind: "text", text: "/b" },
    ]);
    expect(path?.chain.map((step) => step.source)).toEqual([
      { file: ".zprofile", line: 1 },
      { file: ".zlogin", line: 2 },
    ]);
  });
});

describe("zsh chain: appliesTo splits rows by scope", () => {
  it("shows one row per scope when the final values differ", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHENV", ready([entry({ line: 1, name: "EDITOR", value: "vim" })])),
        file("ZSHRC", ready([entry({ line: 3, name: "EDITOR", value: "code" })])),
      ]),
    );
    const editor = rows.filter((row) => row.name === "EDITOR");
    expect(editor.map((row) => row.final.scope)).toEqual(["ALL", "INTERACTIVE"]);
    expect(editor.map((row) => row.final.value)).toEqual([
      { kind: "text", text: "vim" },
      { kind: "text", text: "code" },
    ]);
    expect(editor[1]?.chain.map((step) => step.source)).toEqual([{ file: ".zshenv", line: 1 }]);
  });

  it("merges scope rows into one row without scope when every scope ends with the same value", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHENV", ready([entry({ line: 1, name: "LANG", value: "en_US" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "LANG", value: "en_US" })])),
      ]),
    );
    const lang = rows.filter((row) => row.name === "LANG");
    expect(lang).toHaveLength(1);
    expect(lang[0]?.final.scope).toBeUndefined();
  });

  it("never merges masked values, because their text is unknown", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHENV", ready([entry({ line: 1, name: "TOKEN", secret: true, value: undefined })])),
        file("ZSHRC", ready([entry({ line: 2, name: "TOKEN", secret: true, value: undefined })])),
      ]),
    );
    expect(rows.filter((row) => row.name === "TOKEN")).toHaveLength(2);
  });
});

describe("zsh chain: unreadable later files", () => {
  it("marks a final value that a later unreadable file may override", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHRC", ready([entry({ line: 1, name: "EDITOR", value: "code" })])),
        file("ZLOGIN", { status: "UNAVAILABLE", reason: "PERMISSION_DENIED", message: "无法读取。" }),
      ]),
    );
    expect(rows.find((row) => row.name === "EDITOR")?.note).toBe("可能被后面的文件覆盖");
  });

  it("does not mark anything when the later file is simply absent", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHRC", ready([entry({ line: 1, name: "EDITOR", value: "code" })])),
        file("ZLOGIN", MISSING),
      ]),
    );
    expect(rows.find((row) => row.name === "EDITOR")?.note).toBeUndefined();
  });
});

describe("zsh chain: secrets and empty values", () => {
  it("masks a secret final value and a secret process value", () => {
    const rows = zshVariableRows(
      overview([
        file("ZPROFILE", ready([entry({ line: 1, name: "GITHUB_TOKEN", secret: true, value: undefined })])),
        file("ZLOGIN", ready([entry({ line: 2, name: "GITHUB_TOKEN", secret: true, value: undefined })])),
      ]),
    );
    const token = rows.find((row) => row.name === "GITHUB_TOKEN");
    expect(token?.final.value).toEqual({ kind: "masked" });
    expect(token?.chain[0]?.value).toEqual({ kind: "masked" });
  });

  it("reports a long non-secret final value as withheld so it is fetched on demand", () => {
    const rows = zshVariableRows(
      overview([file("ZSHRC", ready([entry({ line: 1, name: "BIG", value: undefined, valueLength: 5000 })]))]),
    );
    expect(rows.find((row) => row.name === "BIG")?.final.value).toEqual({ kind: "withheld" });
  });

  it("reports an unset value as empty", () => {
    const rows = zshVariableRows(
      overview([file("ZSHRC", ready([entry({ line: 1, name: "EMPTY", hasValue: false, value: undefined, valueLength: 0 })]))]),
    );
    expect(rows.find((row) => row.name === "EMPTY")?.final.value).toEqual({ kind: "empty" });
  });

  it("keeps a dynamic value's text and state, and never treats it as merged", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHENV", ready([entry({ line: 1, name: "DATE", value: "$(date)", state: "DYNAMIC", reason: "COMMAND_SUBSTITUTION" })])),
        file("ZSHRC", ready([entry({ line: 2, name: "DATE", value: "$(date)", state: "DYNAMIC", reason: "COMMAND_SUBSTITUTION" })])),
      ]),
    );
    const dates = rows.filter((row) => row.name === "DATE");
    expect(dates).toHaveLength(2);
    expect(dates[0]?.final.state).toBe("DYNAMIC");
  });

  it("orders rows by name and lists each name once per scope", () => {
    const rows = zshVariableRows(
      overview([
        file("ZSHRC", ready([entry({ line: 1, name: "ZED" }), entry({ line: 2, name: "ALPHA" })])),
      ]),
    );
    expect(rows.map((row) => row.name)).toEqual(["ALPHA", "ZED"]);
  });
});

describe("login session chain", () => {
  it("gives every key one row with no process values and a launchctl source", () => {
    const entries: LaunchctlEntry[] = [
      { key: "PATH", value: "/usr/bin", secret: false },
      { key: "API_KEY", value: null, secret: true },
    ];
    const rows = launchctlVariableRows(entries);
    expect(rows.map((row) => row.name)).toEqual(["API_KEY", "PATH"]);
    expect(rows.every((row) => row.chain.length === 0)).toBe(true);
    expect(rows[1]?.final.source).toEqual({ file: "登录会话（launchctl）" });
    expect(rows[1]?.final.value).toEqual({ kind: "text", text: "/usr/bin" });
    expect(rows[0]?.final.value).toEqual({ kind: "masked" });
  });

  it("shows an empty login session value as empty, not as an empty text", () => {
    const rows = launchctlVariableRows([
      { key: "EMPTY_ONE", value: "", secret: false },
      { key: "UNSET_ONE", value: null, secret: false },
    ]);
    expect(rows.map((row) => row.final.value)).toEqual([{ kind: "empty" }, { kind: "empty" }]);
  });
});

describe("dotenv chain within one file", () => {
  const envEntry = (line: number, key: string, value: string | undefined, secret = false): EnvRow => ({
    kind: "ENTRY",
    line,
    endLine: line,
    key,
    exported: false,
    secret,
    hasValue: value !== undefined || secret,
    valueLength: value?.length ?? 0,
    ...(value === undefined ? {} : { value }),
    quote: "NONE",
    flags: [],
  } as EnvRow);

  it("lets the last occurrence in the file win and keeps earlier ones as the chain", () => {
    const rows = dotenvVariableRows({
      relativePath: ".env",
      rows: [envEntry(1, "PORT", "3000"), envEntry(2, "PORT", "4000")],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.final.value).toEqual({ kind: "text", text: "4000" });
    expect(rows[0]?.final.source).toEqual({ file: ".env", line: 2 });
    expect(rows[0]?.chain).toEqual([
      { value: { kind: "text", text: "3000" }, source: { file: ".env", line: 1 } },
    ]);
  });

  it("masks secrets in the final value and in the chain", () => {
    const rows = dotenvVariableRows({
      relativePath: ".env",
      rows: [envEntry(1, "KEY", undefined, true), envEntry(2, "KEY", undefined, true)],
    });
    expect(rows[0]?.final.value).toEqual({ kind: "masked" });
    expect(rows[0]?.chain[0]?.value).toEqual({ kind: "masked" });
  });
});
