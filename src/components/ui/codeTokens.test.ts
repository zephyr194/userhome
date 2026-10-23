import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_MAX_BYTES,
  canHighlight,
  splitLines,
  tokenizeLines,
  type CodeLanguage,
  type CodeToken,
} from "./codeTokens";

const LANGUAGES: CodeLanguage[] = ["dotenv", "shell", "caddyfile", "json", "toml", "ini", "plain"];

function kindsOf(line: readonly CodeToken[]): Array<[string, string | undefined]> {
  return line.map((token) => [token.text, token.kind]);
}

function firstLine(text: string, language: CodeLanguage): Array<[string, string | undefined]> {
  return kindsOf(tokenizeLines(text, language)[0] ?? []);
}

describe("splitLines", () => {
  it("returns no lines for an empty string", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("drops only the newline that ends the text", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("treats CRLF, LF and CR as line breaks without leaving carriage returns behind", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("a\r\n")).toEqual(["a"]);
  });
});

describe("canHighlight", () => {
  it("allows content up to the byte limit", () => {
    expect(canHighlight("x".repeat(HIGHLIGHT_MAX_BYTES))).toBe(true);
  });

  it("refuses content over the byte limit, counting multi-byte characters by their UTF-8 size", () => {
    expect(canHighlight("x".repeat(HIGHLIGHT_MAX_BYTES + 1))).toBe(false);
    expect(canHighlight("语".repeat(Math.ceil(HIGHLIGHT_MAX_BYTES / 3) + 1))).toBe(false);
  });
});

describe("tokenizeLines", () => {
  it("returns no lines for empty text in every language", () => {
    for (const language of LANGUAGES) {
      expect(tokenizeLines("", language)).toEqual([]);
    }
  });

  it("keeps every line's text exactly as written, for every language and tricky input", () => {
    const samples = [
      'KEY="value with \\" escape" # trailing\nexport B=${HOME}/bin:$PATH\n# comment\n',
      'if [ -n "$X" ]; then echo \'hi\' fi\nalias ll=\'ls -la\' # c',
      "example.com, www.example.com {\n    reverse_proxy {env.HOST}:8080 {\n        header_up X-A \"b\"\n    }\n}\n",
      '{\n  "a": [1, -2.5e3, true, null], /* block\n  still */ "b": "unterminated\n}\n',
      "[server]\nport = 8080 # note\nname = 'x'\n; ini comment\n",
      "\"unclosed\n'also unclosed\n${UNCLOSED\n{\"\n",
    ];
    for (const sample of samples) {
      for (const language of LANGUAGES) {
        const lines = tokenizeLines(sample, language);
        const rebuilt = lines.map((line) => line.map((token) => token.text).join(""));
        expect(rebuilt).toEqual(splitLines(sample));
      }
    }
  });

  it("produces no empty tokens", () => {
    const lines = tokenizeLines('A="" # \n  \n', "dotenv");
    for (const line of lines) {
      for (const token of line) expect(token.text.length).toBeGreaterThan(0);
    }
  });

  it("marks dotenv comments, keys, strings, variables, numbers and keywords", () => {
    expect(firstLine("# note", "dotenv")).toEqual([["# note", "comment"]]);
    expect(firstLine("export PORT=8080", "dotenv")).toEqual([
      ["export", "keyword"],
      [" ", undefined],
      ["PORT", "key"],
      ["=", "punct"],
      ["8080", "number"],
    ]);
    expect(firstLine('NAME="a b" # tail', "dotenv")).toEqual([
      ["NAME", "key"],
      ["=", "punct"],
      ['"a b"', "string"],
      [" ", undefined],
      ["# tail", "comment"],
    ]);
    expect(firstLine("PATH=$HOME/bin", "dotenv")).toEqual([
      ["PATH", "key"],
      ["=", "punct"],
      ["$HOME", "variable"],
      ["/bin", undefined],
    ]);
    expect(firstLine("DEBUG=true", "dotenv")).toEqual([
      ["DEBUG", "key"],
      ["=", "punct"],
      ["true", "keyword"],
    ]);
  });

  it("does not start a comment in the middle of a word", () => {
    expect(firstLine("URL=http://x/#frag", "dotenv")).toEqual([
      ["URL", "key"],
      ["=", "punct"],
      ["http://x/#frag", undefined],
    ]);
  });

  it("highlights shell keywords and variables", () => {
    expect(firstLine('export PATH="$HOME/bin:$PATH"', "shell")).toEqual([
      ["export", "keyword"],
      [" ", undefined],
      ["PATH", "key"],
      ["=", "punct"],
      ['"$HOME/bin:$PATH"', "string"],
    ]);
    expect(firstLine("eval \"${X}\" # c", "shell")).toEqual([
      ["eval", undefined],
      [" ", undefined],
      ['"${X}"', "string"],
      [" ", undefined],
      ["# c", "comment"],
    ]);
  });

  it("marks Caddyfile site addresses, directives, braces and placeholders", () => {
    const lines = tokenizeLines(
      "example.com {\n    reverse_proxy {env.HOST}:8080 {\n    }\n}",
      "caddyfile",
    );
    expect(kindsOf(lines[0])).toEqual([
      ["example.com", "section"],
      [" ", undefined],
      ["{", "punct"],
    ]);
    expect(kindsOf(lines[1])).toEqual([
      ["    ", undefined],
      ["reverse_proxy", "keyword"],
      [" ", undefined],
      ["{env.HOST}", "variable"],
      [":8080", undefined],
      [" ", undefined],
      ["{", "punct"],
    ]);
    expect(kindsOf(lines[3])).toEqual([["}", "punct"]]);
  });

  it("marks JSON keys differently from string values, and keeps comments in JSONC", () => {
    expect(firstLine('  "port": 8080,', "json")).toEqual([
      ["  ", undefined],
      ['"port"', "key"],
      [":", "punct"],
      [" ", undefined],
      ["8080", "number"],
      [",", "punct"],
    ]);
    expect(firstLine('"name": "UserHome"', "json").slice(2)).toEqual([
      [" ", undefined],
      ['"UserHome"', "string"],
    ]);
    expect(firstLine("// hello", "json")).toEqual([["// hello", "comment"]]);
  });

  it("carries a JSONC block comment across lines", () => {
    const lines = tokenizeLines("/* start\nmiddle\nend */ \"k\": 1", "json");
    expect(kindsOf(lines[0])).toEqual([["/* start", "comment"]]);
    expect(kindsOf(lines[1])).toEqual([["middle", "comment"]]);
    expect(kindsOf(lines[2]).find(([text]) => text === '"k"')).toEqual(['"k"', "key"]);
  });

  it("marks TOML and INI sections, keys and comments", () => {
    expect(firstLine("[server]", "toml")).toEqual([["[server]", "section"]]);
    expect(firstLine("port = 8080 # http", "toml")).toEqual([
      ["port", "key"],
      [" ", undefined],
      ["=", "punct"],
      [" ", undefined],
      ["8080", "number"],
      [" ", undefined],
      ["# http", "comment"],
    ]);
    expect(firstLine("; note", "ini")).toEqual([["; note", "comment"]]);
    expect(firstLine("# note", "toml")).toEqual([["# note", "comment"]]);
  });

  it("leaves plain text without any kind", () => {
    expect(firstLine("port = 8080", "plain")).toEqual([["port = 8080", undefined]]);
  });

  it("finishes quickly on very long lines with unbalanced quotes and braces", () => {
    const pathological = '"{${'.repeat(60_000) + "\n";
    const started = performance.now();
    for (const language of LANGUAGES) {
      const lines = tokenizeLines(pathological, language);
      expect(lines).toHaveLength(1);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("handles a single line of 200 KB without losing text", () => {
    const long = `KEY=${"a".repeat(HIGHLIGHT_MAX_BYTES)}`;
    const [line] = tokenizeLines(long, "dotenv");
    expect(line.map((token) => token.text).join("")).toBe(long);
  });
});
