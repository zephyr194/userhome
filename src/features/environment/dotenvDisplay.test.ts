import { describe, expect, it } from "vitest";
import type { EnvFileView, EnvRow } from "../../ipc/environment";
import { dotenvDisplay } from "./environmentModel";

type Entry = Extract<EnvRow, { kind: "ENTRY" }>;

function entry(overrides: Partial<Entry> & { line: number; key: string }): Entry {
  return {
    kind: "ENTRY",
    endLine: overrides.line,
    exported: false,
    secret: false,
    hasValue: true,
    valueLength: 3,
    value: "abc",
    quote: "NONE",
    flags: [],
    ...overrides,
  };
}

function fileOf(rows: EnvRow[], overrides: Partial<EnvFileView> = {}): EnvFileView {
  const entries = rows.filter((row) => row.kind === "ENTRY");
  return {
    relativePath: ".env",
    kind: "ENVIRONMENT",
    contentHash: "a".repeat(64),
    sizeBytes: 100,
    lineCount: rows.length,
    rows,
    rowsTruncated: false,
    entryCount: entries.length,
    secretCount: entries.filter((row) => row.kind === "ENTRY" && row.secret).length,
    flaggedCount: entries.filter((row) => row.kind === "ENTRY" && row.flags.length > 0).length,
    ...overrides,
  };
}

describe("dotenv display: same key in one file", () => {
  it("shows only the last line of a repeated key", () => {
    const display = dotenvDisplay(
      fileOf([
        entry({ line: 1, key: "PORT", value: "3000", flags: ["DUPLICATE_KEY"] }),
        entry({ line: 2, key: "HOST", value: "localhost" }),
        entry({ line: 3, key: "PORT", value: "8080", flags: ["DUPLICATE_KEY"] }),
      ]),
    );
    expect(display.rows.map((row) => row.line)).toEqual([2, 3]);
    expect(display.entryCount).toBe(2);
  });

  it("records which earlier lines the shown line replaces", () => {
    const display = dotenvDisplay(
      fileOf([
        entry({ line: 1, key: "PORT", value: "1" }),
        entry({ line: 4, key: "PORT", value: "2" }),
        entry({ line: 7, key: "PORT", value: "3" }),
      ]),
    );
    expect(display.replaced.get(7)).toEqual([1, 4]);
    expect(display.replaced.has(1)).toBe(false);
  });

  it("keeps every row when no key repeats", () => {
    const rows: EnvRow[] = [
      { kind: "COMMENT", line: 1, text: "# top", withheld: false },
      entry({ line: 2, key: "A" }),
      { kind: "BLANK", line: 3 },
      entry({ line: 4, key: "B" }),
    ];
    const display = dotenvDisplay(fileOf(rows));
    expect(display.rows).toEqual(rows);
    expect(display.replaced.size).toBe(0);
    expect(display.entryCount).toBe(2);
  });

  it("drops the duplicate-key flag from the shown line, and keeps other flags", () => {
    const display = dotenvDisplay(
      fileOf([
        entry({ line: 1, key: "TOKEN", value: "x", flags: ["DUPLICATE_KEY"] }),
        entry({ line: 2, key: "TOKEN", value: "y", flags: ["DUPLICATE_KEY", "INTERPOLATION"] }),
        entry({ line: 3, key: "NAME", value: "z", flags: ["DUPLICATE_KEY"] }),
        entry({ line: 4, key: "NAME", value: "w", flags: ["DUPLICATE_KEY"] }),
      ]),
    );
    const winners = display.rows.filter(
      (row): row is Entry => row.kind === "ENTRY",
    );
    expect(winners.find((row) => row.line === 2)?.flags).toEqual(["INTERPOLATION"]);
    expect(winners.find((row) => row.line === 4)?.flags).toEqual([]);
    expect(display.flaggedCount).toBe(1);
  });

  it("adjusts the secret and flagged counts for the rows that disappear", () => {
    const display = dotenvDisplay(
      fileOf([
        entry({ line: 1, key: "API_TOKEN", secret: true, value: undefined, valueLength: 9, flags: ["DUPLICATE_KEY"] }),
        entry({ line: 2, key: "API_TOKEN", secret: true, value: undefined, valueLength: 9, flags: ["DUPLICATE_KEY"] }),
        entry({ line: 3, key: "CMD", value: "$(id)", flags: ["COMMAND_SUBSTITUTION"] }),
      ]),
    );
    expect(display.entryCount).toBe(2);
    expect(display.secretCount).toBe(1);
    expect(display.flaggedCount).toBe(1);
  });

  it("never carries a secret value into the replacement information", () => {
    const display = dotenvDisplay(
      fileOf([
        entry({ line: 1, key: "API_TOKEN", secret: true, value: undefined, valueLength: 9 }),
        entry({ line: 2, key: "API_TOKEN", secret: true, value: undefined, valueLength: 9 }),
      ]),
    );
    expect(JSON.stringify([...display.replaced.entries()])).toBe("[[2,[1]]]");
  });

  it("leaves a file that was cut short exactly as it was read", () => {
    const file = fileOf(
      [entry({ line: 1, key: "PORT", value: "1" }), entry({ line: 2, key: "PORT", value: "2" })],
      { rowsTruncated: true, lineCount: 9000, entryCount: 2 },
    );
    const display = dotenvDisplay(file);
    expect(display.rows).toEqual(file.rows);
    expect(display.replaced.size).toBe(0);
    expect(display.entryCount).toBe(2);
  });
});
